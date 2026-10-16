/** The browser bet flow: network -> keys -> register -> balance -> shield -> proof -> send. */
import { ethers } from "ethers";
import { config } from "@/config";
import { fetchDecimals, provider, withRetry, type Market } from "@/lib/chain";
import { UserError } from "@/lib/errors";
import type { EercSession } from "@/lib/session";
import { getEercWorker } from "@/lib/eerc/workerClient";
import type { PythiaWalletClient } from "@/lib/wallet";

export type BetStage = "network" | "keys" | "register" | "balance" | "shield" | "proof" | "wallet" | "confirm" | "done";

export const STAGE_LABELS: Record<BetStage, string> = {
  network: "Checking network",
  keys: "Unlocking your private key",
  register: "Registering your key (one-time)",
  balance: "Reading your encrypted balance",
  shield: "Shielding USDC",
  proof: "Generating zero-knowledge proof",
  wallet: "Confirm in your wallet",
  confirm: "Waiting for confirmation",
  done: "Bet placed",
};

// One consistent JSON ABI (ethers and viem both accept it; mixing string and JSON entries breaks ethers).
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

export interface BetResult {
  hash: string;
  /** Time spent generating the transfer proof in the worker (ms), as reported by the SDK. */
  proofMs: number | null;
  totalMs: number;
}

export async function placeBet(args: {
  walletClient: PythiaWalletClient;
  ensureNetwork: () => Promise<void>;
  unlock: () => Promise<EercSession>;
  markRegistered: () => void;
  market: Market;
  side: "YES" | "NO";
  /** Amount in eERC base units. */
  amount: bigint;
  onStage: (s: BetStage, detail?: { hash?: string }) => void;
}): Promise<BetResult> {
  const { walletClient: wc, market, side, amount, onStage } = args;
  const t0 = performance.now();

  // Guard against betting into a market that is no longer open (the contract does not stop this).
  const head = await withRetry(() => provider.getBlock("latest"));
  if (market.status !== "Open" || (head && head.timestamp >= market.closeTime)) {
    throw new UserError("This market has closed. New bets are no longer accepted.", "CLOSED");
  }

  onStage("network");
  await args.ensureNetwork();

  onStage("keys");
  const session = await args.unlock();

  const worker = getEercWorker();
  await worker.init({ address: session.address, decryptionKey: session.decryptionKey, walletClient: wc });

  if (!session.registered) {
    onStage("register");
    await worker.call("register", undefined, (s) => s === "wallet" && onStage("wallet"));
    args.markRegistered();
  }

  onStage("balance");
  let bal = await worker.call<{ total: bigint; decimals: bigint }>("balance");
  if (bal.total < amount) {
    onStage("shield");
    const dec = await fetchDecimals();
    const needToken = (amount - bal.total) * 10n ** BigInt(dec.token - dec.eerc);
    const erc20 = new ethers.Contract(config.addresses.token, ERC20_ABI as never, provider);
    const have: bigint = await withRetry(() => erc20.balanceOf(session.address));
    if (have < needToken) {
      throw new UserError(
        `Your encrypted balance is too low and you only hold ${ethers.formatUnits(have, dec.token)} public USDC (need ${ethers.formatUnits(needToken, dec.token)} more). Get Fuji USDC at ${config.usdcFaucetUrl}`,
        "NO_USDC",
      );
    }
    const core = await import("@pythia/eerc-core");
    const client = core.createEercClient({
      walletClient: wc,
      rpcUrl: config.rpcUrl,
      addresses: { encryptedERC: config.addresses.encryptedERC, registrar: config.addresses.registrar, token: config.addresses.token },
      circuitsBaseUrl: "",
      decryptionKey: session.decryptionKey,
    });
    onStage("wallet");
    await core.deposit(client, needToken, async (spender, amt) => {
      const h = await wc.writeContract({ address: config.addresses.token, abi: ERC20_ABI, functionName: "approve", args: [spender as `0x${string}`, amt] });
      await provider.waitForTransaction(h);
    });
    // The new balance must be visible before proving against it.
    for (let i = 0; i < 6 && bal.total < amount; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      bal = await worker.call<{ total: bigint; decimals: bigint }>("balance");
    }
    if (bal.total < amount) throw new UserError("Your shielded balance has not updated yet. Wait a few seconds and try again.");
  }

  const pool = side === "YES" ? market.yesPool : market.noPool;
  onStage("proof");
  let hash = "";
  const r = await worker.call<{ hash: string; proofMs: number | null }>("transfer", { to: pool, amount }, (stage, detail) => {
    if (stage === "wallet") onStage("wallet");
    if (stage === "submitted") {
      hash = (detail as { hash: string }).hash;
      onStage("confirm", { hash });
    }
  });
  onStage("done", { hash: r.hash });
  return { hash: r.hash, proofMs: r.proofMs, totalMs: performance.now() - t0 };
}
