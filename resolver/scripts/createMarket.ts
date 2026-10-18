/**
 * Create a market: fresh YES/NO pool accounts (funded + registered on eERC), then
 * PythiaMarkets.createMarket as the contract owner.
 *
 *   # manual market
 *   tsx scripts/createMarket.ts --type manual --question "Will X happen?" --category sports --close-in 60
 *   # price-feed market (Chainlink AVAX/USD on Fuji by default; strike defaults to the live price)
 *   tsx scripts/createMarket.ts --type pricefeed --direction above [--strike 9.5] [--feed 0x...] --close-in 60
 *
 * --close-in is minutes from now. Env: RESOLVER_PRIVATE_KEY (funds pools), DEPLOYER_PRIVATE_KEY
 * (PythiaMarkets owner), POOL_KEYSTORE_PASSPHRASE.
 */
import { makeProvider } from "../src/rpc.js";
import { parseArgs } from "node:util";
import { ethers } from "ethers";
import { keystorePassword, loadConfig, loadMarketsAbi, ownerPrivateKey, resolverPrivateKey } from "../src/config.js";
import { snowtraceAddress, snowtraceTx } from "../src/eerc.js";
import { Keystore } from "../src/keystore.js";
import { createPoolPair } from "../src/pools.js";

const FUJI_AVAX_USD = "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD"; // Chainlink, see CLAUDE.md
const FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];

const { values: a } = parseArgs({
  options: {
    type: { type: "string", default: "manual" },
    question: { type: "string" },
    category: { type: "string", default: "general" },
    "close-in": { type: "string", default: "60" },
    feed: { type: "string", default: FUJI_AVAX_USD },
    strike: { type: "string" },
    direction: { type: "string", default: "above" },
  },
});

async function main() {
  const type = a.type!.toLowerCase();
  if (type !== "manual" && type !== "pricefeed") throw new Error("--type must be manual or pricefeed");
  const closeInMin = Number(a["close-in"]);
  if (!(closeInMin > 0)) throw new Error("--close-in must be a positive number of minutes");

  const cfg = loadConfig();
  const provider = makeProvider(cfg.rpcUrl);
  const owner = new ethers.Wallet(ownerPrivateKey(), provider);
  const markets = new ethers.Contract(cfg.marketsAddress, loadMarketsAbi() as ethers.InterfaceAbi, owner);
  if ((await markets.owner()).toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(`DEPLOYER_PRIVATE_KEY (${owner.address}) is not the PythiaMarkets owner`);
  }

  let question = a.question;
  let feed = ethers.ZeroAddress;
  let strike = 0n;
  const above = a.direction !== "below";
  const closeTime = Math.floor(Date.now() / 1000) + Math.round(closeInMin * 60);
  const closeStr = new Date(closeTime * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

  if (type === "pricefeed") {
    feed = a.feed!;
    const f = new ethers.Contract(feed, FEED_ABI, provider);
    const dec = Number(await f.decimals());
    const desc: string = await f.description();
    if (a.strike) {
      strike = ethers.parseUnits(a.strike, dec);
    } else {
      const [, answer] = await f.latestRoundData();
      const q = 10n ** BigInt(dec) / 4n; // round to nearest 0.25
      strike = ((answer + q / 2n) / q) * q;
    }
    question ??= `Will ${desc} be ${above ? "above" : "below"} $${ethers.formatUnits(strike, dec)} at ${closeStr}?`;
  }
  if (!question) throw new Error("--question is required for manual markets");

  console.log("creating pool accounts...");
  const keystore = new Keystore(cfg.keystoreDir, keystorePassword());
  const pools = await createPoolPair(cfg, keystore, resolverPrivateKey());

  console.log("creating market on PythiaMarkets", cfg.marketsAddress);
  const tx = await markets.createMarket(
    question,
    a.category,
    pools.yes.address,
    pools.no.address,
    closeTime,
    type === "manual" ? 0 : 1,
    feed,
    strike,
    above,
  );
  const receipt = await tx.wait();
  const parsed = receipt.logs
    .map((l: ethers.Log) => {
      try {
        return markets.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p: ethers.LogDescription | null) => p?.name === "MarketCreated");
  const marketId: bigint = parsed!.args.marketId;

  keystore.updateMeta(pools.yes.address, { marketId: marketId.toString(), side: "YES" });
  keystore.updateMeta(pools.no.address, { marketId: marketId.toString(), side: "NO" });

  console.log("\nmarketId :", marketId.toString());
  console.log("question :", question);
  console.log("closeTime:", closeTime, closeStr);
  console.log("YES pool :", pools.yes.address, snowtraceAddress(pools.yes.address));
  console.log("NO  pool :", pools.no.address, snowtraceAddress(pools.no.address));
  console.log("tx       :", snowtraceTx(tx.hash));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
