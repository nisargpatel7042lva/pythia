/**
 * Small HTTP API for the frontend.
 *
 *   GET  /health                    liveness + ledger freshness
 *   GET  /markets/:id/activity      who bet and on which side: bettor, side, txHash, block time.
 *                                   NEVER includes amounts (the response is built field by field).
 *   POST /admin/pools               owner-only: create the YES/NO pool pair for a new market.
 *                                   Body {address, timestamp, signature}; the signature must be an
 *                                   EIP-191 signature by the PythiaMarkets owner over adminMessage().
 *
 * Everything but /admin/pools is read-only. /admin/pools is the one write path because only the
 * resolver holds the keys needed to create and register pool accounts; it moves no user funds.
 */
import http from "node:http";
import { ethers } from "ethers";
import type { Side } from "./keystore.js";
import type { Logger } from "./log.js";

export interface ActivitySource {
  /** May carry amounts internally; the API never forwards them. */
  bets(marketId: number): { bettor: string; side: Side; txHash: string; block: number; blockTime: number; amount?: bigint }[];
  headTime: number;
  /** Hashes of bets placed and payouts received by an address (never amounts). */
  accountActivity(address: string): { kind: "bet" | "payout"; marketId: number; side: Side; txHash: string }[];
}

export interface ApiDeps {
  activity: ActivitySource;
  resolverAddress: string;
  /** Current PythiaMarkets owner. */
  getOwner(): Promise<string>;
  /** Creates + registers a pool pair; returns their addresses. */
  createPools(): Promise<{ yes: string; no: string }>;
  /** Number of pools in the keystore not yet attached to a market. */
  untaggedPools(): number;
  trackedMarkets(): number;
  logger: Logger;
  corsOrigin?: string;
  now?: () => number;
}

export const ADMIN_MAX_AGE_SECONDS = 300;
export const MAX_UNTAGGED_POOLS = 4;

export const adminMessage = (address: string, timestamp: number) =>
  `PYTHIA admin: create pool pair\naddress: ${address.toLowerCase()}\ntimestamp: ${timestamp}`;

export function createApiServer(deps: ApiDeps): http.Server {
  const startedAt = Date.now();
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  let creating = false;

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": deps.corsOrigin ?? "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (c) => {
        data += c;
        if (data.length > 10_000) reject(new Error("body too large"));
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "OPTIONS") return send(res, 204, {});

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, {
          ok: true,
          resolver: deps.resolverAddress,
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          ledgerHeadTime: deps.activity.headTime,
          ledgerLagSec: deps.activity.headTime ? Math.max(0, now() - deps.activity.headTime) : null,
          trackedMarkets: deps.trackedMarkets(),
        });
      }

      const m = /^\/markets\/(\d+)\/activity$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const marketId = Number(m[1]);
        // Explicit field-by-field projection: amounts can never leak.
        const bets = deps.activity.bets(marketId).map((b) => ({
          bettor: b.bettor,
          side: b.side,
          txHash: b.txHash,
          block: b.block,
          blockTime: b.blockTime,
        }));
        return send(res, 200, { marketId, count: bets.length, bets });
      }

      const acct = /^\/accounts\/(0x[0-9a-fA-F]{40})\/activity$/.exec(url.pathname);
      if (req.method === "GET" && acct) {
        const items = deps.activity.accountActivity(acct[1]).map((i) => ({ kind: i.kind, marketId: i.marketId, side: i.side, txHash: i.txHash }));
        return send(res, 200, { address: acct[1], items });
      }

      if (req.method === "POST" && url.pathname === "/admin/pools") {
        let body: { address?: string; timestamp?: number; signature?: string };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: "invalid JSON body" });
        }
        const { address, timestamp, signature } = body;
        if (!address || !ethers.isAddress(address) || typeof timestamp !== "number" || typeof signature !== "string") {
          return send(res, 400, { error: "expected {address, timestamp, signature}" });
        }
        if (Math.abs(now() - timestamp) > ADMIN_MAX_AGE_SECONDS) return send(res, 401, { error: "signature expired" });
        let signer: string;
        try {
          signer = ethers.verifyMessage(adminMessage(address, timestamp), signature);
        } catch {
          return send(res, 401, { error: "bad signature" });
        }
        const owner = await deps.getOwner();
        if (signer.toLowerCase() !== address.toLowerCase() || signer.toLowerCase() !== owner.toLowerCase()) {
          return send(res, 403, { error: "not the contract owner" });
        }
        if (deps.untaggedPools() >= MAX_UNTAGGED_POOLS) {
          return send(res, 429, { error: "too many unused pool accounts; create the pending markets first" });
        }
        if (creating) return send(res, 409, { error: "a pool pair is already being created" });
        creating = true;
        try {
          deps.logger.info(`admin ${signer}: creating pool pair`);
          const pools = await deps.createPools();
          return send(res, 200, { yesPool: pools.yes, noPool: pools.no });
        } finally {
          creating = false;
        }
      }

      return send(res, 404, { error: "not found" });
    } catch (e) {
      deps.logger.error(`api: ${(e as Error).message}`);
      return send(res, 500, { error: "internal error" });
    }
  });
}
