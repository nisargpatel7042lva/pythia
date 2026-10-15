/**
 * eERC client, ported from PHANTOM's useEERC hook (frontend/src/hooks/useEERC.ts)
 * with the React state and localStorage removed so it runs in Node and the
 * browser. Call sequences into @avalabs/ac-eerc-sdk are unchanged.
 */
import { ethers } from "ethers";
// Deep import: the SDK's package.json "main" points at a non-existent
// dist/index.cjs (only ESM dist/index.js ships). PHANTOM's Node test did the same.
import { EERC } from "@avalabs/ac-eerc-sdk/dist/index.js";
import { createPublicClient, createWalletClient, http } from "viem";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import { avalancheFuji } from "viem/chains";
import EncryptedERCArtifact from "../abis/EncryptedERC.json";
import RegistrarArtifact from "../abis/Registrar.json";
import { FALLBACK_EERC_DECIMALS, FUJI_EERC, FUJI_RPC_URL, type EercAddresses } from "./config";
import { getCircuitURLs } from "./circuits";
import { deriveI0DecryptionKey, type MessageSigner } from "./keys";

export const ENCRYPTED_ERC_ABI = EncryptedERCArtifact.abi;
export const REGISTRAR_ABI = RegistrarArtifact.abi;

const unsupportedProveFunc = async () => {
  throw new Error("Remote proof generation is not configured; proofs run client-side via snarkjs.");
};

export interface EercClientOptions {
  /** viem wallet client for the account that signs txs. */
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient?: PublicClient;
  rpcUrl?: string;
  addresses?: EercAddresses;
  /** Absolute URL prefix of the circuits directory (see circuits.ts). */
  circuitsBaseUrl: string;
  /** SDK-format decryption key (hex, no 0x); see keys.deriveI0DecryptionKey. */
  decryptionKey?: string;
}

export interface EercClient {
  eerc: EERC;
  address: `0x${string}`;
  addresses: EercAddresses;
  provider: ethers.JsonRpcProvider;
  encryptedERC: ethers.Contract;
  registrar: ethers.Contract;
}

export function createEercClient(opts: EercClientOptions): EercClient {
  const addresses = opts.addresses ?? FUJI_EERC;
  const rpcUrl = opts.rpcUrl ?? FUJI_RPC_URL;
  const publicClient =
    opts.publicClient ?? createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) });
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });

  // viem client types don't line up 1:1 with the wagmi-derived types the SDK
  // declares; at runtime they are the same viem clients (as in PHANTOM).
  const eerc = new EERC(
    publicClient as never,
    opts.walletClient as never,
    addresses.encryptedERC,
    addresses.registrar,
    true, // isConverter
    unsupportedProveFunc,
    getCircuitURLs(opts.circuitsBaseUrl),
    opts.decryptionKey,
  );

  return {
    eerc,
    address: opts.walletClient.account.address,
    addresses,
    provider,
    encryptedERC: new ethers.Contract(addresses.encryptedERC, ENCRYPTED_ERC_ABI, provider),
    registrar: new ethers.Contract(addresses.registrar, REGISTRAR_ABI, provider),
  };
}

/** viem wallet client from a raw private key (resolver / scripts). */
export async function createNodeWalletClient(
  privateKey: `0x${string}`,
  rpcUrl = FUJI_RPC_URL,
): Promise<WalletClient<Transport, Chain, Account>> {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl) });
}

/**
 * Derive the SDK's eERC keypair for a wallet (signs the registration message with the wallet,
 * deterministic per EOA). Needs no network access or gas. The returned `decryptionKey` is what
 * `createEercClient({ decryptionKey })` expects; `register()` registers this same public key.
 */
export async function deriveEercKeypair(
  walletClient: WalletClient<Transport, Chain, Account>,
): Promise<{ decryptionKey: string; publicKey: [bigint, bigint] }> {
  const c = createEercClient({ walletClient, circuitsBaseUrl: "" });
  const decryptionKey = await c.eerc.generateDecryptionKey();
  return { decryptionKey, publicKey: [c.eerc.publicKey[0], c.eerc.publicKey[1]] };
}

/**
 * Pick the decryption key that reproduces the account's on-chain registered public key.
 * Accounts registered through the SDK use its native derivation; accounts registered by
 * eerc-backend-converter's scripts use the backend `i0` derivation (see keys.ts). Unregistered
 * accounts get the SDK-native key, which `register()` will then publish.
 */
export async function resolveDecryptionKey(
  walletClient: WalletClient<Transport, Chain, Account>,
  signer: MessageSigner,
  opts: { rpcUrl?: string; addresses?: EercAddresses } = {},
): Promise<{ decryptionKey: string; scheme: "sdk" | "backend-i0"; registered: boolean }> {
  const base = { walletClient, circuitsBaseUrl: "", rpcUrl: opts.rpcUrl, addresses: opts.addresses };
  const probe = createEercClient(base);
  const address = walletClient.account.address;
  const sdk = await deriveEercKeypair(walletClient);
  if (!(await isRegistered(probe, address))) {
    return { decryptionKey: sdk.decryptionKey, scheme: "sdk", registered: false };
  }
  const onChain = await getOnChainPublicKey(probe, address);
  const same = (pk: bigint[]) => pk[0] === onChain[0] && pk[1] === onChain[1];
  if (same(sdk.publicKey)) return { decryptionKey: sdk.decryptionKey, scheme: "sdk", registered: true };

  const alt = await deriveI0DecryptionKey(signer, address);
  const altClient = createEercClient({ ...base, decryptionKey: alt });
  if (same(altClient.eerc.publicKey)) return { decryptionKey: alt, scheme: "backend-i0", registered: true };
  throw new Error(`No known key derivation reproduces the on-chain eERC public key of ${address}`);
}

