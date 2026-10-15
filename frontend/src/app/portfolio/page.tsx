"use client";

import Link from "next/link";
import { useState } from "react";
import { Banner, Spinner, TxLink } from "@/components/ui";
import { fetchDecimals, fetchMarkets, type Market } from "@/lib/chain";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtUnits } from "@/lib/format";
import { loadPortfolio, type PortfolioRow } from "@/lib/portfolio";
import { useEercSession } from "@/lib/session";
import { useWallet } from "@/lib/wallet";

export default function PortfolioPage() {
  const w = useWallet();
  const { unlock } = useEercSession();
  const [rows, setRows] = useState<PortfolioRow[] | null>(null);
  const [markets, setMarkets] = useState<Map<number, Market>>(new Map());
  const [dec, setDec] = useState(2);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  async function run() {
    setError(null);
    setRows(null);
    try {
      setStatus("Unlocking your private key (one wallet signature)…");
      const session = await unlock();
      const [ms, d] = await Promise.all([fetchMarkets(), fetchDecimals()]);
      setMarkets(new Map(ms.map((m) => [m.id, m])));
      setDec(d.eerc);
      const r = await loadPortfolio({ session, walletClient: w.getWalletClient(), markets: ms, onProgress: setStatus });
      setRows(r);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setStatus(null);
    }
  }

  const bets = rows?.filter((r) => r.kind === "bet") ?? [];
  const payouts = rows?.filter((r) => r.kind === "payout") ?? [];
  const sum = (l: PortfolioRow[]) => l.reduce((s, r) => s + (r.amount ?? 0n), 0n);
  const q = (id: number) => markets.get(id)?.question ?? `Market #${id}`;

  return (
    <div>
      <h1 className="heading text-5xl">Portfolio</h1>
      <p className="mt-2 max-w-2xl text-sm text-fog">
        Your bets and payouts, decrypted locally in this browser from your own transfers using your own key. Nothing is sent to any server.
      </p>

      <div className="mt-8">
        {!w.address ? (
          <button className="btn-primary" onClick={() => w.connect()} disabled={w.connecting}>
            Connect wallet
          </button>
        ) : !w.onFuji ? (
          <Banner tone="warn">Your wallet is on another network. Switch to Avalanche Fuji, then decrypt your activity.</Banner>
        ) : (
          <button className="btn-primary" onClick={run} disabled={!!status}>
            {status ? <Spinner /> : null} {rows ? "Refresh" : "Decrypt my activity"}
          </button>
        )}
        {status && <p className="num mt-3 text-sm text-fog">{status}</p>}
        {error && (
          <div className="mt-4">
            <Banner tone={error.code === "REJECTED" ? "warn" : "error"}>{error.message}</Banner>
          </div>
        )}
      </div>

      {rows && rows.length === 0 && (
        <p className="mt-8 text-sm text-fog">
          No bets found for this wallet yet. <Link className="text-violet-soft underline" href="/markets">Browse markets</Link>
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-10 space-y-10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <p className="label">Total staked</p>
              <p className="num text-xl">{fmtUnits(sum(bets), dec)} USDC</p>
            </div>
            <div className="card p-4">
              <p className="label">Payouts received</p>
              <p className="num text-xl text-gold">{fmtUnits(sum(payouts), dec)} USDC</p>
            </div>
            <div className="card col-span-2 p-4 sm:col-span-1">
              <p className="label">Net</p>
              <p className={`num text-xl ${sum(payouts) >= sum(bets) ? "text-yes" : "text-no"}`}>
                {sum(payouts) >= sum(bets) ? "+" : "-"}
                {fmtUnits(sum(payouts) >= sum(bets) ? sum(payouts) - sum(bets) : sum(bets) - sum(payouts), dec)} USDC
              </p>
            </div>
          </div>

          <Table title="Your bets" rows={bets} q={q} dec={dec} />
          <Table title="Payouts received" rows={payouts} q={q} dec={dec} empty="No payouts yet. They arrive after a market is resolved." />
        </div>
      )}
    </div>
  );
}

function Table({ title, rows, q, dec, empty }: { title: string; rows: PortfolioRow[]; q: (id: number) => string; dec: number; empty?: string }) {
  return (
    <section>
      <h2 className="heading mb-3 text-2xl">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-fog">{empty ?? "None."}</p>
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((r) => (
            <div key={r.txHash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <div className="min-w-0">
                <Link href={`/markets/${r.marketId}`} className="block truncate text-pearl hover:text-violet-soft">
                  {q(r.marketId)}
                </Link>
                <span className="text-xs text-fog">
                  {r.kind === "bet" ? `on ${r.side}` : `from the ${r.side} pool`} · {fmtDateTime(r.blockTime)}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="num text-base text-gold">{r.amount === null ? "could not decrypt" : `${fmtUnits(r.amount, dec)} USDC`}</span>
                <TxLink hash={r.txHash} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
