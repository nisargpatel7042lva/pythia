/**
 * Print decrypted eERC balances (eUSDC) as JSON, for before/after comparisons.
 *   tsx scripts/balances.ts --wallets 1,2 [--market 3]
 * Wallets are read from BETTOR_PRIVATE_KEY_N; pools from the keystore (needs POOL_KEYSTORE_PASSPHRASE).
 */
import { parseArgs } from "node:util";
import { ethers } from "ethers";
import { createNodeWalletClient, readEncryptedBalance, resolveDecryptionKey } from "@pythia/eerc-core";
import { bettorPrivateKey, keystorePassword, loadConfig } from "../src/config.js";
import { makeEercClient } from "../src/eerc.js";
import { Keystore } from "../src/keystore.js";

const { values: a } = parseArgs({ options: { wallets: { type: "string", default: "" }, market: { type: "string" } } });

async function main() {
  const cfg = loadConfig();
  const out: Record<string, string> = {};
  for (const n of a.wallets!.split(",").filter(Boolean)) {
    const pk = bettorPrivateKey(Number(n));
    const signer = new ethers.Wallet(pk);
    const wc = await createNodeWalletClient(pk, cfg.rpcUrl);
    const { decryptionKey } = await resolveDecryptionKey(wc, signer, { rpcUrl: cfg.rpcUrl, addresses: cfg.eerc });
    const c = await makeEercClient(cfg, pk, decryptionKey);
    out[`wallet${n} ${signer.address}`] = ethers.formatUnits((await readEncryptedBalance(c)).total, 2);
  }
  if (a.market !== undefined) {
    const ks = new Keystore(cfg.keystoreDir, keystorePassword());
    for (const meta of ks.list().filter((m) => m.marketId === a.market)) {
      const { secrets } = ks.load(meta.address);
      const c = await makeEercClient(cfg, secrets.privateKey, secrets.eercDecryptionKey);
      out[`market${a.market} ${meta.side} pool ${meta.address}`] = ethers.formatUnits((await readEncryptedBalance(c)).total, 2);
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