export async function isRegistered(c: EercClient, address: string = c.address): Promise<boolean> {
  return c.registrar.isUserRegistered(address);
}

export async function getOnChainPublicKey(
  c: EercClient,
  address: string = c.address,
): Promise<[bigint, bigint]> {
  const k = await c.registrar.getUserPublicKey(address);
  return [BigInt(k[0]), BigInt(k[1])];
}

export async function getEercDecimals(c: EercClient): Promise<bigint> {
  try {
    return BigInt(await c.encryptedERC.decimals());
  } catch {
    return FALLBACK_EERC_DECIMALS;
  }
}

export interface EncryptedBalance {
  tokenId: bigint;
  /** Decrypted total in eERC units (scaled by `decimals`). */
  total: bigint;
  decimals: bigint;
  /** [c1.x, c1.y, c2.x, c2.y], the proof input for transfer/withdraw. */
  encryptedBalance: bigint[];
}

/** Read an account's encrypted balance for the wrapped token and decrypt it. */
export async function readEncryptedBalance(
  c: EercClient,
  user: string = c.address,
  token: string = c.addresses.token,
): Promise<EncryptedBalance> {
  const decimals = await getEercDecimals(c);
  const tokenId: bigint = await c.encryptedERC.tokenIds(token);
  if (tokenId === 0n) {
    return { tokenId, total: 0n, decimals, encryptedBalance: [0n, 0n, 0n, 0n] };
  }
  const [eGCT, , amountPCTs, balancePCT] = await c.encryptedERC.balanceOf(user, tokenId);
  const total = c.eerc.calculateTotalBalance(eGCT, amountPCTs, balancePCT);
  const encryptedBalance = [eGCT.c1.x, eGCT.c1.y, eGCT.c2.x, eGCT.c2.y].map((v: bigint) =>
    BigInt(v),
  );
  return { tokenId, total, decimals, encryptedBalance };
}

async function getAuditorPublicKey(c: EercClient): Promise<bigint[]> {
  const k = await c.encryptedERC.auditorPublicKey();
  return [BigInt(k[0]), BigInt(k[1])];
}

/** Generate the registration proof and register the account's public key. */
export async function register(c: EercClient) {
  if (await isRegistered(c)) return { alreadyRegistered: true as const };
  const { key, transactionHash } = await c.eerc.register();
  await c.provider.waitForTransaction(transactionHash);
  return { alreadyRegistered: false as const, key, transactionHash };
}

/** Approve (if needed) and deposit plain ERC20 into the encrypted balance. */
export async function deposit(
  c: EercClient,
  amountUnits: bigint,
  approve: (spender: string, amount: bigint) => Promise<void>,
) {
  const { token } = c.addresses;
  const allowance = await c.eerc.fetchUserApprove(c.address, token);
  if (allowance < amountUnits) await approve(c.addresses.encryptedERC, amountUnits);
  const decimals = await getEercDecimals(c);
  const { transactionHash } = await c.eerc.deposit(amountUnits, token, decimals);
  await c.provider.waitForTransaction(transactionHash);
  return transactionHash;
}

/** Private transfer of `amount` (eERC units) to a registered address. */
export async function privateTransfer(
  c: EercClient,
  to: string,
  amount: bigint,
  opts: { /** Called with the tx hash right after broadcast, before waiting for confirmation. */ onSubmitted?: (hash: string) => void | Promise<void> } = {},
) {
  if (!c.eerc.isDecryptionKeySet) throw new Error("Decryption key not set; cannot transfer.");
  const recipientKey = await c.eerc.fetchPublicKey(to);
  if (recipientKey[0] === 0n && recipientKey[1] === 0n) {
    throw new Error("Recipient is not registered for private transfers.");
  }
  const bal = await readEncryptedBalance(c);
  if (bal.tokenId === 0n) throw new Error("Token not registered in EncryptedERC yet; deposit first.");
  if (bal.total < 0n) throw new Error("Encrypted balance failed its consistency check (decryptor returned -1).");
  if (bal.total < amount) throw new Error(`Insufficient encrypted balance: have ${bal.total}, need ${amount} (eERC units).`);
  const auditorPublicKey = await getAuditorPublicKey(c);
  // `proofAndSubmitMs` covers snarkjs proof generation plus sending the tx (not confirmation).
  const t0 = performance.now();
  const { transactionHash } = await c.eerc.transfer(
    to,
    amount,
    bal.encryptedBalance,
    bal.total,
    auditorPublicKey,
    c.addresses.token,
  );
  const proofAndSubmitMs = performance.now() - t0;
  await opts.onSubmitted?.(transactionHash);
  const receipt = await c.provider.waitForTransaction(transactionHash);
  if (!receipt || receipt.status !== 1) throw new Error(`transfer ${transactionHash} reverted`);
  return { transactionHash, proofAndSubmitMs };
}

/** Withdraw `amount` (eERC units) back to the plain ERC20. */
export async function withdraw(c: EercClient, amount: bigint) {
  if (!c.eerc.isDecryptionKeySet) throw new Error("Decryption key not set; cannot withdraw.");
  const bal = await readEncryptedBalance(c);
  if (bal.tokenId === 0n) throw new Error("Token not registered in EncryptedERC yet; deposit first.");
  const auditorPublicKey = await getAuditorPublicKey(c);
  const { transactionHash } = await c.eerc.withdraw(
    amount,
    bal.encryptedBalance,
    bal.total,
    auditorPublicKey,
    c.addresses.token,
  );
  await c.provider.waitForTransaction(transactionHash);
  return transactionHash;
}
