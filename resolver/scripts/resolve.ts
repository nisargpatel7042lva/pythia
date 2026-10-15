/**
 * Resolve a Manual market:  npm run resolve -- <marketId> <yes|no|invalid>
 *
 * Closes the market if needed, makes sure the final batched totals are published, then calls
 * resolveManual as the resolver. The running service then pays out and settles.
 */
import { ethers } from "ethers";
import { ChainExecutor } from "../src/chainExecutor.js";
import { keystorePassword, loadConfig, resolverPrivateKey } from "../src/config.js";
import { Engine } from "../src/engine.js";
import { Keystore } from "../src/keystore.js";
import { Ledger } from "../src/ledger.js";
import { log } from "../src/log.js";

async function main() {
  const [idArg, outcomeArg] = process.argv.slice(2);
  const outcome = outcomeArg?.toLowerCase();
  if (idArg === undefined || !/^\d+$/.test(idArg) || !["yes", "no", "invalid"].includes(outcome)) {
    throw new Error("usage: npm run resolve -- <marketId> <yes|no|invalid>");
  }
  const cfg = loadConfig();
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, undefined, { staticNetwork: true });
  const resolver = new ethers.Wallet(resolverPrivateKey(), provider);
  const keystore = new Keystore(cfg.keystoreDir, keystorePassword());
  const ledger = new Ledger(cfg, keystore);
  const engine = new Engine(cfg, keystore, ledger, new ChainExecutor(cfg, keystore, resolver, log), resolver, log);
  await engine.resolveManual(Number(idArg), outcome as "yes" | "no" | "invalid");
  ledger.close();
}

main().then(
  () => process.exit(0),
  (e) => {
    log.error((e as Error).message);
    process.exit(1);
  },
);
