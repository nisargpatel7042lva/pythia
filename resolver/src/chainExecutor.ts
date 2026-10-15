import { ethers } from "ethers";
import { ENCRYPTED_ERC_ABI, privateTransfer, readEncryptedBalance, type EercClient } from "@pythia/eerc-core";
import type { BaseConfig } from "./config.js";
import { makeEercClient } from "./eerc.js";
import type { Keystore } from "./keystore.js";
import type { Logger } from "./log.js";
import type { PoolExecutor } from "./settlement.js";

const MIN_POOL_GAS = ethers.parseEther("0.005");
const GAS_TOPUP = ethers.parseEther("0.05");

/**
 * TEST-ONLY fault injection for crash-recovery testing. Off unless PYTHIA_FAULT_INJECT is set:
 *   PYTHIA_FAULT_INJECT=before_record:<marketId>:<itemSeq>
 * SIGKILLs the process right after that payout transfer is broadcast, BEFORE its hash is written
 * to the database (the worst case for double payment).
 */
function faultInjected(point: string, marketId: number, seq: number): boolean {
  return process.env.PYTHIA_FAULT_INJECT === `${point}:${marketId}:${seq}`;
}

export class ChainExecutor implements PoolExecutor {
  private clients = new Map<string, EercClient>();
  private provider: ethers.JsonRpcProvider;

  constructor(
    private cfg: BaseConfig,
    private keystore: Keystore,
    private resolver: ethers.Wallet,
    private logger: Logger,
  ) {
    this.provider = new ethers.JsonRpcProvider(cfg.rpcUrl, undefined, { staticNetwork: true });
  }

  async client(pool: string): Promise<EercClient> {
    const key = pool.toLowerCase();
    let c = this.clients.get(key);
    if (!c) {
      const { secrets } = this.keystore.load(pool);
      c = await makeEercClient(this.cfg, secrets.privateKey, secrets.eercDecryptionKey);
      this.clients.set(key, c);
    }
    return c;
  }

  async poolBalance(pool: string): Promise<bigint> {
    const b = await readEncryptedBalance(await this.client(pool));
    if (b.total < 0n) throw new Error(`pool ${pool}: encrypted balance failed its consistency check`);
    return b.total;
  }

  async waitIdle(pool: string): Promise<void> {
    const deadline = Date.now() + 120_000;
    for (;;) {
      const [pending, latest] = await Promise.all([
        this.provider.getTransactionCount(pool, "pending"),
        this.provider.getTransactionCount(pool, "latest"),
      ]);
      if (pending === latest) return;
      if (Date.now() > deadline) throw new Error(`pool ${pool} still has pending transactions after 120s`);
      this.logger.info(`waiting for pending tx from pool ${pool} (nonce ${latest} -> ${pending})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  async txStatus(hash: string): Promise<"confirmed" | "failed" | "unknown"> {
    const r = await this.provider.getTransactionReceipt(hash);
    if (!r) return "unknown";
    return r.status === 1 ? "confirmed" : "failed";
  }

  async findSentTx(pool: string, to: string, exclude: Set<string>): Promise<string | null> {
    const iface = new ethers.Interface(ENCRYPTED_ERC_ABI);
    const topic = iface.getEvent("PrivateTransfer")!.topicHash;
    const head = await this.provider.getBlockNumber();
    const meta = this.keystore.list().find((m) => m.address.toLowerCase() === pool.toLowerCase());
    const from = meta?.createdBlock ?? Math.max(0, head - 50_000);
    let found: string | null = null;
    for (let start = from; start <= head; start += 2000) {
      const logs = await this.provider.getLogs({
        address: this.cfg.eerc.encryptedERC,
        topics: [topic, ethers.zeroPadValue(pool, 32), ethers.zeroPadValue(to, 32)],
        fromBlock: start,
        toBlock: Math.min(start + 1999, head),
      });
      for (const l of logs) if (!exclude.has(l.transactionHash)) found = l.transactionHash;
    }
    return found;
  }

  /** Make sure the pool can pay gas; top up from the resolver wallet if it is nearly empty. */
  private async ensureGas(pool: string) {
    const bal = await this.provider.getBalance(pool);
    if (bal >= MIN_POOL_GAS) return;
    this.logger.warn(`pool ${pool} low on gas (${ethers.formatEther(bal)} AVAX); topping up`);
    const tx = await this.resolver.sendTransaction({ to: pool, value: GAS_TOPUP });
    await tx.wait();
    this.logger.tx(`topped up pool ${pool} with ${ethers.formatEther(GAS_TOPUP)} AVAX`, tx.hash);
  }

  async send(
    pool: string,
    to: string,
    amount: bigint,
    onSubmitted: (hash: string) => Promise<void> | void,
    meta: { marketId: number; seq: number },
  ): Promise<string> {
    await this.ensureGas(pool);
    const c = await this.client(pool);
    const { transactionHash, proofAndSubmitMs } = await privateTransfer(c, ethers.getAddress(to), amount, {
      onSubmitted: async (hash) => {
        if (faultInjected("before_record", meta.marketId, meta.seq)) {
          this.logger.error(`FAULT INJECTION: killing process after broadcasting ${hash}, before recording it`);
          process.kill(process.pid, "SIGKILL");
        }
        await onSubmitted(hash);
      },
    });
    this.logger.info(`transfer proof+submit ${(proofAndSubmitMs / 1000).toFixed(1)}s`);
    return transactionHash;
  }
}
