/**
 * Simulate a bettor: private eERC transfer from a bettor wallet to a market's YES or NO pool.
 *
 *   tsx scripts/placeBet.ts --wallet 1 --market 3 --side yes --amount 1.50
 *
 * --wallet N reads BETTOR_PRIVATE_KEY_N. --amount is in eERC units of USDC (2 decimals).
 * Registers the bettor on eERC if needed and deposits USDC when the encrypted balance is short.
 */
import { parseArgs } from "node:util";
import { ethers } from "ethers";
import { createNodeWalletClient, deposit, isRegistered, privateTransfer, readEncryptedBalance, register, resolveDecryptionKey } from "@pythia/eerc-core";
import { bettorPrivateKey, loadConfig, loadMarketsAbi } from "../src/config.js";
import { makeEercClient, snowtraceTx } from "../src/eerc.js";

const { values: a } = parseArgs({
  options: {
    wallet: { type: "string" },
    market: { type: "string" },
    side: { type: "string" },
    amount: { type: "string" },
  },
});

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address,uint256) returns (bool)",
];

async function main() {
  if (!a.wallet || !a.market || !a.side || !a.amount) {
    throw new Error("usage: placeBet.ts --wallet N --market ID --side yes|no --amount 1.50");
  }
  const side = a.side.toLowerCase();
  if (side !== "yes" && side !== "no") throw new Error("--side must be yes or no");

  const cfg = loadConfig();
  const pk = bettorPrivateKey(Number(a.wallet));
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, undefined, { staticNetwork: true });
  const signer = new ethers.Wallet(pk, provider);

  // Market + pool for the chosen side.
  const markets = new ethers.Contract(cfg.marketsAddress, loadMarketsAbi() as ethers.InterfaceAbi, provider);
  const m = await markets.getMarket(BigInt(a.market));
  const now = (await provider.getBlock("latest"))!.timestamp;
  if (Number(m.status) !== 0 || now >= Number(m.closeTime)) throw new Error(`Market ${a.market} is not open for bets`);
  const pool: string = side === "yes" ? m.yesPool : m.noPool;
  console.log(`bettor ${signer.address} -> market ${a.market} "${m.question}"`);
  console.log(`side ${side.toUpperCase()} pool ${pool}`);

  // Bettor eERC client (key derived by the SDK from the wallet signature).
  const walletClient = await createNodeWalletClient(pk, cfg.rpcUrl);
  const { decryptionKey, scheme } = await resolveDecryptionKey(walletClient, signer, {
    rpcUrl: cfg.rpcUrl,
    addresses: cfg.eerc,
  });
  console.log(`eERC key scheme: ${scheme}`);
  const c = await makeEercClient(cfg, pk, decryptionKey);

  if (!(await isRegistered(c))) {
    console.log("bettor not registered on eERC; registering...");
    const r = await register(c);
    if (!r.alreadyRegistered) console.log("registered", snowtraceTx(r.transactionHash));
  }

  const bal = await readEncryptedBalance(c);
  const eercDecimals = Number(bal.decimals);
  const amount = ethers.parseUnits(a.amount, eercDecimals);
  console.log(`encrypted balance: ${ethers.formatUnits(bal.total, eercDecimals)} eUSDC, bet: ${a.amount}`);

  if (bal.total < amount) {
    // Top up by depositing public USDC (approve + deposit).
    const usdc = new ethers.Contract(cfg.eerc.token, ERC20_ABI, signer);
    const usdcDecimals = Number(await usdc.decimals());
    const needUnits = (amount - bal.total) * 10n ** BigInt(usdcDecimals - eercDecimals);
    const have: bigint = await usdc.balanceOf(signer.address);
    if (have < needUnits) {
      throw new Error(
        `Encrypted balance is short and public USDC balance ${ethers.formatUnits(have, usdcDecimals)} < ${ethers.formatUnits(needUnits, usdcDecimals)} needed`,
      );
    }
    console.log(`depositing ${ethers.formatUnits(needUnits, usdcDecimals)} USDC...`);
    const txHash = await deposit(c, needUnits, async (spender, amt) => {
      await (await usdc.approve(spender, amt)).wait();
    });
    console.log("deposit", snowtraceTx(txHash));
  }

  console.log("generating transfer proof + sending...");
  const { transactionHash, proofAndSubmitMs } = await privateTransfer(c, pool, amount);
  console.log(`proof+submit time: ${(proofAndSubmitMs / 1000).toFixed(1)}s`);
  console.log("tx   :", transactionHash);
  console.log("link :", snowtraceTx(transactionHash));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
