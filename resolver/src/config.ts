import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FUJI_EERC, FUJI_RPC_URL, type EercAddresses } from "@pythia/eerc-core";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RESOLVER_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(RESOLVER_ROOT, "..");
dotenv.config({ path: path.resolve(REPO_ROOT, ".env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

function asKey(v: string): `0x${string}` {
  return (v.startsWith("0x") ? v : `0x${v}`) as `0x${string}`;
}

export interface BaseConfig {
  rpcUrl: string;
  eerc: EercAddresses;
  marketsAddress: `0x${string}`;
  /** Minimum new bets since the last publish before pool totals may be published on-chain. */
  batchMinBets: number;
  keystoreDir: string;
  dbPath: string;
  /** Filesystem directory holding register/, transfer/, withdraw/ circuit artifacts. */
  circuitsDir: string;
  /** AVAX sent to each new pool account for gas. */
  poolGasFund: string;
}

function marketsAddress(): `0x${string}` {
  if (process.env.PYTHIA_MARKETS_ADDRESS) return process.env.PYTHIA_MARKETS_ADDRESS as `0x${string}`;
  const file = path.resolve(REPO_ROOT, "contracts/deployments/fuji.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).address;
}

export function loadConfig(): BaseConfig {
  const k = Number(process.env.BATCH_MIN_BETS ?? "3");
  if (!Number.isInteger(k) || k < 1) throw new Error("BATCH_MIN_BETS must be an integer >= 1");
  const require = createRequire(import.meta.url);
  const coreDir = path.dirname(require.resolve("@pythia/eerc-core/package.json"));
  const abs = (p: string | undefined, def: string) => (p ? path.resolve(REPO_ROOT, p) : path.resolve(RESOLVER_ROOT, def));
  return {
    rpcUrl: process.env.FUJI_RPC_URL ?? FUJI_RPC_URL,
    eerc: {
      encryptedERC: (process.env.EERC_ADDRESS ?? FUJI_EERC.encryptedERC) as `0x${string}`,
      registrar: (process.env.REGISTRAR_ADDRESS ?? FUJI_EERC.registrar) as `0x${string}`,
      token: (process.env.USDC_ADDRESS ?? FUJI_EERC.token) as `0x${string}`,
    },
    marketsAddress: marketsAddress(),
    batchMinBets: k,
    keystoreDir: abs(process.env.POOL_KEYSTORE_PATH, "keystore"),
    dbPath: abs(process.env.LEDGER_DB_PATH, "data/ledger.sqlite"),
    circuitsDir: path.join(coreDir, "circuits"),
    poolGasFund: process.env.POOL_GAS_FUND ?? "0.1",
  };
}

// Secrets are fetched on demand so each script needs only what it uses.
export const resolverPrivateKey = () => asKey(required("RESOLVER_PRIVATE_KEY"));
export const keystorePassword = () => required("POOL_KEYSTORE_PASSPHRASE");
/** The PythiaMarkets owner (only the owner can create markets). */
export const ownerPrivateKey = () => asKey(required("DEPLOYER_PRIVATE_KEY"));
export const bettorPrivateKey = (n: number) => asKey(required(`BETTOR_PRIVATE_KEY_${n}`));

export function loadMarketsAbi(): unknown[] {
  return JSON.parse(fs.readFileSync(path.resolve(RESOLVER_ROOT, "abis/PythiaMarkets.abi.json"), "utf8"));
}
