import test from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { ethers } from "ethers";
import { adminMessage, createApiServer, MAX_UNTAGGED_POOLS, type ApiDeps } from "../src/api.js";
import { silentLogger } from "../src/log.js";

const owner = ethers.Wallet.createRandom();
const stranger = ethers.Wallet.createRandom();
const NOW = 1_800_000_000;

// Distinctive amounts so a leak anywhere in the response is detectable by substring search.
const SECRET_AMOUNTS = [123456789n, 987654321n];

function makeDeps(over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    activity: {
      headTime: NOW - 7,
      bets: (id) =>
        id === 5
          ? [
              { bettor: "0xAaaa", side: "YES", txHash: "0xt1", block: 10, blockTime: 100, amount: SECRET_AMOUNTS[0] },
              { bettor: "0xBbbb", side: "NO", txHash: "0xt2", block: 11, blockTime: 110, amount: SECRET_AMOUNTS[1] },
            ]
          : [],
    },
    resolverAddress: "0xresolver",
    getOwner: async () => owner.address,
    createPools: async () => ({ yes: "0xyes", no: "0xno" }),
    untaggedPools: () => 0,
    trackedMarkets: () => 2,
    logger: silentLogger,
    now: () => NOW,
    ...over,
  };
}

async function withServer<T>(deps: ApiDeps, fn: (base: string) => Promise<T>): Promise<T> {
  const server: http.Server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const signedBody = async (w: ethers.Wallet, ts = NOW) =>
  JSON.stringify({ address: w.address, timestamp: ts, signature: await w.signMessage(adminMessage(w.address, ts)) });

test("health reports freshness", () =>
  withServer(makeDeps(), async (base) => {
    const j = await (await fetch(`${base}/health`)).json();
    assert.equal(j.ok, true);
    assert.equal(j.ledgerLagSec, 7);
    assert.equal(j.trackedMarkets, 2);
  }));

test("activity exposes bettor and side but NEVER an amount", () =>
  withServer(makeDeps(), async (base) => {
    const text = await (await fetch(`${base}/markets/5/activity`)).text();
    const j = JSON.parse(text);
    assert.equal(j.count, 2);
    assert.deepEqual(Object.keys(j.bets[0]).sort(), ["bettor", "block", "blockTime", "side", "txHash"]);
    assert.ok(!/amount/i.test(text), "no amount field");
    for (const a of SECRET_AMOUNTS) assert.ok(!text.includes(a.toString()), `amount ${a} leaked`);
  }));

test("activity for an unknown market is an empty list", () =>
  withServer(makeDeps(), async (base) => {
    const j = await (await fetch(`${base}/markets/99/activity`)).json();
    assert.equal(j.count, 0);
  }));

test("unknown routes 404 and CORS headers are set", () =>
  withServer(makeDeps(), async (base) => {
    const r = await fetch(`${base}/nope`);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
  }));

test("admin/pools: owner signature creates a pool pair", () =>
  withServer(makeDeps(), async (base) => {
    const r = await fetch(`${base}/admin/pools`, { method: "POST", body: await signedBody(owner) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { yesPool: "0xyes", noPool: "0xno" });
  }));

test("admin/pools: non-owner is rejected and nothing is created", () => {
  let created = 0;
  return withServer(makeDeps({ createPools: async () => (created++, { yes: "a", no: "b" }) }), async (base) => {
    const r = await fetch(`${base}/admin/pools`, { method: "POST", body: await signedBody(stranger) });
    assert.equal(r.status, 403);
    assert.equal(created, 0);
  });
});

test("admin/pools: signature for a different address / expired / garbage are rejected", () =>
  withServer(makeDeps(), async (base) => {
    // owner signs, but body claims another address
    const ts = NOW;
    const sig = await owner.signMessage(adminMessage(owner.address, ts));
    let r = await fetch(`${base}/admin/pools`, { method: "POST", body: JSON.stringify({ address: stranger.address, timestamp: ts, signature: sig }) });
    assert.equal(r.status, 403);
    r = await fetch(`${base}/admin/pools`, { method: "POST", body: await signedBody(owner, NOW - 301) });
    assert.equal(r.status, 401);
    r = await fetch(`${base}/admin/pools`, { method: "POST", body: JSON.stringify({ address: owner.address, timestamp: NOW, signature: "0xdead" }) });
    assert.equal(r.status, 401);
    r = await fetch(`${base}/admin/pools`, { method: "POST", body: "not json" });
    assert.equal(r.status, 400);
  }));

test("admin/pools: refuses when too many unused pool accounts exist", () =>
  withServer(makeDeps({ untaggedPools: () => MAX_UNTAGGED_POOLS }), async (base) => {
    const r = await fetch(`${base}/admin/pools`, { method: "POST", body: await signedBody(owner) });
    assert.equal(r.status, 429);
  }));
