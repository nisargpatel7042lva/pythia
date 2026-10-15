/**
 * The resolver's market loop. One `tick()` syncs the ledger, then advances every market that has
 * pool accounts in this resolver's keystore through its lifecycle:
 *
 *   Open      -> publish totals when >= K new bets (after cross-checking the ledger against the
 *                decrypted on-chain pool balances); close once closeTime has passed
 *   Closed    -> final publish, then resolve (PriceFeed automatically; Manual via the CLI)
 *   Resolved / Cancelled -> build a payout plan, pay it out, assert both pools are empty,
 *                markSettled
 *   Settled   -> nothing
 *
 * Every step is idempotent, so a crash at any point just means the next tick picks up again.
 */
import { ethers } from "ethers";
import type { BaseConfig } from "./config.js";
import { loadMarketsAbi } from "./config.js";
import type { Keystore, PoolMeta } from "./keystore.js";
import type { Ledger, Bet } from "./ledger.js";
import type { Logger } from "./log.js";
import { PayoutStore } from "./payoutStore.js";
import { planPayouts, type PlanOutcome, type Side } from "./payouts.js";
import { executePlan, type PoolExecutor } from "./settlement.js";

export const Status = { Open: 0, Closed: 1, Resolved: 2, Settled: 3, Cancelled: 4 } as const;
export const OutcomeCode = { Unresolved: 0, Yes: 1, No: 2, Invalid: 3 } as const;
const STATUS_NAMES = ["Open", "Closed", "Resolved", "Settled", "Cancelled"];

interface MarketView {
  id: number;
  question: string;
  closeTime: number;
  status: number;
  outcome: number;
  resolutionType: number; // 0 Manual, 1 PriceFeed
  publishedYes: bigint;
  publishedNo: bigint;
  publishedCount: number;
}

interface Pools {
  yes: PoolMeta;
  no: PoolMeta;
}

const fmt = (v: bigint) => ethers.formatUnits(v, 2); // EncryptedERC decimals = 2

export class Engine {
  readonly store: PayoutStore;
  private markets: ethers.Contract;
  private provider: ethers.JsonRpcProvider;
  private stopping = false;
  private logged = new Set<string>();

  constructor(
    private cfg: BaseConfig,
    private keystore: Keystore,
    private ledger: Ledger,
    private executor: PoolExecutor,
    resolver: ethers.Wallet,
    private logger: Logger,
  ) {
    this.provider = resolver.provider as ethers.JsonRpcProvider;
    this.markets = new ethers.Contract(cfg.marketsAddress, loadMarketsAbi() as ethers.InterfaceAbi, resolver);
    this.store = new PayoutStore(ledger.db);
  }

  stop() {
    this.stopping = true;
  }

  private once(key: string, msg: string) {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    this.logger.info(msg);
  }

  // ───────────────────────────── loop ──────────────────────────────
  async tick() {
    await this.ledger.sync();
    const count = Number(await this.markets.getMarketCount());
    await this.tagNewPools(count).catch((e) => this.logger.error(`tagging pools: ${(e as Error).message}`));
    for (let id = 0; id < count && !this.stopping; id++) {
      try {
        await this.processMarket(id);
      } catch (e) {
        this.logger.error(`market ${id}: ${(e as Error).message}`);
      }
    }
  }

  /** Number of distinct markets this keystore has pool accounts for. */
  trackedMarkets(): number {
    return new Set(this.keystore.list().filter((m) => m.marketId).map((m) => m.marketId)).size;
  }

  /**
   * Pools created through the admin API have no market yet. Once the owner creates the market
   * on-chain, find it by pool address and attach the pools to it.
   */
  private async tagNewPools(count: number) {
    const metas = this.keystore.list();
    const untagged = metas.filter((m) => !m.marketId);
    if (untagged.length === 0) return;
    const tagged = new Set(metas.filter((m) => m.marketId).map((m) => m.marketId));
    for (let id = 0; id < count; id++) {
      if (tagged.has(String(id))) continue;
      const m = await this.markets.getMarket(id);
      for (const [side, pool] of [["YES", m.yesPool], ["NO", m.noPool]] as const) {
        const meta = untagged.find((u) => u.address.toLowerCase() === String(pool).toLowerCase());
        if (meta) {
          this.keystore.updateMeta(meta.address, { marketId: String(id), side });
          this.logger.info(`market ${id}: attached ${side} pool ${meta.address}`);
        }
      }
    }
  }

  private poolsFor(id: number): Pools | null {
    const metas = this.keystore.list().filter((m) => m.marketId === String(id));
    const yes = metas.find((m) => m.side === "YES");
    const no = metas.find((m) => m.side === "NO");
    return yes && no ? { yes, no } : null;
  }

