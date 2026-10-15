/**
 * PYTHIA resolver service (long-running).
 *
 * Every poll interval it: syncs the bet ledger, publishes batched odds, closes markets, resolves
 * price-feed markets, and pays out / refunds resolved or cancelled markets. SIGINT/SIGTERM stop it
 * gracefully (a payout in progress pauses after the current transfer and resumes on restart).
 */
import { ethers } from "ethers";
import { ChainExecutor } from "./chainExecutor.js";
import { keystorePassword, loadConfig, resolverPrivateKey } from "./config.js";
import { Engine } from "./engine.js";
import { Keystore } from "./keystore.js";
import { Ledger } from "./ledger.js";
import { log } from "./log.js";

const cfg = loadConfig();
const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, undefined, { staticNetwork: true });
const resolver = new ethers.Wallet(resolverPrivateKey(), provider);
const keystore = new Keystore(cfg.keystoreDir, keystorePassword());
const ledger = new Ledger(cfg, keystore);
const executor = new ChainExecutor(cfg, keystore, resolver, log);
const engine = new Engine(cfg, keystore, ledger, executor, resolver, log);

const intervalMs = Number(process.env.RESOLVER_POLL_INTERVAL_MS ?? 15000);
let stopping = false;
let wake: (() => void) | null = null;
const shutdown = (sig: string) => {
  if (stopping) return;
  stopping = true;
  log.info(`${sig} received: finishing the current step, then exiting`);
  engine.stop();
  wake?.();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

log.info(`resolver ${resolver.address} | PythiaMarkets ${cfg.marketsAddress} | poll ${intervalMs}ms | K>=${cfg.batchMinBets}`);
log.info(`pools in keystore: ${keystore.list().filter((p) => p.marketId).length}`);

while (!stopping) {
  try {
    await engine.tick();
  } catch (e) {
    log.error(`tick failed: ${(e as Error).message}`);
  }
  if (stopping) break;
  await new Promise<void>((res) => {
    wake = res;
    setTimeout(res, intervalMs);
  });
}
ledger.close();
log.info("resolver stopped");
process.exit(0);
