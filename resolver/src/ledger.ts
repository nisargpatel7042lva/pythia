/**
 * Bet ledger. Watches EncryptedERC `PrivateTransfer` events whose recipient is a known pool
 * account, decrypts each bet amount with that pool's eERC key and records it in SQLite.
 *
 * How the amount is recovered: the event itself only carries the AUDITOR's ciphertext. The
 * recipient's own ciphertext (the "amount PCT") is part of the transfer proof's public signals in
 * the transaction calldata (signals 16..22). It is encrypted to the pool's eERC public key, so
 * only the holder of the pool key (the resolver) can read it.
 *
 * Idempotency: bets are keyed by UNIQUE(tx_hash, log_index) and inserted with INSERT OR IGNORE, so
 * re-processing any block range never duplicates rows; the stored cursor only saves work.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { ENCRYPTED_ERC_ABI, readEncryptedBalance, type EercClient } from "@pythia/eerc-core";
import type { BaseConfig } from "./config.js";
import { makeEercClient } from "./eerc.js";
import type { Keystore, PoolMeta, Side } from "./keystore.js";

const AMOUNT_PCT_FIRST = 16; // proof.publicSignals[16..22] = receiver's amount PCT
const MAX_PLAUSIBLE_AMOUNT = 10n ** 12n; // eERC units; larger means a wrong key / bad parse

export interface Bet {
  marketId: number;
  side: Side;
  bettor: string;
  pool: string;
  amount: bigint; // eERC base units (EncryptedERC.decimals())
  txHash: string;
  logIndex: number;
  block: number;
  blockTime: number;
}

interface KnownPool {
  meta: PoolMeta;
  client: EercClient;
}

export class Ledger {
  readonly db: DatabaseSync;
  /** Timestamp of the chain head block the ledger last synced up to (0 before the first sync). */
  headTime = 0;
  private provider: ethers.JsonRpcProvider;
  private iface = new ethers.Interface(ENCRYPTED_ERC_ABI);
  private known = new Map<string, KnownPool>();
  /** eth_getLogs window. Public Fuji RPC currently caps it at 100 blocks; shrinks further if needed. */
  private logChunk = 100;

  constructor(
    private cfg: BaseConfig,
    private keystore: Keystore,
  ) {
    fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
    this.db = new DatabaseSync(cfg.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS bets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id  INTEGER NOT NULL,
        side       TEXT    NOT NULL CHECK (side IN ('YES','NO')),
        bettor     TEXT    NOT NULL,
        pool       TEXT    NOT NULL,
        amount     TEXT    NOT NULL,
        tx_hash    TEXT    NOT NULL,
        log_index  INTEGER NOT NULL,
        block      INTEGER NOT NULL,
        block_time INTEGER NOT NULL,
        UNIQUE (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS bets_market ON bets (market_id, side);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.provider = new ethers.JsonRpcProvider(cfg.rpcUrl, undefined, { staticNetwork: true });
  }

  close() {
    this.db.close();
  }

  // ───────────────────────────── pools ─────────────────────────────
  private async loadPools(): Promise<KnownPool[]> {
    for (const meta of this.keystore.list()) {
      if (!meta.marketId || !meta.side) continue; // not attached to a market yet
      const key = meta.address.toLowerCase();
      if (this.known.has(key)) continue;
      const { secrets } = this.keystore.load(meta.address);
      const client = await makeEercClient(this.cfg, secrets.privateKey, secrets.eercDecryptionKey);
      this.known.set(key, { meta, client });
    }
    return [...this.known.values()];
  }

  // ───────────────────────────── syncing ───────────────────────────
  private getCursor(): number | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'cursor'").get() as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }

  private setCursor(block: number) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(block));
  }

  /** Process [from, to]; safe to call repeatedly over overlapping ranges. Returns counts. */
  async syncRange(from: number, to: number, onChunkDone?: (end: number) => void): Promise<{ inserted: number; skipped: number }> {
    const pools = await this.loadPools();
    let inserted = 0;
    let skipped = 0;
    if (pools.length === 0) return { inserted, skipped };

    const topic = this.iface.getEvent("PrivateTransfer")!.topicHash;
    const poolTopics = pools.map((p) => ethers.zeroPadValue(p.meta.address, 32));

    for (let start = from; start <= to; ) {
      const end = Math.min(start + this.logChunk - 1, to);
      let logs: ethers.Log[];
      try {
        logs = await this.provider.getLogs({
          address: this.cfg.eerc.encryptedERC,
          topics: [topic, null, poolTopics],
          fromBlock: start,
          toBlock: end,
        });
      } catch (e) {
        // Public RPCs cap eth_getLogs ranges (and change the cap). Halve the window and retry.
        if (/block range|range (is )?too (large|wide)|too many (results|blocks)|limit exceeded/i.test(String((e as Error).message)) && this.logChunk > 10) {
          this.logChunk = Math.max(10, Math.floor(this.logChunk / 2));
          continue;
        }
        throw e;
      }
      for (const log of logs) {
        const r = await this.processLog(log);
        if (r) inserted++;
        else skipped++;
      }
      start = end + 1;
      onChunkDone?.(end); // progress survives a later failure
      if (start <= to) await new Promise((res) => setTimeout(res, 450)); // be gentle with public RPCs
    }
    return { inserted, skipped };
  }

  /** From the stored cursor (or the earliest pool creation block) up to the chain head. */
  async sync(): Promise<{ from: number; to: number; inserted: number; skipped: number }> {
    const pools = await this.loadPools();
    const earliest = Math.min(...pools.map((p) => p.meta.createdBlock ?? 0));
    const cursor = this.getCursor();
    const from = cursor !== null ? cursor + 1 : earliest;
    const head = (await this.provider.getBlock("latest"))!;
    const to = head.number;
    if (pools.length === 0 || from > to) {
      this.headTime = head.timestamp;
      return { from, to, inserted: 0, skipped: 0 };
    }
    const r = await this.syncRange(from, to, (end) => this.setCursor(end));
    this.headTime = head.timestamp; // all bets mined up to this block's time are now in the ledger
    return { from, to, ...r };
  }

  async watch(intervalMs: number, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const r = await this.sync();
        if (r.inserted) console.log(`[ledger] +${r.inserted} bets (blocks ${r.from}-${r.to})`);
      } catch (e) {
        console.error("[ledger] sync error:", (e as Error).message);
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
  }

  // ───────────────────────────── one log ───────────────────────────
  /** Returns true if a new row was inserted, false if it already existed. */
  private async processLog(log: ethers.Log): Promise<boolean> {
    const parsed = this.iface.parseLog(log)!;
    const pool = this.known.get((parsed.args.to as string).toLowerCase());
    if (!pool) throw new Error(`log for unknown pool ${parsed.args.to}`);

    const tx = await this.provider.getTransaction(log.transactionHash);
    if (!tx) throw new Error(`tx ${log.transactionHash} not found`);
    const call = this.iface.parseTransaction({ data: tx.data });
    if (call?.name !== "transfer" || (call.args.to as string).toLowerCase() !== pool.meta.address.toLowerCase()) {
      // e.g. transfer routed through another contract; its calldata has no readable proof.
      throw new Error(`tx ${log.transactionHash}: cannot read transfer calldata (name=${call?.name})`);
    }
    const signals: bigint[] = [...call.args.proof.publicSignals].map((x: bigint) => BigInt(x));
    const pct = signals.slice(AMOUNT_PCT_FIRST, AMOUNT_PCT_FIRST + 7);
    const amount = BigInt(pool.client.eerc.decryptPCT(pct));
    if (amount <= 0n || amount > MAX_PLAUSIBLE_AMOUNT) {
      throw new Error(`tx ${log.transactionHash}: implausible decrypted amount ${amount}; refusing to record`);
    }

    const block = await this.provider.getBlock(log.blockNumber);
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO bets (market_id, side, bettor, pool, amount, tx_hash, log_index, block, block_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Number(pool.meta.marketId),
        pool.meta.side!,
        parsed.args.from as string,
        pool.meta.address,
        amount.toString(),
        log.transactionHash,
        log.index,
        log.blockNumber,
        block?.timestamp ?? 0,
      );
    return Number(res.changes) > 0;
  }

  // ───────────────────────────── queries ───────────────────────────
  bets(marketId?: number): Bet[] {
    const rows = (
      marketId === undefined
        ? this.db.prepare("SELECT * FROM bets ORDER BY block, log_index").all()
        : this.db.prepare("SELECT * FROM bets WHERE market_id = ? ORDER BY block, log_index").all(marketId)
    ) as Record<string, string | number>[];
    return rows.map((r) => ({
      marketId: Number(r.market_id),
      side: r.side as Side,
      bettor: String(r.bettor),
      pool: String(r.pool),
      amount: BigInt(r.amount),
      txHash: String(r.tx_hash),
      logIndex: Number(r.log_index),
      block: Number(r.block),
      blockTime: Number(r.block_time),
    }));
  }

  /**
   * Transactions involving an address: bets it placed and payouts it received. Hashes only, so a
   * client can fetch each transaction and decrypt its own amounts locally.
   */
  accountActivity(address: string): { kind: "bet" | "payout"; marketId: number; side: Side; txHash: string }[] {
    const a = address.toLowerCase();
    const out: { kind: "bet" | "payout"; marketId: number; side: Side; txHash: string }[] = [];
    for (const r of this.db.prepare("SELECT market_id, side, tx_hash FROM bets WHERE lower(bettor) = ? ORDER BY block, log_index").all(a) as Record<string, string | number>[]) {
      out.push({ kind: "bet", marketId: Number(r.market_id), side: r.side as Side, txHash: String(r.tx_hash) });
    }
    try {
      for (const r of this.db
        .prepare("SELECT market_id, from_side, tx_hash FROM payout_items WHERE lower(recipient) = ? AND status = 'confirmed' AND tx_hash IS NOT NULL ORDER BY market_id, seq")
        .all(a) as Record<string, string | number>[]) {
        out.push({ kind: "payout", marketId: Number(r.market_id), side: r.from_side as Side, txHash: String(r.tx_hash) });
      }
    } catch {
      // payout tables do not exist until the first settlement
    }
    return out;
  }

  totals(marketId: number): { yes: bigint; no: bigint; count: number } {
    let yes = 0n;
    let no = 0n;
    const bets = this.bets(marketId);
    for (const b of bets) (b.side === "YES" ? (yes += b.amount) : (no += b.amount));
    return { yes, no, count: bets.length };
  }

  /**
   * Cross-check: for each known pool, ledger sum vs the pool's own on-chain encrypted balance
   * (decrypted with the pool key). Equal means the ledger captured every bet.
   */
  async verifyAgainstChain(): Promise<{ pool: string; side: Side; marketId: number; ledger: bigint; onChain: bigint; ok: boolean }[]> {
    const out = [];
    for (const p of await this.loadPools()) {
      const ledger = this.bets(Number(p.meta.marketId))
        .filter((b) => b.pool.toLowerCase() === p.meta.address.toLowerCase())
        .reduce((s, b) => s + b.amount, 0n);
      const onChain = (await readEncryptedBalance(p.client)).total;
      out.push({ pool: p.meta.address, side: p.meta.side!, marketId: Number(p.meta.marketId), ledger, onChain, ok: ledger === onChain });
    }
    return out;
  }
}