  private async readMarket(id: number): Promise<MarketView> {
    const m = await this.markets.getMarket(id);
    return {
      id,
      question: m.question,
      closeTime: Number(m.closeTime),
      status: Number(m.status),
      outcome: Number(m.outcome),
      resolutionType: Number(m.resolutionType),
      publishedYes: BigInt(m.publishedYesTotal),
      publishedNo: BigInt(m.publishedNoTotal),
      publishedCount: Number(m.publishedBetCount),
    };
  }

  async processMarket(id: number) {
    const pools = this.poolsFor(id);
    if (!pools) return; // not one of ours
    let m = await this.readMarket(id);
    if (m.status === Status.Settled) return;

    if (m.status === Status.Open) {
      const head = (await this.provider.getBlock("latest"))!;
      if (head.timestamp >= m.closeTime) {
        await this.closeMarket(m);
        m = await this.readMarket(id);
      } else {
        await this.tryPublish(m, pools);
        return;
      }
    }
    if (m.status === Status.Closed) return this.handleClosed(m, pools);
    if (m.status === Status.Resolved || m.status === Status.Cancelled) return this.settle(m, pools);
  }

  // ───────────────────────────── helpers ───────────────────────────
  private async send(label: string, fn: () => Promise<ethers.ContractTransactionResponse>) {
    const tx = await fn();
    await tx.wait();
    this.logger.tx(label, tx.hash);
    return tx.hash;
  }

  private counted(m: MarketView): Bet[] {
    return this.ledger.bets(m.id).filter((b) => b.blockTime < m.closeTime);
  }

  private totalsOf(bets: Bet[]) {
    let yes = 0n;
    let no = 0n;
    for (const b of bets) (b.side === "YES" ? (yes += b.amount) : (no += b.amount));
    return { yes, no };
  }

  /**
   * Cross-check: the ledger's per-pool sum of ALL bets must equal the pool's decrypted on-chain
   * encrypted balance. Retries once after a re-sync (a bet may have landed mid-check).
   */
  private async crossCheck(m: MarketView, pools: Pools): Promise<{ ok: boolean; chain: { YES: bigint; NO: bigint } }> {
    let chain = { YES: 0n, NO: 0n };
    for (let attempt = 0; attempt < 2; attempt++) {
      const all = this.ledger.bets(m.id);
      const led = { YES: 0n, NO: 0n };
      for (const b of all) led[b.side] += b.amount;
      chain = { YES: await this.executor.poolBalance(pools.yes.address), NO: await this.executor.poolBalance(pools.no.address) };
      if (led.YES === chain.YES && led.NO === chain.NO) return { ok: true, chain };
      if (attempt === 0) {
        await this.ledger.sync();
        continue;
      }
      this.logger.error(
        `market ${m.id}: LEDGER/CHAIN MISMATCH. ledger YES ${fmt(led.YES)} NO ${fmt(led.NO)} vs on-chain decrypted YES ${fmt(chain.YES)} NO ${fmt(chain.NO)}. Not proceeding.`,
      );
    }
    return { ok: false, chain };
  }

  // ───────────────────────────── publishing ────────────────────────
  private async tryPublish(m: MarketView, pools: Pools) {
    const onChainK = Number(await this.markets.minBatchSize());
    const K = Math.max(this.cfg.batchMinBets, onChainK);
    const bets = this.counted(m);
    const fresh = bets.length - m.publishedCount;
    if (fresh < K) return;
    const cc = await this.crossCheck(m, pools);
    if (!cc.ok) return;
    await this.publish(m, bets);
  }

  private async publish(m: MarketView, bets: Bet[]) {
    const t = this.totalsOf(bets);
    await this.send(
      `market ${m.id}: published totals YES ${fmt(t.yes)} NO ${fmt(t.no)} (${bets.length} bets)`,
      () => this.markets.publishTotals(m.id, t.yes, t.no, bets.length),
    );
  }

  /** True when the on-chain published totals are final (match the ledger's counted bets). */
  private async ensureFinalPublish(m: MarketView, pools: Pools): Promise<boolean> {
    const bets = this.counted(m);
    if (bets.length < m.publishedCount) {
      this.logger.error(`market ${m.id}: ledger has ${bets.length} bets but ${m.publishedCount} were published; refusing to continue`);
      return false;
    }
    if (bets.length === m.publishedCount) {
      const t = this.totalsOf(bets);
      if (t.yes !== m.publishedYes || t.no !== m.publishedNo) {
        this.logger.error(`market ${m.id}: published totals differ from the ledger at equal bet count`);
        return false;
      }
      return true;
    }
    const cc = await this.crossCheck(m, pools);
    if (!cc.ok) return false;
    await this.publish(m, bets);
    return true;
  }

  // ───────────────────────────── closing / resolution ──────────────
  private async closeMarket(m: MarketView) {
    await this.send(`market ${m.id}: closed (closeTime reached)`, () => this.markets.closeMarket(m.id));
  }

