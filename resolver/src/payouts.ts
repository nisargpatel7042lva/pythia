/**
 * Parimutuel payout math (zero fee). Pure functions only: no I/O, fully unit-tested.
 *
 * Amounts are bigint eERC base units (EncryptedERC.decimals(), currently 2).
 *
 * Money layout: every bet sits in the pool account of the side it was placed on.
 *   YES outcome / NO outcome with winners:
 *     - the WINNING pool returns each winner's own stake                  (kind "stake")
 *     - the LOSING pool distributes its whole balance among the winners
 *       pro rata to stake: share_i = floor(stake_i * losing / winning)    (kind "share")
 *       the LAST winner receives losing - sum(previous shares), so all rounding dust goes to
 *       them and the losing pool ends at exactly zero.
 *     Winner payout = stake + share = stake + stake/winningTotal * losingTotal.
 *   INVALID outcome (resolved Invalid or market cancelled): every bet is refunded exactly,
 *     from the pool it was sent to                                        (kind "refund")
 *   No winners (nobody bet on the winning side): every bet is refunded    (kind "refund")
 *   One-sided market (everyone on the winning side): winners get their stake back, no shares.
 *   Late bets (mined at/after closeTime) are not part of the market and are refunded exactly
 *     from the pool they were sent to                                     (kind "late_refund")
 *
 * Items are aggregated per (pool, recipient, kind) and ordered deterministically, so the same
 * ledger always yields the same plan.
 */

export type Side = "YES" | "NO";
export type PlanOutcome = "YES" | "NO" | "INVALID";
export type ItemKind = "stake" | "share" | "refund" | "late_refund";

export interface BetRecord {
  bettor: string;
  side: Side;
  amount: bigint;
  /** Block number and log index give a total order of bets. */
  block: number;
  logIndex: number;
  blockTime: number;
}

export interface PayoutItem {
  /** Stable unique key within a market: kind:fromSide:recipient. */
  key: string;
  seq: number;
  /** Which pool pays (the pool for this side). */
  fromSide: Side;
  to: string;
  amount: bigint;
  kind: ItemKind;
}

export interface PayoutPlan {
  outcome: PlanOutcome;
  items: PayoutItem[];
  /** Total each pool must send out; equals everything that was ever bet into it. */
  outflow: Record<Side, bigint>;
  /** Total each recipient receives (lowercased address). */
  payoutByBettor: Record<string, bigint>;
  /** Counted-bet totals (excludes late bets). */
  totals: { yes: bigint; no: bigint };
}

const other = (s: Side): Side => (s === "YES" ? "NO" : "YES");
const cmpBet = (a: BetRecord, b: BetRecord) => a.block - b.block || a.logIndex - b.logIndex;

export function planPayouts(args: { outcome: PlanOutcome; bets: BetRecord[]; closeTime: number }): PayoutPlan {
  const { outcome, closeTime } = args;
  const bets = [...args.bets].sort(cmpBet);
  for (const b of bets) if (b.amount <= 0n) throw new Error(`non-positive bet amount ${b.amount}`);

  // Cancelled / invalid markets refund everything, late or not.
  const isCounted = (b: BetRecord) => outcome === "INVALID" || b.blockTime < closeTime;
  const counted = bets.filter(isCounted);
  const late = bets.filter((b) => !isCounted(b));

  // Recipient order = order of first bet (deterministic).
  const rank = new Map<string, number>();
  bets.forEach((b) => {
    const k = b.bettor.toLowerCase();
    if (!rank.has(k)) rank.set(k, rank.size);
  });

  const sumBy = (list: BetRecord[]) => {
    const m = new Map<string, bigint>(); // `${side}:${bettor}` -> total
    for (const b of list) {
      const k = `${b.side}:${b.bettor.toLowerCase()}`;
      m.set(k, (m.get(k) ?? 0n) + b.amount);
    }
    return m;
  };
  const total = (list: BetRecord[], side: Side) => list.filter((b) => b.side === side).reduce((s, b) => s + b.amount, 0n);

  const raw: Omit<PayoutItem, "seq">[] = [];
  const push = (kind: ItemKind, fromSide: Side, to: string, amount: bigint) => {
    if (amount > 0n) raw.push({ key: `${kind}:${fromSide}:${to.toLowerCase()}`, fromSide, to, amount, kind });
  };
  const refundAll = (list: BetRecord[], kind: ItemKind) => {
    for (const [k, amt] of sumBy(list)) {
      const [side, who] = k.split(":") as [Side, string];
      push(kind, side, who, amt);
    }
  };

  const totals = { yes: total(counted, "YES"), no: total(counted, "NO") };

  if (outcome === "INVALID") {
    refundAll(counted, "refund");
  } else {
    const win: Side = outcome;
    const lose = other(win);
    const W = win === "YES" ? totals.yes : totals.no;
    const L = lose === "YES" ? totals.yes : totals.no;
    if (W === 0n) {
      refundAll(counted, "refund"); // nobody to pay: refund everyone
    } else {
      const stakes = [...sumBy(counted.filter((b) => b.side === win))].map(([k, amt]) => ({ who: k.split(":")[1], amt }));
      stakes.sort((a, b) => rank.get(a.who)! - rank.get(b.who)!);
      let paid = 0n;
      stakes.forEach((s, i) => {
        push("stake", win, s.who, s.amt);
        const share = i === stakes.length - 1 ? L - paid : (s.amt * L) / W;
        paid += share;
        push("share", lose, s.who, share);
      });
      if (paid !== L) throw new Error(`share rounding broke conservation: ${paid} != ${L}`);
    }
    refundAll(late, "late_refund");
  }

  // Deterministic order: pool (YES first), then kind, then recipient rank.
  const kindOrder: Record<ItemKind, number> = { stake: 0, refund: 1, share: 2, late_refund: 3 };
  raw.sort(
    (a, b) =>
      (a.fromSide === b.fromSide ? 0 : a.fromSide === "YES" ? -1 : 1) ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      rank.get(a.to.toLowerCase())! - rank.get(b.to.toLowerCase())!,
  );
  const items = raw.map((r, seq) => ({ ...r, seq }));

  const outflow: Record<Side, bigint> = { YES: 0n, NO: 0n };
  const payoutByBettor: Record<string, bigint> = {};
  for (const it of items) {
    outflow[it.fromSide] += it.amount;
    const k = it.to.toLowerCase();
    payoutByBettor[k] = (payoutByBettor[k] ?? 0n) + it.amount;
  }

  // Pools must end at exactly zero: outflow == everything bet into the pool.
  const deposited: Record<Side, bigint> = { YES: total(bets, "YES"), NO: total(bets, "NO") };
  for (const s of ["YES", "NO"] as Side[]) {
    if (outflow[s] !== deposited[s]) {
      throw new Error(`${s} pool conservation violated: paying out ${outflow[s]} of ${deposited[s]}`);
    }
  }
  return { outcome, items, outflow, payoutByBettor, totals };
}
