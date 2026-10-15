/**
 * eERC key derivation, copied from PHANTOM (frontend/src/hooks/useEERC.ts),
 * which matches eerc-backend-converter/src/utils/utils.ts (`i0`,
 * `deriveKeysFromUser`). Logic is unchanged; only the React/localStorage
 * parts were removed.
 *
 * Wallets registered through eerc-backend-converter derive the eERC decryption
 * key from a wallet signature with the "i0()" scheme (keccak256 + Ed25519-style
 * clamping). The SDK's own generateDecryptionKey() uses a different
 * (StarkEx-style grindKey) algorithm over the same message, so it yields a
 * DIFFERENT key. Always verify a derived key against the on-chain public key.
 */
import { ethers } from "ethers";
import { Base8, mulPointEscalar } from "@zk-kit/baby-jubjub";
import { formatPrivKeyForBabyJub } from "maci-crypto";

export const SUB_GROUP_ORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;

/** Anything with an ethers-style signMessage (ethers Wallet / JsonRpcSigner). */
export interface MessageSigner {
  signMessage(message: string): Promise<string>;
}

export function registrationMessage(address: string): string {
  return `eERC\nRegistering user with\n Address:${address.toLowerCase()}`;
}

export function i0(signature: string): bigint {
  const hash = ethers.keccak256(signature);
  const bytes = ethers.getBytes(hash);
  bytes[0] &= 0b11111000;
  bytes[31] &= 0b01111111;
  bytes[31] |= 0b01000000;
  const le = bytes.slice().reverse();
  let sk = BigInt(ethers.hexlify(le));
  sk %= SUB_GROUP_ORDER;
  if (sk === 0n) sk = 1n;
  return sk;
}

/**
 * The SDK's formatKeyForCurve does Buffer.from(key, "hex") then blake512s it,
 * while the backend blake512s the raw UTF-8 bytes of the key's DECIMAL string.
 * Hex-encoding those UTF-8 bytes makes the SDK reproduce the backend's scalar
 * (and thus public key). Verified against the on-chain registered key.
 */
export function toSyntheticDecryptionKeyHex(rawKey: bigint): string {
  const decimalString = rawKey.toString(10);
  const utf8Bytes = ethers.toUtf8Bytes(decimalString);
  return ethers.hexlify(utf8Bytes).slice(2);
}

/** Signature to SDK-compatible decryption key (hex string, no 0x). */
export async function deriveI0DecryptionKey(
  signer: MessageSigner,
  address: string,
): Promise<string> {
  const signature = await signer.signMessage(registrationMessage(address));
  return toSyntheticDecryptionKeyHex(i0(signature));
}

export interface BabyJubKeys {
  /** Raw i0 key. */
  privateKey: bigint;
  /** formatPrivKeyForBabyJub(privateKey) % subOrder (used for the public key). */
  formattedPrivateKey: bigint;
  publicKey: [bigint, bigint];
  signature: string;
}

/** Backend-style derivation (eerc-backend-converter `deriveKeysFromUser`), hardhat-free. */
export async function deriveBabyJubKeys(
  signer: MessageSigner,
  address: string,
): Promise<BabyJubKeys> {
  const signature = await signer.signMessage(registrationMessage(address));
  if (!signature || signature.length < 64) {
    throw new Error("Invalid signature received from signer");
  }
  const privateKey = i0(signature);
  const formattedPrivateKey = formatPrivKeyForBabyJub(privateKey) % SUB_GROUP_ORDER;
  const publicKey = mulPointEscalar(Base8, formattedPrivateKey).map((x) =>
    BigInt(x),
  ) as [bigint, bigint];
  return { privateKey, formattedPrivateKey, publicKey, signature };
}
