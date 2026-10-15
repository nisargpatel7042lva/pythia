/**
 * Create one real price-feed market on Fuji: "Will AVAX/USD be above $X ...?" resolved from the
 * live Chainlink AVAX/USD feed. The strike is derived from the feed's current price.
 *
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/createMarket.ts --network fuji
 *
 * The YES/NO pool addresses are fresh random EOAs. They are NOT yet registered on the eERC
 * Registrar (that belongs to the resolver phase). Their private keys are saved to
 * contracts/.pool-keys/ (gitignored) so a later phase can register and use them.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

const FEED = "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD"; // Chainlink AVAX / USD, Fuji
const CLOSE_IN_SECONDS = 24 * 60 * 60;

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/fuji.json"), "utf8"));
  const [owner] = await ethers.getSigners();
  const markets = await ethers.getContractAt("PythiaMarkets", dep.address, owner);

  const feed = await ethers.getContractAt("AggregatorV3Interface", FEED);
  const decimals = Number(await feed.decimals());
  const [, answer, , updatedAt] = await feed.latestRoundData();
  console.log(`feed ${await feed.description()}: ${ethers.formatUnits(answer, decimals)} (updated ${updatedAt})`);

  // Strike = current price rounded to the nearest $0.25, in feed decimals.
  const quarter = 10n ** BigInt(decimals) / 4n;
  const strike = ((answer + quarter / 2n) / quarter) * quarter;
  const strikeStr = ethers.formatUnits(strike, decimals);

  const closeTime = Math.floor(Date.now() / 1000) + CLOSE_IN_SECONDS;
  const closeStr = new Date(closeTime * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const question = `Will AVAX/USD be above $${strikeStr} at ${closeStr}?`;

  const yesPool = ethers.Wallet.createRandom();
  const noPool = ethers.Wallet.createRandom();

  const tx = await markets.createMarket(
    question,
    "crypto",
    yesPool.address,
    noPool.address,
    closeTime,
    1, // ResolutionType.PriceFeed
    FEED,
    strike,
    true,
  );
  console.log("tx:", tx.hash);
  const receipt = await tx.wait();
  const ev = receipt!.logs
    .map((l) => {
      try {
        return markets.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "MarketCreated");
  const marketId = ev!.args.marketId as bigint;

  const keysDir = path.join(__dirname, "../.pool-keys");
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(
    path.join(keysDir, `market-${marketId}.json`),
    JSON.stringify(
      {
        marketId: marketId.toString(),
        yes: { address: yesPool.address, privateKey: yesPool.privateKey },
        no: { address: noPool.address, privateKey: noPool.privateKey },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  const m = await markets.getMarket(marketId);
  console.log("marketId  :", marketId.toString());
  console.log("question  :", m.question);
  console.log("yesPool   :", m.yesPool);
  console.log("noPool    :", m.noPool);
  console.log("closeTime :", m.closeTime.toString(), closeStr);
  console.log("strike    :", ethers.formatUnits(m.strikePrice, decimals));
  console.log("status    :", m.status.toString(), "(0 = Open)");
  console.log("explorer  :", `https://testnet.snowtrace.io/tx/${tx.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
