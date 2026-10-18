/**
 * Privacy inspector: shows everything an outside observer can read from a bet transaction and
 * searches ALL of it (native value, calldata words, log topics and data) for the plaintext amount.
 *
 *   tsx scripts/inspectTx.ts <txHash> <amountEerc, e.g. 1.50>
 *
 * The amount is searched in every representation a plaintext leak could take: eERC units
 * (2 decimals), USDC units (6 decimals), 18-decimals, and the decimal string / hex ASCII.
 */
import { makeProvider } from "../src/rpc.js";
import { ethers } from "ethers";
import { ENCRYPTED_ERC_ABI } from "@pythia/eerc-core";
import { loadConfig } from "../src/config.js";

async function main() {
  const [hash, amountStr] = process.argv.slice(2);
  if (!hash || !amountStr) throw new Error("usage: inspectTx.ts <txHash> <amount>");
  const cfg = loadConfig();
  const p = makeProvider(cfg.rpcUrl);
  const iface = new ethers.Interface(ENCRYPTED_ERC_ABI);
  const tx = (await p.getTransaction(hash))!;
  const rc = (await p.getTransactionReceipt(hash))!;

  console.log("from   :", tx.from);
  console.log("to     :", tx.to);
  console.log("value  :", tx.value.toString(), "wei (native AVAX)");
  const call = iface.parseTransaction({ data: tx.data, value: tx.value })!;
  console.log("method :", call.name, `(calldata ${(tx.data.length - 2) / 2} bytes)`);
  console.log("  to      :", call.args.to);
  console.log("  tokenId :", call.args.tokenId.toString());
  console.log("logs   :");
  for (const l of rc.logs) {
    const parsed = (() => {
      try {
        return iface.parseLog(l);
      } catch {
        return null;
      }
    })();
    console.log(`  ${l.address} ${parsed ? parsed.name : l.topics[0].slice(0, 10)} (data ${(l.data.length - 2) / 2} bytes)`);
  }

  // Collect every 32-byte word an observer can see.
  const words: { where: string; v: bigint }[] = [];
  const addHex = (where: string, hex: string) => {
    const h = hex.slice(2);
    for (let i = 0; i < h.length; i += 64) {
      const chunk = h.slice(i, i + 64);
      words.push({ where, v: BigInt("0x" + chunk.padEnd(64, "0")) });
    }
  };
  // calldata: skip the 4-byte selector, then 32-byte aligned words
  const body = "0x" + tx.data.slice(10);
  addHex("calldata", body);
  for (const l of rc.logs) {
    l.topics.forEach((t, i) => words.push({ where: `log topic${i}`, v: BigInt(t) }));
    addHex("log data", l.data);
  }
  words.push({ where: "tx.value", v: tx.value });

  // Every plausible plaintext encoding of the amount.
  const needles = new Map<string, bigint>();
  for (const dec of [2, 6, 18]) needles.set(`amount*10^${dec}`, ethers.parseUnits(amountStr, dec));
  needles.set("integer part", BigInt(amountStr.split(".")[0]));
  const found = [...needles].flatMap(([label, n]) => words.filter((w) => w.v === n && n > 1n).map((w) => `${label} @ ${w.where}`));
  const dataHex = (tx.data + rc.logs.map((l) => l.data).join("")).toLowerCase();
  const ascii = ethers.hexlify(ethers.toUtf8Bytes(amountStr)).slice(2).toLowerCase();
  if (dataHex.includes(ascii)) found.push(`ASCII "${amountStr}" in raw bytes`);

  const small = words.filter((w) => w.v < 2n ** 64n).map((w) => `${w.v}@${w.where}`);
  console.log(`\n32-byte words visible: ${words.length}; small (<2^64) words: ${small.join(", ") || "none"}`);
  console.log(`searched for amount ${amountStr} as eERC units/USDC units/wei/ASCII -> ${found.length ? "FOUND: " + found.join("; ") : "NOT FOUND (amount is not visible)"}`);
  process.exit(found.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
