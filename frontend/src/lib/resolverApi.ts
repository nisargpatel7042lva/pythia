/** Client for the resolver's HTTP API (activity and health are read-only and never carry amounts). */
import { config } from "@/config";

export interface ActivityBet {
  bettor: string;
  side: "YES" | "NO";
  txHash: string;
  block: number;
  blockTime: number;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${config.resolverApiUrl}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`resolver API ${path}: HTTP ${r.status}`);
  return r.json();
}

export const fetchActivity = (marketId: number) =>
  getJson<{ marketId: number; count: number; bets: ActivityBet[] }>(`/markets/${marketId}/activity`);

/** Which transactions involve this address (hashes only; amounts are decrypted locally). */
export const fetchAccountActivity = (address: string) =>
  getJson<{ address: string; items: { kind: "bet" | "payout"; marketId: number; side: "YES" | "NO"; txHash: string }[] }>(`/accounts/${address}/activity`);

export interface Health {
  ok: boolean;
  resolver: string;
  uptimeSec: number;
  ledgerHeadTime: number;
  ledgerLagSec: number | null;
  trackedMarkets: number;
}
export const fetchHealth = () => getJson<Health>("/health");

/** Owner-only: ask the resolver to create the YES/NO pool accounts for a new market. */
export async function requestPools(body: { address: string; timestamp: number; signature: string }) {
  const r = await fetch(`${config.resolverApiUrl}/admin/pools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as { yesPool: string; noPool: string };
}

/** Must match resolver/src/api.ts adminMessage(). */
export const adminMessage = (address: string, timestamp: number) =>
  `PYTHIA admin: create pool pair\naddress: ${address.toLowerCase()}\ntimestamp: ${timestamp}`;
