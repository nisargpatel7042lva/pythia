/**
 * Encrypted-at-rest storage for pool accounts.
 *
 * Each pool is one JSON file `<keystoreDir>/<address>.json`. The secrets (EOA private key and
 * eERC decryption key) are sealed with AES-256-GCM under a key derived from the operator's
 * password with scrypt. The file's public `meta` (address, eERC public key, market/side tag) is
 * bound to the ciphertext as AES-GCM additional data, so swapping metadata between files fails
 * to decrypt. Secrets never touch disk in plaintext.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { createNodeWalletClient, deriveEercKeypair } from "@pythia/eerc-core";

export type Side = "YES" | "NO";

export interface PoolMeta {
  address: string;
  /** eERC (BabyJubJub) public key, decimal strings. Public on the Registrar once registered. */
  eercPublicKey: [string, string];
  createdAt: string;
  /** Block before which no transfer to this pool can exist (set when registered). */
  createdBlock?: number;
  marketId?: string;
  side?: Side;
}

export interface PoolSecrets {
  privateKey: `0x${string}`;
  /** SDK-format eERC decryption key (see eerc-core deriveEercKeypair). */
  eercDecryptionKey: string;
}

interface KeystoreFile {
  version: 1;
  meta: PoolMeta;
  kdf: { name: "scrypt"; salt: string; N: number; r: number; p: number };
  cipher: { name: "aes-256-gcm"; iv: string; tag: string };
  ciphertext: string;
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };

function deriveKey(password: string, salt: Buffer, p = SCRYPT): Buffer {
  return crypto.scryptSync(password, salt, 32, { N: p.N, r: p.r, p: p.p, maxmem: 128 * 1024 * 1024 });
}

function aad(meta: PoolMeta): Buffer {
  // Only immutable fields are authenticated; marketId/side are tagged after creation.
  return Buffer.from(JSON.stringify({ v: 1, address: meta.address.toLowerCase(), pk: meta.eercPublicKey }));
}

function seal(meta: PoolMeta, secrets: PoolSecrets, password: string): KeystoreFile {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  cipher.setAAD(aad(meta));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return {
    version: 1,
    meta,
    kdf: { name: "scrypt", salt: salt.toString("hex"), ...SCRYPT },
    cipher: { name: "aes-256-gcm", iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex") },
    ciphertext: ciphertext.toString("hex"),
  };
}

function open(file: KeystoreFile, password: string): PoolSecrets {
  const key = deriveKey(password, Buffer.from(file.kdf.salt, "hex"), file.kdf);
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(file.cipher.iv, "hex"));
  d.setAAD(aad(file.meta));
  d.setAuthTag(Buffer.from(file.cipher.tag, "hex"));
  try {
    const pt = Buffer.concat([d.update(Buffer.from(file.ciphertext, "hex")), d.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    throw new Error(`Cannot decrypt keystore for ${file.meta.address}: wrong password or tampered file`);
  }
}

export class Keystore {
  constructor(
    readonly dir: string,
    private readonly password: string,
  ) {
    if (!password || password.length < 12) {
      throw new Error("POOL_KEYSTORE_PASSPHRASE must be set and at least 12 characters");
    }
  }

  private file(address: string) {
    return path.join(this.dir, `${address.toLowerCase()}.json`);
  }

  private read(address: string): KeystoreFile {
    return JSON.parse(fs.readFileSync(this.file(address), "utf8"));
  }

  private write(f: KeystoreFile) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = this.file(f.meta.address) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(f, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file(f.meta.address));
  }

  /** Generate a fresh EOA + eERC keypair and persist it encrypted. Returns public info only. */
  async generatePool(rpcUrl: string): Promise<PoolMeta> {
    const wallet = ethers.Wallet.createRandom();
    const privateKey = wallet.privateKey as `0x${string}`;
    const walletClient = await createNodeWalletClient(privateKey, rpcUrl);
    const { decryptionKey, publicKey } = await deriveEercKeypair(walletClient);
    const meta: PoolMeta = {
      address: wallet.address,
      eercPublicKey: [publicKey[0].toString(), publicKey[1].toString()],
      createdAt: new Date().toISOString(),
    };
    this.write(seal(meta, { privateKey, eercDecryptionKey: decryptionKey }, this.password));
    return meta;
  }

  load(address: string): { meta: PoolMeta; secrets: PoolSecrets } {
    const f = this.read(address);
    return { meta: f.meta, secrets: open(f, this.password) };
  }

  /** Public metadata of all pools, without decrypting anything. */
  list(): PoolMeta[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => (JSON.parse(fs.readFileSync(path.join(this.dir, n), "utf8")) as KeystoreFile).meta);
  }

  /** Update non-secret metadata (market tag, creation block). Ciphertext is untouched. */
  updateMeta(address: string, patch: Partial<Pick<PoolMeta, "marketId" | "side" | "createdBlock">>) {
    const f = this.read(address);
    f.meta = { ...f.meta, ...patch };
    this.write(f);
  }
}
