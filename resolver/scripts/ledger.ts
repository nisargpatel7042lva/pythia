/**
 * Ledger CLI.
 *   tsx scripts/ledger.ts sync            # backfill + catch up once
 *   tsx scripts/ledger.ts watch [ms]      # keep polling (default 10000 ms)
 *   tsx scripts/ledger.ts show [marketId] # print recorded bets
 *   tsx scripts/ledger.ts verify          # compare ledger sums to on-chain pool balances
 *   tsx scripts/ledger.ts reprocess FROM TO   # re-run a block range (idempotency check)
 */
import { ethers } from "ethers";
import { keystorePassword, loadConfig } from "../src/config.js";
import { snowtraceTx } from "../src/eerc.js";
import { Keystore } from "../src/keystore.js";
import { Ledger } from "../src/ledger.js";

const cfg = loadConfig();
const ledger = new Ledger(cfg, new Keystore(cfg.keystoreDir, keystorePassword()));
const fmt = (v: bigint) => ethers.formatUnits(v, 2); // EncryptedERC decimals = 2

async function main() {
  const [cmd = "sync", arg1, arg2] = process.argv.slice(2);
  switch (cmd) {
    case "sync": {
      const r = await ledger.sync();
      console.log(`synced blocks ${r.from}-${r.to}: inserted ${r.inserted}, already present ${r.skipped}`);
      break;
    }
    case "watch": {
      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      await ledger.watch(Number(arg1 ?? 10_000), ac.signal);
      break;
    }
    case "reprocess": {
      const r = await ledger.syncRange(Number(arg1), Number(arg2));
      console.log(`reprocessed ${arg1}-${arg2}: inserted ${r.inserted}, already present ${r.skipped}`);
      break;
    }
    case "show": {
      const bets = ledger.bets(arg1 === undefined ? undefined : Number(arg1));
      console.table(
        bets.map((b) => ({
          market: b.marketId,
          side: b.side,
          bettor: b.bettor,
          amount: fmt(b.amount),
          block: b.block,
          txHash: b.txHash,
        })),
      );
      for (const id of new Set(bets.map((b) => b.marketId))) {
        const t = ledger.totals(id);
        console.log(`market ${id}: ${t.count} bets, YES ${fmt(t.yes)}, NO ${fmt(t.no)}`);
      }
      for (const b of bets) console.log(snowtraceTx(b.txHash));
      break;
    }
    case "verify": {
      for (const v of await ledger.verifyAgainstChain()) {
        console.log(`market ${v.marketId} ${v.side} pool ${v.pool}: ledger ${fmt(v.ledger)} vs on-chain ${fmt(v.onChain)} -> ${v.ok ? "MATCH" : "MISMATCH"}`);
      }
      break;
    }
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

main().then(
  () => {
    ledger.close();
    process.exit(0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
