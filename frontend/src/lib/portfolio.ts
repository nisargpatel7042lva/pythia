/**
 * Portfolio scan. Finds the user's own transfers to/from pool accounts on-chain, then decrypts the
 * amounts locally (in the worker) with their own key. Nothing is sent anywhere.
 */
import { ethers } from "ethers";
import { config } from "@/config";
import { provider, withRetry, type Market } from "@/lib/chain";
import type { EercSession } from "@/lib/session";
import { getEercWorker } from "@/lib/eerc/workerClient";
import type { PythiaWalletClient } from "@/lib/wallet";

const TOPIC = ethers.id("PrivateTransfer(address,address,uint256[7],address)");
const CHUNK = 2000;

export interface PortfolioRow {
  kind: "bet" | "payout";
  marketId: number;
  side: "YES" | "NO";
  /** eERC base units, or null if this transfer could not be decrypted. */
  amount: bigint | null;
  txHash: string;
  blockTime: number;
}

async function scan(topics: (string | string[] | null)[], from: number, to: number) {
  const ranges: [number, number][] = [];
  for (let s = from; s <= to; s += CHUNK) ranges.push([s, Math.min(s + CHUNK - 1, to)]);
  const out: ethers.Log[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < ranges.length) {
        const [a, b] = ranges[next++];
        out.push(...(await withRetry(() => provider.getLogs({ address: config.addresses.encryptedERC, topics, fromBlock: a, toBlock: b }))));
      }
    }),
  );
  return out;
}

export async function loadPortfolio(args: {
  session: EercSession;
  walletClient: PythiaWalletClient;
  markets: Market[];
  onProgress: (msg: string) => void;
}): Promise<PortfolioRow[]> {
  const { session, markets, onProgress } = args;
  const user = ethers.zeroPadValue(session.address, 32);
  const poolInfo = new Map<string, { marketId: number; side: "YES" | "NO" }>();
  for (const m of markets) {
    poolInfo.set(m.yesPool.toLowerCase(), { marketId: m.id, side: "YES" });
    poolInfo.set(m.noPool.toLowerCase(), { marketId: m.id, side: "NO" });
  }
  if (poolInfo.size === 0) return [];
  const pools = [...poolInfo.keys()].map((p) => ethers.zeroPadValue(p, 32));
  const head = await withRetry(() => provider.getBlockNumber());

  onProgress("Scanning the chain for your transfers…");
  const [sent, received] = await Promise.all([
    scan([TOPIC, user, pools], config.deployBlock, head),
    scan([TOPIC, pools, user], config.deployBlock, head),
  ]);

  const items: { key: string; kind: "sent" | "received"; data: string }[] = [];
  const meta = new Map<string, Omit<PortfolioRow, "amount">>();
  const blockTimes = new Map<number, number>();
  const add = async (log: ethers.Log, kind: "sent" | "received") => {
    const poolAddr = (kind === "sent" ? ethers.getAddress("0x" + log.topics[2].slice(26)) : ethers.getAddress("0x" + log.topics[1].slice(26))).toLowerCase();
    const info = poolInfo.get(poolAddr)!;
    const tx = await withRetry(() => provider.getTransaction(log.transactionHash));
    if (!blockTimes.has(log.blockNumber)) blockTimes.set(log.blockNumber, (await withRetry(() => provider.getBlock(log.blockNumber)))!.timestamp);
    const key = `${log.transactionHash}:${log.index}`;
    items.push({ key, kind, data: tx!.data });
    meta.set(key, { kind: kind === "sent" ? "bet" : "payout", marketId: info.marketId, side: info.side, txHash: log.transactionHash, blockTime: blockTimes.get(log.blockNumber)! });
  };
  for (const l of sent) await add(l, "sent");
  for (const l of received) await add(l, "received");
  if (items.length === 0) return [];

  onProgress(`Decrypting ${items.length} transfer${items.length === 1 ? "" : "s"} in your browser…`);
  const worker = getEercWorker();
  await worker.init({ address: session.address, decryptionKey: session.decryptionKey, walletClient: args.walletClient });
  const results = await worker.call<{ key: string; amount?: bigint; error?: string }[]>("decrypt", { items }, (stage, detail) => {
    if (stage === "table") onProgress("Preparing local decryption tables…");
    if (stage === "decrypted") onProgress(`Decrypted ${(detail as { done: number; total: number }).done}/${(detail as { total: number }).total}`);
  });
  return results
    .map((r) => ({ ...meta.get(r.key)!, amount: r.amount ?? null }))
    .sort((a, b) => b.blockTime - a.blockTime);
}
