/** Read-only chain access: PythiaMarkets state, token decimals, price feed metadata. */
import { ethers } from "ethers";
import marketsAbi from "@/abi/PythiaMarkets.abi.json";
import { config } from "@/config";

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
export const marketsContract = new ethers.Contract(config.addresses.markets, marketsAbi, provider);

/** The public RPC occasionally times out; retry with backoff before surfacing an error. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

export const STATUS = ["Open", "Closed", "Resolved", "Settled", "Cancelled"] as const;
export const OUTCOME = ["Unresolved", "Yes", "No", "Invalid"] as const;
export type StatusName = (typeof STATUS)[number];
export type OutcomeName = (typeof OUTCOME)[number];

export interface Market {
  id: number;
  question: string;
  category: string;
  yesPool: string;
  noPool: string;
  closeTime: number;
  resolveTime: number;
  status: StatusName;
  outcome: OutcomeName;
  resolutionType: "Manual" | "PriceFeed";
  priceFeed: string;
  strikePrice: bigint;
  priceAbove: boolean;
  publishedYes: bigint;
  publishedNo: bigint;
  publishedBetCount: number;
  lastPublishedAt: number;
  settlementTxCount: number;
}

function toMarket(m: ethers.Result): Market {
  return {
    id: Number(m.id),
    question: m.question,
    category: m.category,
    yesPool: m.yesPool,
    noPool: m.noPool,
    closeTime: Number(m.closeTime),
    resolveTime: Number(m.resolveTime),
    status: STATUS[Number(m.status)],
    outcome: OUTCOME[Number(m.outcome)],
    resolutionType: Number(m.resolutionType) === 1 ? "PriceFeed" : "Manual",
    priceFeed: m.priceFeed,
    strikePrice: BigInt(m.strikePrice),
    priceAbove: m.priceAbove,
    publishedYes: BigInt(m.publishedYesTotal),
    publishedNo: BigInt(m.publishedNoTotal),
    publishedBetCount: Number(m.publishedBetCount),
    lastPublishedAt: Number(m.lastPublishedAt),
    settlementTxCount: Number(m.settlementTxCount),
  };
}

export async function fetchMarket(id: number): Promise<Market> {
  return toMarket(await withRetry(() => marketsContract.getMarket(id)));
}

/** All markets, newest first. */
export async function fetchMarkets(): Promise<Market[]> {
  const count = Number(await withRetry(() => marketsContract.getMarketCount()));
  const all = await Promise.all(Array.from({ length: count }, (_, i) => fetchMarket(i)));
  return all.sort((a, b) => b.id - a.id);
}

export async function fetchOwner(): Promise<string> {
  return withRetry(() => marketsContract.owner());
}

let decimalsCache: Promise<{ eerc: number; token: number }> | null = null;
/** eERC amounts use EncryptedERC.decimals(); the wrapped token has its own (USDC: 6). */
export function fetchDecimals(): Promise<{ eerc: number; token: number }> {
  decimalsCache ??= (async () => {
    const eerc = new ethers.Contract(config.addresses.encryptedERC, ["function decimals() view returns (uint8)"], provider);
    const token = new ethers.Contract(config.addresses.token, ["function decimals() view returns (uint8)"], provider);
    const [e, t] = await Promise.all([withRetry(() => eerc.decimals()), withRetry(() => token.decimals())]);
    return { eerc: Number(e), token: Number(t) };
  })();
  return decimalsCache;
}

const feedAbi = ["function decimals() view returns (uint8)", "function description() view returns (string)"];
export async function fetchFeedInfo(feed: string): Promise<{ decimals: number; description: string }> {
  const c = new ethers.Contract(feed, feedAbi, provider);
  const [decimals, description] = await Promise.all([withRetry(() => c.decimals()), withRetry(() => c.description())]);
  return { decimals: Number(decimals), description };
}
