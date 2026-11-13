/**
 * Demo bots: a few automated TEST wallets that keep the demo alive so a visitor can watch a whole
 * market lifecycle (bets -> batched odds -> resolution -> private payouts) without waiting for real users.
 *
 * What it is, honestly: real wallets placing real private eERC transfers on Fuji with small random
 * stakes and random sides. They are NOT independent users, and the app labels them as demo bots.
 * It does not create balances or fake any data; if a wallet runs out of funds its bets simply fail.
 *
 *   tsx scripts/demoBots.ts                      # run forever (one round every --interval seconds)
 *   tsx scripts/demoBots.ts --once               # one round, then exit
 *
 * Each round it (1) makes sure at least --min-open short AVAX/USD markets are open, created with the
 * owner key (DEPLOYER_PRIVATE_KEY), with staggered close times (--horizons, minutes) so something
 * resolves every so often, and (2) places up to --bets-per-round bets on the least-populated markets.
 *
 * Wallets: DEMO_BOT_KEYS=0xkey1,0xkey2,...  (else BETTOR_PRIVATE_KEY_1..9). Fund them yourself with
 * Fuji AVAX and Fuji USDC; the script never moves funds between wallets. Publish their addresses with
 * DEMO_BOT_ADDRESSES=0x...,0x... in the resolver's environment so the UI can label them.
 * The resolver service must be running to publish odds, resolve and pay out.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ethers } from "ethers";
import { loadConfig, loadMarketsAbi } from "../src/config.js";
import { makeProvider } from "../src/rpc.js";

const { values: a } = parseArgs({
  options: {
    once: { type: "boolean", default: false },
    interval: { type: "string", default: "90" },
    "min-open": { type: "string", default: "4" },
    "bets-per-round": { type: "string", default: "3" },
    "max-bets": { type: "string", default: "7" },
    horizons: { type: "string", default: "25,45,90,180" },
    api: { type: "string" },
  },
});

const RESOLVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_REMAINING_S = 180; // never bet into a market that is about to close
const FEED = "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD"; // Chainlink AVAX/USD on Fuji
const FEED_ABI = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];

const minOpen = Number(a["min-open"]);
const betsPerRound = Number(a["bets-per-round"]);
const maxBets = Number(a["max-bets"]);
const horizons = a.horizons!.split(",").map(Number).filter((n) => n > 0);
const intervalMs = Number(a.interval) * 1000;
const apiBase = a.api ?? `http://127.0.0.1:${process.env.RESOLVER_API_PORT ?? 8787}`;

const log = (m: string) => console.log(`${new Date().toISOString().replace("T", " ").slice(0, 19)} ${m}`);

function botKeys(): string[] {
  const fromEnv = (process.env.DEMO_BOT_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => process.env[`BETTOR_PRIVATE_KEY_${n}`]).filter((k): k is string => !!k);
}

/** Run `npx tsx <args>` in the resolver directory; never prints env (keys). */
function runTsx(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("npx", ["tsx", ...args], { cwd: RESOLVER_DIR, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}
const lastLines = (s: string, n = 3) =>
  s.split("\n").filter((l) => /\b(tx|link|proof\+submit|marketId|Error|error)\b/.test(l) && !/^\[EERC\]/.test(l)).slice(-n).join(" | ");

const roundQuarter = (x: number) => Math.round(x * 4) / 4;
let createdCount = 0;

async function round(provider: ethers.JsonRpcProvider, markets: ethers.Contract, keys: string[]) {
  const now = Math.floor(Date.now() / 1000);
  const openIds: bigint[] = await markets.getMarketsByStatus(0);
  const live: { id: number; closeTime: number }[] = [];
  for (const id of openIds) {
    const m = await markets.getMarket(id);
    const closeTime = Number(m.closeTime);
    if (closeTime > now + MIN_REMAINING_S && !String(m.question).startsWith("[perf test")) live.push({ id: Number(id), closeTime });
  }
  log(`open markets with time left: ${live.length} (${live.map((m) => "#" + m.id).join(" ") || "none"})`);

  // 1. keep short markets coming so something resolves regularly
  for (let i = live.length; i < minOpen; i++) {
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      log("DEPLOYER_PRIVATE_KEY is not set: cannot create markets (bets only)");
      break;
    }
    const spot = Number(ethers.formatUnits((await new ethers.Contract(FEED, FEED_ABI, provider).latestRoundData())[1], 8));
    const mins = horizons[createdCount % horizons.length];
    const above = createdCount % 2 === 0;
    const strike = Math.max(0.25, roundQuarter(spot) + [0, 0.25, -0.25, 0.5, -0.5][createdCount % 5]);
    createdCount++;
    log(`creating AVAX/USD market: ${above ? "above" : "below"} $${strike.toFixed(2)} closing in ${mins} min (spot $${spot.toFixed(2)})`);
    const r = await runTsx(
      ["scripts/createMarket.ts", "--type", "pricefeed", "--direction", above ? "above" : "below", "--strike", strike.toFixed(2), "--close-in", String(mins)],
      { POOL_GAS_FUND: process.env.POOL_GAS_FUND ?? "0.005" },
    );
    log(r.code === 0 ? `  created: ${lastLines(r.out, 2)}` : `  create failed: ${lastLines(r.out) || r.out.slice(-200)}`);
  }

  // 2. place a few small bets on the least-populated markets
  const counts = new Map<number, number>();
  for (const m of live) {
    try {
      const r = await fetch(`${apiBase}/markets/${m.id}/activity`);
      counts.set(m.id, r.ok ? ((await r.json()) as { count: number }).count : maxBets);
    } catch {
      counts.set(m.id, maxBets); // resolver API unreachable: do not pile bets on blindly
    }
  }
  const candidates = live.filter((m) => (counts.get(m.id) ?? maxBets) < maxBets).sort((x, y) => counts.get(x.id)! - counts.get(y.id)!);
  if (!candidates.length) log("no market needs more bets (or the resolver API is unreachable)");
  for (let b = 0; b < betsPerRound && candidates.length; b++) {
    const m = candidates[b % candidates.length];
    const botIdx = Math.floor(Math.random() * keys.length);
    const side = Math.random() < 0.5 ? "yes" : "no";
    const amount = (0.05 + Math.floor(Math.random() * 26) / 100).toFixed(2); // 0.05 .. 0.30
    const addr = new ethers.Wallet(keys[botIdx]).address;
    log(`bet: bot ${addr.slice(0, 8)}… -> market #${m.id} ${side.toUpperCase()} ${amount} USDC`);
    const r = await runTsx(["scripts/placeBet.ts", "--wallet", "1", "--market", String(m.id), "--side", side, "--amount", amount], { BETTOR_PRIVATE_KEY_1: keys[botIdx] });
    log(r.code === 0 ? `  placed: ${lastLines(r.out, 2)}` : `  bet failed: ${lastLines(r.out) || r.out.slice(-200)}`);
    counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  }
}

async function main() {
  const keys = botKeys();
  if (!keys.length) throw new Error("no bot wallets: set DEMO_BOT_KEYS (comma-separated) or BETTOR_PRIVATE_KEY_1..");
  const addrs = keys.map((k) => new ethers.Wallet(k).address);
  log(`demo bots: ${addrs.length} wallet(s)`);
  log(`label them in the UI by adding to the resolver env: DEMO_BOT_ADDRESSES=${addrs.join(",")}`);

  const cfg = loadConfig();
  const provider = makeProvider(cfg.rpcUrl);
  const markets = new ethers.Contract(cfg.marketsAddress, loadMarketsAbi() as ethers.InterfaceAbi, provider);

  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  do {
    try {
      await round(provider, markets, keys);
    } catch (e) {
      log(`round failed: ${(e as Error).message.split("\n")[0]}`);
    }
    if (a.once || stop) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (!stop);
  log("demo bots stopped");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
