/**
 * Crash-safe execution of a stored payout plan.
 *
 * Invariant that prevents double payment: before every send, the pool's ACTUAL decrypted
 * on-chain balance must equal  startBalance - (sum of items already confirmed from that pool).
 *  - balance == expected            -> this item was not sent yet, send it.
 *  - balance == expected - amount   -> this item WAS already sent (we crashed before recording
 *                                      it): mark it confirmed, never resend.
 *  - anything else                  -> refuse and raise; a human must look.
 * Before reconciling, any pending transaction from the pool is allowed to land first, so a
 * broadcast-but-unmined transfer cannot be mistaken for "not sent".
 */
import { PayoutStore, type StoredItem } from "./payoutStore.js";
import type { Logger } from "./log.js";

export interface PoolExecutor {
  /** Decrypted eERC balance of the pool account (base units). */
  poolBalance(pool: string): Promise<bigint>;
  /** Resolve once the pool account has no pending transactions. */
  waitIdle(pool: string): Promise<void>;
  txStatus(hash: string): Promise<"confirmed" | "failed" | "unknown">;
  /** Best effort: find the tx hash of an already-sent transfer pool -> to, excluding known hashes. */
  findSentTx(pool: string, to: string, exclude: Set<string>): Promise<string | null>;
  /**
   * Send a private transfer. `onSubmitted` must be awaited right after broadcast so the hash is
   * persisted. Resolves with the tx hash once confirmed.
   */
  send(
    pool: string,
    to: string,
    amount: bigint,
    onSubmitted: (hash: string) => Promise<void> | void,
    meta: { marketId: number; seq: number },
  ): Promise<string>;
}

export interface ExecuteResult {
  sent: number;
  recovered: number;
  alreadyDone: number;
  stopped: boolean;
}

export async function executePlan(
  store: PayoutStore,
  exec: PoolExecutor,
  marketId: number,
  logger: Logger,
  shouldStop: () => boolean = () => false,
): Promise<ExecuteResult> {
  const plan = store.getPlan(marketId);
  if (!plan) throw new Error(`no payout plan for market ${marketId}`);
  const res: ExecuteResult = { sent: 0, recovered: 0, alreadyDone: 0, stopped: false };
  const total = plan.items.length;

  const label = (it: StoredItem) =>
    `item ${it.seq + 1}/${total} ${it.kind} ${it.amount} -> ${it.to} (from ${it.fromSide} pool)`;

  for (const item of plan.items) {
    // Re-read state each iteration (earlier items may have changed confirmed totals).
    const cur = store.getPlan(marketId)!.items[item.seq];
    if (cur.status === "confirmed") {
      res.alreadyDone++;
      continue;
    }
    if (shouldStop()) {
      res.stopped = true;
      logger.warn(`market ${marketId}: stop requested, payout paused before ${label(cur)}`);
      return res;
    }

    await exec.waitIdle(cur.pool);

    if (cur.status === "submitted" && cur.txHash) {
      const st = await exec.txStatus(cur.txHash);
      if (st === "confirmed") {
        store.setItem(marketId, cur.seq, "confirmed");
        res.alreadyDone++;
        logger.tx(`market ${marketId}: ${label(cur)} was already confirmed`, cur.txHash);
        continue;
      }
    }

    const fresh = store.getPlan(marketId)!;
    const confirmedOut = fresh.items
      .filter((i) => i.pool === cur.pool && i.status === "confirmed")
      .reduce((s, i) => s + i.amount, 0n);
    const expectedBefore = fresh.startBalances[cur.pool.toLowerCase()] - confirmedOut;
    const bal = await exec.poolBalance(cur.pool);

    if (bal === expectedBefore - cur.amount) {
      const known = new Set(fresh.items.map((i) => i.txHash).filter((h): h is string => !!h));
      const hash = cur.txHash ?? (await exec.findSentTx(cur.pool, cur.to, known));
      store.setItem(marketId, cur.seq, "confirmed", hash);
      res.recovered++;
      logger.warn(`market ${marketId}: ${label(cur)} had already been sent before a restart; NOT resending${hash ? ` (${hash})` : ""}`);
      continue;
    }
    if (bal !== expectedBefore) {
      throw new Error(
        `market ${marketId} ${label(cur)}: pool balance ${bal} is neither the expected ${expectedBefore} (unsent) nor ${expectedBefore - cur.amount} (sent). Refusing to pay.`,
      );
    }

    store.setItem(marketId, cur.seq, "sending");
    logger.info(`market ${marketId}: sending ${label(cur)}`);
    const t0 = Date.now();
    const hash = await exec.send(
      cur.pool,
      cur.to,
      cur.amount,
      (h) => store.setItem(marketId, cur.seq, "submitted", h),
      { marketId, seq: cur.seq },
    );
    store.setItem(marketId, cur.seq, "confirmed", hash);
    res.sent++;
    logger.tx(`market ${marketId}: ${label(cur)} confirmed in ${((Date.now() - t0) / 1000).toFixed(1)}s`, hash);
  }

  store.markDone(marketId);
  return res;
}
