import { ethers } from "ethers";
import { makeProvider } from "./rpc.js";
import { getOnChainPublicKey, isRegistered } from "@pythia/eerc-core";
import type { BaseConfig } from "./config.js";
import { makeEercClient, snowtraceTx } from "./eerc.js";
import type { Keystore, PoolMeta } from "./keystore.js";

export interface PoolPair {
  yes: PoolMeta;
  no: PoolMeta;
}

async function createPool(
  cfg: BaseConfig,
  keystore: Keystore,
  resolver: ethers.Wallet,
  label: string,
): Promise<PoolMeta> {
  const provider = resolver.provider as ethers.JsonRpcProvider;

  // 1. Fresh EOA + eERC keypair, persisted encrypted BEFORE anything is sent to it.
  const meta = await keystore.generatePool(cfg.rpcUrl);
  console.log(`[${label}] pool ${meta.address} (keys sealed in keystore)`);
  const createdBlock = await provider.getBlockNumber();
  keystore.updateMeta(meta.address, { createdBlock });

  // 2. Gas from the resolver wallet.
  const fund = await resolver.sendTransaction({
    to: meta.address,
    value: ethers.parseEther(cfg.poolGasFund),
  });
  await fund.wait();
  console.log(`[${label}] funded ${cfg.poolGasFund} AVAX  ${snowtraceTx(fund.hash)}`);

  // 3. Register on the eERC Registrar (zk registration proof, signed by the pool EOA).
  const { secrets } = keystore.load(meta.address);
  const client = await makeEercClient(cfg, secrets.privateKey, secrets.eercDecryptionKey);
  const t0 = performance.now();
  const reg = await client.eerc.register();
  if (reg.transactionHash) await client.provider.waitForTransaction(reg.transactionHash);
  console.log(
    `[${label}] registered in ${((performance.now() - t0) / 1000).toFixed(1)}s  ${reg.transactionHash ? snowtraceTx(reg.transactionHash) : "(already)"}`,
  );

  // 4. The registered key must be the one we stored, otherwise the pool would be undecryptable.
  if (!(await isRegistered(client))) throw new Error(`[${label}] registration did not take effect`);
  const onChain = await getOnChainPublicKey(client);
  if (onChain[0].toString() !== meta.eercPublicKey[0] || onChain[1].toString() !== meta.eercPublicKey[1]) {
    throw new Error(`[${label}] on-chain eERC public key does not match the keystore key`);
  }
  return { ...meta, createdBlock };
}

/** Create the YES and NO pool accounts: fresh keys, gas-funded, registered on the eERC Registrar. */
export async function createPoolPair(
  cfg: BaseConfig,
  keystore: Keystore,
  resolverKey: `0x${string}`,
): Promise<PoolPair> {
  const provider = makeProvider(cfg.rpcUrl);
  const resolver = new ethers.Wallet(resolverKey, provider);
  const need = ethers.parseEther(cfg.poolGasFund) * 2n;
  const bal = await provider.getBalance(resolver.address);
  if (bal < need + ethers.parseEther("0.05")) {
    throw new Error(
      `Resolver ${resolver.address} has ${ethers.formatEther(bal)} AVAX; needs about ${ethers.formatEther(need)} + gas`,
    );
  }
  const yes = await createPool(cfg, keystore, resolver, "YES");
  const no = await createPool(cfg, keystore, resolver, "NO");
  return { yes, no };
}
