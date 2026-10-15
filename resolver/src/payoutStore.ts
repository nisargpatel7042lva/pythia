/**
 * SQLite persistence for payout plans and per-item progress.
 *
 * A plan is created exactly once per market and never recomputed; execution resumes from the
 * stored item states. Item states: planned -> sending -> submitted -> confirmed.
 */
import type { DatabaseSync } from "node:sqlite";
import type { ItemKind, PayoutItem, PlanOutcome, Side } from "./payouts.js";

export type ItemStatus = "planned" | "sending" | "submitted" | "confirmed";

export interface StoredItem extends PayoutItem {
  marketId: number;
  pool: string;
  status: ItemStatus;
  txHash: string | null;
}

export interface StoredPlan {
  marketId: number;
  outcome: PlanOutcome;
  createdAt: string;
  done: boolean;
  /** Decrypted pool balance at plan time, by pool address (lowercase). */
  startBalances: Record<string, bigint>;
  items: StoredItem[];
}

export class PayoutStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS payout_plans (
        market_id  INTEGER PRIMARY KEY,
        outcome    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        done       INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS payout_pools (
        market_id     INTEGER NOT NULL,
        pool          TEXT NOT NULL,
        start_balance TEXT NOT NULL,
        PRIMARY KEY (market_id, pool)
      );
      CREATE TABLE IF NOT EXISTS payout_items (
        market_id  INTEGER NOT NULL,
        seq        INTEGER NOT NULL,
        item_key   TEXT NOT NULL,
        from_side  TEXT NOT NULL,
        pool       TEXT NOT NULL,
        recipient  TEXT NOT NULL,
        amount     TEXT NOT NULL,
        kind       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'planned',
        tx_hash    TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (market_id, seq),
        UNIQUE (market_id, item_key)
      );
    `);
  }

  getPlan(marketId: number): StoredPlan | null {
    const p = this.db.prepare("SELECT * FROM payout_plans WHERE market_id = ?").get(marketId) as
      | { outcome: string; created_at: string; done: number }
      | undefined;
    if (!p) return null;
    const startBalances: Record<string, bigint> = {};
    for (const r of this.db.prepare("SELECT pool, start_balance FROM payout_pools WHERE market_id = ?").all(marketId) as {
      pool: string;
      start_balance: string;
    }[]) {
      startBalances[r.pool.toLowerCase()] = BigInt(r.start_balance);
    }
    const items = (
      this.db.prepare("SELECT * FROM payout_items WHERE market_id = ? ORDER BY seq").all(marketId) as Record<string, string | number | null>[]
    ).map((r) => ({
      marketId,
      seq: Number(r.seq),
      key: String(r.item_key),
      fromSide: r.from_side as Side,
      pool: String(r.pool),
      to: String(r.recipient),
      amount: BigInt(r.amount as string),
      kind: r.kind as ItemKind,
      status: r.status as ItemStatus,
      txHash: (r.tx_hash as string | null) ?? null,
    }));
    return { marketId, outcome: p.outcome as PlanOutcome, createdAt: p.created_at, done: !!p.done, startBalances, items };
  }

  /** Create the plan atomically unless one already exists; returns the stored plan either way. */
  createPlan(
    marketId: number,
    outcome: PlanOutcome,
    items: PayoutItem[],
    poolOf: Record<Side, string>,
    startBalances: Record<string, bigint>,
  ): StoredPlan {
    const existing = this.getPlan(marketId);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO payout_plans (market_id, outcome, created_at) VALUES (?, ?, ?)").run(marketId, outcome, now);
      for (const [pool, bal] of Object.entries(startBalances)) {
        this.db.prepare("INSERT INTO payout_pools (market_id, pool, start_balance) VALUES (?, ?, ?)").run(marketId, pool.toLowerCase(), bal.toString());
      }
      const ins = this.db.prepare(
        `INSERT INTO payout_items (market_id, seq, item_key, from_side, pool, recipient, amount, kind, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)`,
      );
      for (const it of items) {
        ins.run(marketId, it.seq, it.key, it.fromSide, poolOf[it.fromSide].toLowerCase(), it.to, it.amount.toString(), it.kind, now);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.getPlan(marketId)!;
  }

  setItem(marketId: number, seq: number, status: ItemStatus, txHash?: string | null) {
    this.db
      .prepare("UPDATE payout_items SET status = ?, tx_hash = COALESCE(?, tx_hash), updated_at = ? WHERE market_id = ? AND seq = ?")
      .run(status, txHash ?? null, new Date().toISOString(), marketId, seq);
  }

  markDone(marketId: number) {
    this.db.prepare("UPDATE payout_plans SET done = 1 WHERE market_id = ?").run(marketId);
  }
}
