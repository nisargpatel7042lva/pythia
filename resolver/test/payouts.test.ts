import test from "node:test";
import assert from "node:assert/strict";
import { planPayouts, type BetRecord, type Side } from "../src/payouts.js";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const D = "0x00000000000000000000000000000000000000d4";
const CLOSE = 1000;

let n = 0;
const bet = (bettor: string, side: Side, amount: bigint, blockTime = 500): BetRecord => ({
  bettor,
  side,
  amount,
  block: 100 + n,
  logIndex: n++,
  blockTime,
});

const pay = (plan: ReturnType<typeof planPayouts>, who: string) => plan.payoutByBettor[who.toLowerCase()] ?? 0n;

test("pro rata: winner payout = stake + stake/winningTotal * losingTotal", () => {
  // YES: A 100, B 300 (W=400). NO: C 200, D 100 (L=300). YES wins.
  const bets = [bet(A, "YES", 100n), bet(B, "YES", 300n), bet(C, "NO", 200n), bet(D, "NO", 100n)];
  const plan = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  assert.equal(pay(plan, A), 100n + 75n);
  assert.equal(pay(plan, B), 300n + 225n);
  assert.equal(pay(plan, C), 0n);
  assert.equal(pay(plan, D), 0n);
  assert.equal(plan.outflow.YES, 400n); // winning pool returns stakes
  assert.equal(plan.outflow.NO, 300n); // losing pool distributes
  // winning pool pays only stakes, losing pool pays only shares
  assert.ok(plan.items.filter((i) => i.fromSide === "YES").every((i) => i.kind === "stake"));
  assert.ok(plan.items.filter((i) => i.fromSide === "NO").every((i) => i.kind === "share"));
});

test("rounding: all dust goes to the last winner and pools end at exactly zero", () => {
  // Three equal winners of 1 unit, loser 10 units: floor(10/3)=3, 3, last gets 4.
  const bets = [bet(A, "YES", 1n), bet(B, "YES", 1n), bet(C, "YES", 1n), bet(D, "NO", 10n)];
  const plan = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  assert.equal(pay(plan, A), 1n + 3n);
  assert.equal(pay(plan, B), 1n + 3n);
  assert.equal(pay(plan, C), 1n + 4n); // last winner (by first-bet order) absorbs the dust
  assert.equal(plan.outflow.NO, 10n);
  assert.equal(plan.outflow.YES, 3n);
});

test("rounding with uneven stakes (live-test numbers)", () => {
  // W: A 53, B 67 (=120). L=99. floor(53*99/120)=43, B gets 99-43=56.
  const bets = [bet(A, "YES", 33n), bet(B, "YES", 67n), bet(A, "YES", 20n), bet(C, "NO", 40n), bet(D, "NO", 59n)];
  const plan = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  assert.equal(pay(plan, A), 53n + 43n);
  assert.equal(pay(plan, B), 67n + 56n);
  assert.equal(pay(plan, A) + pay(plan, B), 120n + 99n);
});

test("one-sided market: winners just get their stake back, no share items", () => {
  const bets = [bet(A, "YES", 100n), bet(B, "YES", 250n)];
  const plan = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  assert.equal(pay(plan, A), 100n);
  assert.equal(pay(plan, B), 250n);
  assert.ok(plan.items.every((i) => i.kind === "stake"));
  assert.equal(plan.outflow.NO, 0n);
});

test("no winners (everyone bet the losing side): refund everyone", () => {
  const bets = [bet(A, "NO", 100n), bet(B, "NO", 50n), bet(A, "NO", 25n)];
  const plan = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  assert.equal(pay(plan, A), 125n);
  assert.equal(pay(plan, B), 50n);
  assert.ok(plan.items.every((i) => i.kind === "refund" && i.fromSide === "NO"));
});

test("invalid outcome: every bettor refunded their exact stake from the pool they paid into", () => {
  // A bet on both sides.
  const bets = [bet(A, "YES", 100n), bet(A, "NO", 40n), bet(B, "NO", 60n), bet(C, "YES", 7n)];
  const plan = planPayouts({ outcome: "INVALID", bets, closeTime: CLOSE });
  assert.equal(pay(plan, A), 140n);
  assert.equal(pay(plan, B), 60n);
  assert.equal(pay(plan, C), 7n);
  const aItems = plan.items.filter((i) => i.to === A.toLowerCase());
  assert.deepEqual(aItems.map((i) => [i.fromSide, i.amount]).sort(), [["NO", 40n], ["YES", 100n]]);
  assert.equal(plan.outflow.YES, 107n);
  assert.equal(plan.outflow.NO, 100n);
});

