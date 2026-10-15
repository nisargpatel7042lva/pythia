/**
 * Live check against Fuji: derive keys for a test wallet, verify they match the
 * wallet's on-chain registered eERC public key, read its encrypted balance from
 * the deployed EncryptedERC and decrypt it.
 *
 *   TEST_PRIVATE_KEY=0x... npm run test:decrypt -w @pythia/eerc-core
 *
 * The wallet must already be registered on the Registrar. The private key is
 * only used locally to sign the derivation message; it is never printed.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ethers } from "ethers";
import {
  FUJI_EERC,
  FUJI_RPC_URL,
  createEercClient,
  createNodeWalletClient,
  deriveBabyJubKeys,
  deriveI0DecryptionKey,
  getOnChainPublicKey,
  isRegistered,
  readEncryptedBalance,
} from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));
const circuitsBaseUrl = pathToFileURL(path.resolve(here, "../circuits")).href;

const pk = process.env.TEST_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) {
  console.error("Set TEST_PRIVATE_KEY (a Fuji wallet already registered on the eERC Registrar).");
  process.exit(1);
}

const wallet = new ethers.Wallet(pk);
const address = wallet.address;
console.log("wallet           :", address);
console.log("EncryptedERC     :", FUJI_EERC.encryptedERC);
console.log("Registrar        :", FUJI_EERC.registrar);

// 1. Key derivation (backend-style), no network.
const keys = await deriveBabyJubKeys(wallet, address);
console.log("derived pubkey   :", keys.publicKey.map(String).join(","));

// 2. Build SDK client with the SDK-compatible form of the same key.
const decryptionKey = await deriveI0DecryptionKey(wallet, address);
const walletClient = await createNodeWalletClient(pk, FUJI_RPC_URL);
const client = createEercClient({ walletClient, circuitsBaseUrl, decryptionKey });

if (!(await isRegistered(client))) {
  console.error("FAIL: wallet is not registered on the Registrar.");
  process.exit(1);
}

// 3. Derived key must reproduce the on-chain public key (both derivation paths).
const onChain = await getOnChainPublicKey(client);
console.log("on-chain pubkey  :", onChain.map(String).join(","));
const backendMatch = keys.publicKey[0] === onChain[0] && keys.publicKey[1] === onChain[1];
const sdkMatch =
  client.eerc.publicKey[0] === onChain[0] && client.eerc.publicKey[1] === onChain[1];
console.log("backend-style key matches on-chain:", backendMatch);
console.log("SDK-style key matches on-chain    :", sdkMatch);
if (!backendMatch || !sdkMatch) {
  console.error("FAIL: derived key does not match the registered public key.");
  process.exit(1);
}

// 4. Read and decrypt the encrypted balance.
const bal = await readEncryptedBalance(client);
console.log("tokenId          :", bal.tokenId.toString());
console.log("eERC decimals    :", bal.decimals.toString());
console.log("encrypted c1/c2  :", bal.encryptedBalance.map((v) => v.toString().slice(0, 12) + "...").join(" "));
console.log("decrypted balance:", bal.total.toString(), `(= ${ethers.formatUnits(bal.total, bal.decimals)} eUSDC)`);
console.log("OK");
