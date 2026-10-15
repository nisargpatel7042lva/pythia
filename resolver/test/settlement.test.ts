import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { planPayouts, type BetRecord, type Side } from "../src/payouts.js";
import { PayoutStore } from "../src/payoutStore.js";
import { executePlan, type PoolExecutor } from "../src/settlement.js";
import { silentLogger } from "../src/log.js";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const YES_POOL = "0x00000000000000000000000000000000000000f1";
const NO_POOL = "0x00000000000000000000000000000000000000f2";
const poolOf: Record<Side, string> = { YES: YES_POOL, NO: NO_POOL };

class Crash extends Error {}

/** Simulated chain: pool balances, a log of every transfer actually applied, crash injection. */
class FakeChain implements PoolExecutor {
  balances = new Map<string, bigint>();
  received = new Map<string, bigint>();
  applied: { pool: string; to: string; amount: bigint; hash: string }[] = [];
  /** "pre" = die before the transfer lands; "post_unrecorded" = it landed, die before the DB hears; "post_recorded" = die after DB write. */
  crash: { seq: number; at: "pre" | "post_unrecorded" | "post_recorded" } | null = null;
  pendingBroadcast = new Set<string>();
  private n = 0;

  async poolBalance(pool: string) {
    return this.balances.get(pool.toLowerCase()) ?? 0n;
  }
  async waitIdle() {}
  async txStatus(hash: string) {
    return this.applied.some((a) => a.hash === hash) ? ("confirmed" as const) : ("unknown" as const);
  }
  async findSentTx(pool: string, to: string, exclude: Set<string>) {
    return this.applied.find((a) => a.pool === pool.toLowerCase() && a.to === to.toLowerCase() && !exclude.has(a.hash))?.hash ?? null;
  }
  async send(pool: string, to: string, amount: bigint, onSubmitted: (h: string) => void, meta: { seq: number }) {
    const p = pool.toLowerCase();
    if (this.crash?.seq === meta.seq && this.crash.at === "pre") throw new Crash("pre");
    const bal = this.balances.get(p) ?? 0n;
    if (bal < amount) throw new Error("insufficient pool balance");
    this.balances.set(p, bal - amount);
    this.received.set(to.toLowerCase(), (this.received.get(to.toLowerCase()) ?? 0n) + amount);
    const hash = `0xtx${this.n++}`;
    this.applied.push({ pool: p, to: to.toLowerCase(), amount, hash });
    if (this.crash?.seq === meta.seq && this.crash.at === "post_unrecorded") throw new Crash("post_unrecorded");
    await onSubmitted(hash);
    if (this.crash?.seq === meta.seq && this.crash.at === "post_recorded") throw new Crash("post_recorded");
    return hash;
  }
}

let b = 0;
const bet = (bettor: string, side: Side, amount: bigint): BetRecord => ({ bettor, side, amount, block: 10 + b, logIndex: b++, blockTime: 1 });

const BETS = () => {
  b = 0;
  return [bet(A, "YES", 53n), bet(B, "YES", 67n), bet(C, "NO", 40n), bet(A, "NO", 59n)];
};

function setup(dbFile: string, chain: FakeChain, marketId = 1) {
  const db = new DatabaseSync(dbFile);
  const store = new PayoutStore(db);
  const bets = BETS();
  const plan = planPayouts({ outcome: "YES", bets, closeTime: 1000 });
  const start: Record<string, bigint> = { [YES_POOL]: plan.outflow.YES, [NO_POOL]: plan.outflow.NO };
  if (!chain.balances.size) for (const [p, v] of Object.entries(start)) chain.balances.set(p, v);
  store.createPlan(marketId, "YES", plan.items, poolOf, start);
  return { db, store, plan };
}

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pythia-")), "t.sqlite");

test("happy path: every winner receives exactly the computed payout, pools end at zero", async () => {
  const chain = new FakeChain();
  const { store, plan, db } = setup(tmp(), chain);
  const r = await executePlan(store, chain, 1, silentLogger);
  assert.equal(r.sent, plan.items.length);
  for (const [who, amt] of Object.entries(plan.payoutByBettor)) assert.equal(chain.received.get(who), amt);
  assert.equal(chain.balances.get(YES_POOL), 0n);
  assert.equal(chain.balances.get(NO_POOL), 0n);
  assert.ok(store.getPlan(1)!.done);
  db.close();
});

