/**
 * Live check of local decryption of one's own transfers.
 *   TEST_PRIVATE_KEY=0x... tsx scripts/test-own-decrypt.ts sent:<txHash>=<expectedUnits> received:<txHash>=<expectedUnits> ...
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  DlpSolver,
  FUJI_RPC_URL,
  createEercClient,
  createNodeWalletClient,
  decodeTransferCalldata,
  decryptReceivedAmount,
  decryptSentAmount,
  extractFormattedKey,
  resolveDecryptionKey,
} from "../src/index";

const pk = process.env.TEST_PRIVATE_KEY as `0x${string}`;
if (!pk) throw new Error("set TEST_PRIVATE_KEY");
const circuits = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../circuits");

const wallet = new ethers.Wallet(pk);
const wc = await createNodeWalletClient(pk);
const { decryptionKey, scheme } = await resolveDecryptionKey(wc, wallet);
const c = createEercClient({ walletClient: wc, circuitsBaseUrl: circuits, decryptionKey });
console.log("scheme:", scheme);

let t0 = performance.now();
const key = await extractFormattedKey(c.eerc);
console.log(`formatted key extracted (${(performance.now() - t0).toFixed(0)} ms)`);
t0 = performance.now();
const solver = new DlpSolver();
console.log(`DLP table built (${(performance.now() - t0).toFixed(0)} ms)`);

const provider = new ethers.JsonRpcProvider(FUJI_RPC_URL);
let failed = 0;
for (const arg of process.argv.slice(2)) {
  const [kind, rest] = arg.split(":");
  const [hash, expected] = rest.split("=");
  const tx = await provider.getTransaction(hash);
  const d = decodeTransferCalldata(tx!.data);
  if (!d) throw new Error(`${hash}: not a transfer`);
  t0 = performance.now();
  const got = kind === "sent" ? decryptSentAmount(c.eerc, key, d, solver) : decryptReceivedAmount(c.eerc, d);
  const ok = got.toString() === expected;
  if (!ok) failed++;
  console.log(`${kind} ${hash.slice(0, 12)}: decrypted ${got} (expected ${expected}) ${ok ? "OK" : "MISMATCH"} in ${(performance.now() - t0).toFixed(0)} ms`);
}
process.exit(failed ? 1 : 0);
