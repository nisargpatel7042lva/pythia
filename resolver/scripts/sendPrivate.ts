/**
 * Send eUSDC privately from a bettor wallet to any registered address (used to fund test accounts).
 *   tsx scripts/sendPrivate.ts --wallet 2 --to 0x... --amount 3.00
 */
import { parseArgs } from "node:util";
import { ethers } from "ethers";
import { createNodeWalletClient, privateTransfer, resolveDecryptionKey } from "@pythia/eerc-core";
import { bettorPrivateKey, loadConfig } from "../src/config.js";
import { makeEercClient, snowtraceTx } from "../src/eerc.js";

const { values: a } = parseArgs({ options: { wallet: { type: "string" }, to: { type: "string" }, amount: { type: "string" } } });

async function main() {
  if (!a.wallet || !a.to || !a.amount) throw new Error("usage: sendPrivate.ts --wallet N --to 0x... --amount 1.00");
  const cfg = loadConfig();
  const pk = bettorPrivateKey(Number(a.wallet));
  const wc = await createNodeWalletClient(pk, cfg.rpcUrl);
  const { decryptionKey } = await resolveDecryptionKey(wc, new ethers.Wallet(pk), { rpcUrl: cfg.rpcUrl, addresses: cfg.eerc });
  const c = await makeEercClient(cfg, pk, decryptionKey);
  const { transactionHash } = await privateTransfer(c, ethers.getAddress(a.to), ethers.parseUnits(a.amount, 2));
  console.log("sent privately:", snowtraceTx(transactionHash));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