  private async handleClosed(m: MarketView, pools: Pools) {
    if (this.ledger.headTime < m.closeTime) {
      this.once(`wait-ledger-${m.id}`, `market ${m.id}: waiting for the ledger to sync past closeTime`);
      return;
    }
    if (!(await this.ensureFinalPublish(m, pools))) return;

    if (m.resolutionType === 1) {
      try {
        await this.send(`market ${m.id}: resolved from the Chainlink price feed`, () => this.markets.resolveWithPriceFeed(m.id));
        const after = await this.readMarket(m.id);
        this.logger.info(`market ${m.id}: outcome ${["Unresolved", "Yes", "No", "Invalid"][after.outcome]}`);
      } catch (e) {
        this.logger.warn(`market ${m.id}: resolveWithPriceFeed failed (will retry): ${(e as Error).message.split("\n")[0]}`);
      }
    } else {
      this.once(`manual-${m.id}`, `market ${m.id}: closed, awaiting manual resolution: npm run resolve -- ${m.id} <yes|no|invalid>`);
    }
  }

  /** CLI entry: finalize totals, then resolve a Manual market. */
  async resolveManual(id: number, outcome: "yes" | "no" | "invalid") {
    const pools = this.poolsFor(id);
    if (!pools) throw new Error(`market ${id} has no pool accounts in this keystore`);
    let m = await this.readMarket(id);
    if (m.resolutionType !== 0) throw new Error(`market ${id} is a price-feed market; it resolves itself`);
    if (m.status !== Status.Open && m.status !== Status.Closed) throw new Error(`market ${id} is ${STATUS_NAMES[m.status]}`);
    const head = (await this.provider.getBlock("latest"))!;
    if (head.timestamp < m.closeTime) throw new Error(`market ${id} has not reached closeTime yet (${m.closeTime - head.timestamp}s left)`);
    if (m.status === Status.Open) {
      await this.closeMarket(m);
      m = await this.readMarket(id);
    }
    for (let i = 0; i < 30 && this.ledger.headTime < m.closeTime; i++) {
      await this.ledger.sync();
      if (this.ledger.headTime < m.closeTime) await new Promise((r) => setTimeout(r, 2000));
    }
    m = await this.readMarket(id);
    if (!(await this.ensureFinalPublish(m, pools))) throw new Error("final publish was not possible; not resolving");
    const code = { yes: OutcomeCode.Yes, no: OutcomeCode.No, invalid: OutcomeCode.Invalid }[outcome];
    await this.send(`market ${id}: resolved manually as ${outcome.toUpperCase()}`, () => this.markets.resolveManual(id, code));
  }

  // ───────────────────────────── settlement ────────────────────────
  private async settle(m: MarketView, pools: Pools) {
    let plan = this.store.getPlan(m.id);
    if (!plan) {
      await this.ledger.sync();
      const cc = await this.crossCheck(m, pools);
      if (!cc.ok) return;
      const outcome: PlanOutcome =
        m.status === Status.Cancelled || m.outcome === OutcomeCode.Invalid ? "INVALID" : m.outcome === OutcomeCode.Yes ? "YES" : "NO";
      const bets = this.ledger.bets(m.id);
      const p = planPayouts({ outcome, bets, closeTime: m.closeTime });
      if (p.outflow.YES !== cc.chain.YES || p.outflow.NO !== cc.chain.NO) {
        throw new Error(`plan outflow YES ${p.outflow.YES}/NO ${p.outflow.NO} != on-chain pools YES ${cc.chain.YES}/NO ${cc.chain.NO}`);
      }
      plan = this.store.createPlan(
        m.id,
        outcome,
        p.items,
        { YES: pools.yes.address, NO: pools.no.address },
        { [pools.yes.address.toLowerCase()]: cc.chain.YES, [pools.no.address.toLowerCase()]: cc.chain.NO },
      );
      this.logger.info(
        `market ${m.id}: payout plan created (outcome ${outcome}, ${bets.length} bets, YES ${fmt(p.totals.yes)} / NO ${fmt(p.totals.no)}, ${p.items.length} transfers)`,
      );
      for (const [who, amt] of Object.entries(p.payoutByBettor)) this.logger.info(`market ${m.id}:   ${who} receives ${fmt(amt)}`);
    }

    if (!plan.done) {
      const r = await executePlan(this.store, this.executor, m.id, this.logger, () => this.stopping);
      if (r.stopped) return;
      this.logger.info(`market ${m.id}: payouts complete (sent ${r.sent}, recovered ${r.recovered}, already done ${r.alreadyDone})`);
    }

    const yes = await this.executor.poolBalance(pools.yes.address);
    const no = await this.executor.poolBalance(pools.no.address);
    if (yes !== 0n || no !== 0n) {
      this.logger.error(`market ${m.id}: pools not empty after payouts (YES ${fmt(yes)}, NO ${fmt(no)}); NOT marking settled`);
      return;
    }
    this.logger.info(`market ${m.id}: both pools are exactly zero`);
    const txCount = this.store.getPlan(m.id)!.items.length;
    await this.send(`market ${m.id}: marked Settled (${txCount} payout transfers)`, () => this.markets.markSettled(m.id, txCount));
  }
}
