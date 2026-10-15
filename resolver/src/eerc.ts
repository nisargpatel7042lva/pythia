import { createEercClient, createNodeWalletClient, type EercClient } from "@pythia/eerc-core";
import type { BaseConfig } from "./config.js";

/** eERC client for an EOA private key (optionally with its eERC decryption key preloaded). */
export async function makeEercClient(
  cfg: BaseConfig,
  privateKey: `0x${string}`,
  decryptionKey?: string,
): Promise<EercClient> {
  const walletClient = await createNodeWalletClient(privateKey, cfg.rpcUrl);
  return createEercClient({
    walletClient,
    rpcUrl: cfg.rpcUrl,
    addresses: cfg.eerc,
    // Node: the SDK reads wasm/zkey from the filesystem when given plain paths.
    circuitsBaseUrl: cfg.circuitsDir,
    decryptionKey,
  });
}

export const snowtraceTx = (hash: string) => `https://testnet.snowtrace.io/tx/${hash}`;
export const snowtraceAddress = (addr: string) => `https://testnet.snowtrace.io/address/${addr}`;
