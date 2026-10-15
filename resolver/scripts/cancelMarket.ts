/**
 * Owner-only: cancel a market (outcome becomes Invalid; the resolver service then refunds every bet).
 *   DEPLOYER_PRIVATE_KEY=0x... tsx scripts/cancelMarket.ts <marketId>
 */
import { ethers } from "ethers";
import { loadConfig, loadMarketsAbi, ownerPrivateKey } from "../src/config.js";
import { log } from "../src/log.js";

async function main() {
  const id = process.argv[2];
  if (!id || !/^\d+$/.test(id)) throw new Error("usage: cancelMarket.ts <marketId>");
  const cfg = loadConfig();
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, undefined, { staticNetwork: true });
  const owner = new ethers.Wallet(ownerPrivateKey(), provider);
  const markets = new ethers.Contract(cfg.marketsAddress, loadMarketsAbi() as ethers.InterfaceAbi, owner);
  const tx = await markets.cancelMarket(BigInt(id));
  await tx.wait();
  log.tx(`market ${id}: cancelled by owner`, tx.hash);
}

main().then(
  () => process.exit(0),
  (e) => {
    log.error((e as Error).message);
    process.exit(1);
  },
);