test("re-running a finished plan sends nothing", async () => {
  const chain = new FakeChain();
  const { store, db } = setup(tmp(), chain);
  await executePlan(store, chain, 1, silentLogger);
  const sends = chain.applied.length;
  const r = await executePlan(store, chain, 1, silentLogger);
  assert.equal(r.sent, 0);
  assert.equal(chain.applied.length, sends);
  db.close();
});

test("resume after a crash at ANY point of ANY item never double pays and ends identical to a clean run", async () => {
  // Reference run.
  const refChain = new FakeChain();
  const ref = setup(tmp(), refChain);
  await executePlan(ref.store, refChain, 1, silentLogger);
  ref.db.close();
  const itemCount = ref.plan.items.length;
  assert.ok(itemCount >= 4);

  for (let seq = 0; seq < itemCount; seq++) {
    for (const at of ["pre", "post_unrecorded", "post_recorded"] as const) {
      const file = tmp();
      const chain = new FakeChain();
      chain.crash = { seq, at };

      // First process dies mid-payout.
      let s = setup(file, chain);
      await assert.rejects(executePlan(s.store, chain, 1, silentLogger), Crash, `crash ${seq}/${at}`);
      s.db.close();

      // Restart: fresh DB handle on the same file, no crash injected.
      chain.crash = null;
      s = setup(file, chain);
      await executePlan(s.store, chain, 1, silentLogger);
      s.db.close();

      const tag = `crash at item ${seq} (${at})`;
      assert.equal(chain.applied.length, itemCount, `${tag}: each item sent exactly once`);
      const keys = chain.applied.map((a) => `${a.pool}:${a.to}`);
      assert.equal(new Set(keys).size, keys.length, `${tag}: no duplicate transfer`);
      assert.deepEqual([...chain.received].sort(), [...refChain.received].sort(), `${tag}: same payouts as clean run`);
      assert.equal(chain.balances.get(YES_POOL), 0n, `${tag}: YES pool zero`);
      assert.equal(chain.balances.get(NO_POOL), 0n, `${tag}: NO pool zero`);
    }
  }
});

test("repeated crashes (every item crashes once) still pays each exactly once", async () => {
  const file = tmp();
  const chain = new FakeChain();
  let s = setup(file, chain);
  const itemCount = s.plan.items.length;
  s.db.close();
  for (let seq = 0; seq < itemCount; seq++) {
    chain.crash = { seq, at: seq % 2 ? "post_unrecorded" : "pre" };
    s = setup(file, chain);
    await assert.rejects(executePlan(s.store, chain, 1, silentLogger), Crash);
    s.db.close();
  }
  chain.crash = null;
  s = setup(file, chain);
  await executePlan(s.store, chain, 1, silentLogger);
  s.db.close();
  assert.equal(chain.applied.length, itemCount);
  assert.equal(chain.balances.get(YES_POOL), 0n);
  assert.equal(chain.balances.get(NO_POOL), 0n);
});

test("refuses to pay when the pool balance is inconsistent with the plan", async () => {
  const chain = new FakeChain();
  const { store, db } = setup(tmp(), chain);
  chain.balances.set(YES_POOL, 5n); // someone else moved funds
  await assert.rejects(executePlan(store, chain, 1, silentLogger), /Refusing to pay/);
  assert.equal(chain.applied.length, 0);
  db.close();
});

test("a plan is created once and never recomputed", () => {
  const chain = new FakeChain();
  const { store, db } = setup(tmp(), chain);
  const first = store.getPlan(1)!;
  const other = planPayouts({ outcome: "NO", bets: BETS(), closeTime: 1000 });
  const again = store.createPlan(1, "NO", other.items, poolOf, { [YES_POOL]: 1n });
  assert.equal(again.outcome, "YES");
  assert.deepEqual(again.items.map((i) => i.key), first.items.map((i) => i.key));
  db.close();
});

test("graceful stop pauses between items and resumes without duplicates", async () => {
  const file = tmp();
  const chain = new FakeChain();
  let s = setup(file, chain);
  let calls = 0;
  const r1 = await executePlan(s.store, chain, 1, silentLogger, () => calls++ >= 2);
  assert.ok(r1.stopped);
  assert.equal(r1.sent, 2);
  s.db.close();
  s = setup(file, chain);
  const r2 = await executePlan(s.store, chain, 1, silentLogger);
  assert.equal(chain.applied.length, s.plan.items.length);
  assert.equal(r2.sent, s.plan.items.length - 2);
  s.db.close();
});
