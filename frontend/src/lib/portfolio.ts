/**
 * Portfolio. The resolver's index tells us WHICH transactions involve this address (hashes only,
 * never amounts). We then fetch each transaction from the chain and decrypt its amount locally,
 * in the worker, with the user's own key. Nothing about the amounts leaves the browser.
 */
import { provider, withRetry } from "@/lib/chain";
import { fetchAccountActivity } from "@/lib/resolverApi";
import type { EercSession } from "@/lib/session";
import { getEercWorker } from "@/lib/eerc/workerClient";
import type { PythiaWalletClient } from "@/lib/wallet";

export interface PortfolioRow {
  kind: "bet" | "payout";
  marketId: number;
  side: "YES" | "NO";
  /** eERC base units, or null if this transfer could not be decrypted. */
  amount: bigint | null;
  txHash: string;
  blockTime: number;
}

export async function loadPortfolio(args: {
  session: EercSession;
  walletClient: PythiaWalletClient;
  onProgress: (msg: string) => void;
}): Promise<PortfolioRow[]> {
  const { session, onProgress } = args;

  onProgress("Looking up your transactions…");
  const { items: found } = await fetchAccountActivity(session.address);
  if (found.length === 0) return [];

  onProgress(`Fetching ${found.length} transaction${found.length === 1 ? "" : "s"}…`);
  const items: { key: string; kind: "sent" | "received"; data: string }[] = [];
  const meta = new Map<string, Omit<PortfolioRow, "amount">>();
  const blockTimes = new Map<number, number>();
  for (const f of found) {
    const tx = await withRetry(() => provider.getTransaction(f.txHash));
    if (!tx || tx.blockNumber === null) continue;
    if (!blockTimes.has(tx.blockNumber)) {
      blockTimes.set(tx.blockNumber, (await withRetry(() => provider.getBlock(tx.blockNumber!)))!.timestamp);
    }
    items.push({ key: f.txHash, kind: f.kind === "bet" ? "sent" : "received", data: tx.data });
    meta.set(f.txHash, { kind: f.kind, marketId: f.marketId, side: f.side, txHash: f.txHash, blockTime: blockTimes.get(tx.blockNumber)! });
  }

  onProgress(`Decrypting ${items.length} transfer${items.length === 1 ? "" : "s"} in your browser…`);
  const worker = getEercWorker();
  await worker.init({ address: session.address, decryptionKey: session.decryptionKey, walletClient: args.walletClient });
  const results = await worker.call<{ key: string; amount?: bigint; error?: string }[]>("decrypt", { items }, (stage, detail) => {
    if (stage === "table") onProgress("Preparing local decryption tables…");
    if (stage === "decrypted") onProgress(`Decrypted ${(detail as { done: number; total: number }).done}/${(detail as { total: number }).total}`);
  });
  return results.map((r) => ({ ...meta.get(r.key)!, amount: r.amount ?? null })).sort((a, b) => b.blockTime - a.blockTime);
}