test("invalid outcome refunds even bets mined after closeTime", () => {
  const bets = [bet(A, "YES", 10n, 500), bet(B, "NO", 20n, 2000)];
  const plan = planPayouts({ outcome: "INVALID", bets, closeTime: CLOSE });
  assert.equal(pay(plan, B), 20n);
});

test("late bets are excluded from the market and refunded exactly", () => {
  const bets = [bet(A, "YES", 100n), bet(B, "NO", 100n), bet(C, "YES", 50n, CLOSE), bet(D, "NO", 30n, CLOSE + 5)];
  const plan = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  assert.deepEqual(plan.totals, { yes: 100n, no: 100n });
  assert.equal(pay(plan, A), 200n); // 100 stake + 100 share
  assert.equal(pay(plan, C), 50n); // late: refunded
  assert.equal(pay(plan, D), 30n);
  assert.equal(plan.items.find((i) => i.to === C.toLowerCase())!.kind, "late_refund");
  assert.equal(plan.outflow.YES, 150n);
  assert.equal(plan.outflow.NO, 130n);
});

test("a bettor on both sides who wins one: stake from the winning pool + share, losing stake is lost", () => {
  const bets = [bet(A, "YES", 100n), bet(A, "NO", 50n), bet(B, "NO", 150n)];
  const plan = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  assert.equal(pay(plan, A), 100n + 200n); // L = 200 all to the only winner
  assert.equal(pay(plan, B), 0n);
});

test("empty market produces an empty plan", () => {
  const plan = planPayouts({ outcome: "YES", bets: [], closeTime: CLOSE });
  assert.equal(plan.items.length, 0);
});

test("plan is deterministic regardless of input order", () => {
  const bets = [bet(A, "YES", 33n), bet(B, "YES", 67n), bet(C, "NO", 40n), bet(D, "NO", 59n), bet(A, "YES", 20n)];
  const p1 = planPayouts({ outcome: "YES", bets, closeTime: CLOSE });
  const p2 = planPayouts({ outcome: "YES", bets: [...bets].reverse(), closeTime: CLOSE });
  assert.deepEqual(
    p1.items.map((i) => [i.key, i.amount, i.seq]),
    p2.items.map((i) => [i.key, i.amount, i.seq]),
  );
});

test("item keys are unique and amounts positive", () => {
  const bets = [bet(A, "YES", 5n), bet(A, "NO", 5n), bet(B, "YES", 5n), bet(B, "NO", 5n)];
  for (const outcome of ["YES", "NO", "INVALID"] as const) {
    const plan = planPayouts({ outcome, bets, closeTime: CLOSE });
    assert.equal(new Set(plan.items.map((i) => i.key)).size, plan.items.length);
    assert.ok(plan.items.every((i) => i.amount > 0n));
  }
});

test("rejects non-positive bets", () => {
  assert.throws(() => planPayouts({ outcome: "YES", bets: [bet(A, "YES", 0n)], closeTime: CLOSE }));
});

test("fuzz: conservation holds for random markets (pools end at zero, total paid == total bet)", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const people = [A, B, C, D];
  for (let round = 0; round < 500; round++) {
    const bets: BetRecord[] = [];
    const count = Math.floor(rnd() * 12);
    for (let i = 0; i < count; i++) {
      bets.push(
        bet(people[Math.floor(rnd() * 4)], rnd() < 0.5 ? "YES" : "NO", BigInt(1 + Math.floor(rnd() * 5000)), rnd() < 0.85 ? 500 : 1500),
      );
    }
    for (const outcome of ["YES", "NO", "INVALID"] as const) {
      const plan = planPayouts({ outcome, bets, closeTime: CLOSE }); // throws on any conservation break
      const totalBet = bets.reduce((s, b) => s + b.amount, 0n);
      const totalPaid = Object.values(plan.payoutByBettor).reduce((s, v) => s + v, 0n);
      assert.equal(totalPaid, totalBet, `round ${round} ${outcome}`);
    }
  }
});
