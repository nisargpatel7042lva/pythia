"use client";

import Link from "next/link";
import { useState } from "react";
import { Frame } from "@/components/Nav";
import { PageHead } from "@/components/Page";
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
      setRows(await loadPortfolio({ session, walletClient: w.getWalletClient(), onProgress: setStatus }));
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
  const net = sum(payouts) - sum(bets);

  return (
    <>
      <PageHead tag="Visible only to you" title="Portfolio" sub="Your bets and payouts, decrypted locally in this browser from your own transfers using your own key. Nothing is sent to any server." />
      <Frame>
        <div className="border-b border-line p-6 sm:p-10">
          {!w.address ? (
            <button className="btn-primary px-6 py-3.5 text-base" onClick={() => w.connect()} disabled={w.connecting}>
              Connect wallet
            </button>
          ) : !w.onFuji ? (
            <Banner tone="warn">Your wallet is on another network. Switch to Avalanche Fuji, then decrypt your activity.</Banner>
          ) : (
            <button className="btn-primary px-6 py-3.5 text-base" onClick={run} disabled={!!status}>
              {status ? <Spinner /> : null} {rows ? "Refresh" : "Decrypt my activity"}
            </button>
          )}
          {status && <p className="tag num mt-4 text-fog">{status}</p>}
          {error && (
            <div className="mt-5">
              <Banner tone={error.code === "REJECTED" ? "warn" : "error"}>{error.message}</Banner>
            </div>
          )}
        </div>

        {rows && rows.length === 0 && (
          <p className="p-8 text-sm text-fog">
            No bets found for this wallet yet.{" "}
            <Link className="text-coral underline" href="/markets">
              Browse markets
            </Link>
          </p>
        )}

        {rows && rows.length > 0 && (
          <>
            <div className="grid border-b border-line sm:grid-cols-3">
              <Stat label="Total staked" value={`${fmtUnits(sum(bets), dec)}`} unit="USDC" />
              <Stat label="Payouts received" value={`${fmtUnits(sum(payouts), dec)}`} unit="USDC" accent />
              <Stat label="Net" value={`${net >= 0n ? "+" : "-"}${fmtUnits(net >= 0n ? net : -net, dec)}`} unit="USDC" tone={net >= 0n ? "up" : "down"} last />
            </div>
            <Table title="Your bets" rows={bets} q={q} dec={dec} />
            <Table title="Payouts received" rows={payouts} q={q} dec={dec} empty="No payouts yet. They arrive after a market is resolved." />
          </>
        )}
      </Frame>
    </>
  );
}

function Stat({ label, value, unit, accent, tone, last }: { label: string; value: string; unit: string; accent?: boolean; tone?: "up" | "down"; last?: boolean }) {
  return (
    <div className={`border-b border-line p-6 sm:border-b-0 sm:p-10 ${last ? "" : "sm:border-r"}`}>
      <p className="tag text-fog">{label}</p>
      <p className={`display num mt-3 text-5xl sm:text-6xl ${accent ? "text-coral" : tone === "up" ? "text-lime" : tone === "down" ? "text-coral" : ""}`}>
        {value}
        <span className="tag ml-2 text-fog">{unit}</span>
      </p>
    </div>
  );
}

function Table({ title, rows, q, dec, empty }: { title: string; rows: PortfolioRow[]; q: (id: number) => string; dec: number; empty?: string }) {
  return (
    <section className="border-b border-line">
      <p className="tag border-b border-line px-6 py-4 text-coral sm:px-10">{title}</p>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-fog sm:px-10">{empty ?? "None."}</p>
      ) : (
        rows.map((r) => (
          <div key={r.txHash} className="grid gap-x-6 gap-y-2 border-b border-line px-6 py-5 last:border-b-0 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-10">
            <div className="min-w-0">
              <Link href={`/markets/${r.marketId}`} className="display block truncate text-xl hover:text-coral">
                {q(r.marketId)}
              </Link>
              <span className="tag text-fog">
                {r.kind === "bet" ? `on ${r.side}` : `from the ${r.side} pool`} · {fmtDateTime(r.blockTime)}
              </span>
            </div>
            <span className="num text-2xl text-coral">{r.amount === null ? "could not decrypt" : `${fmtUnits(r.amount, dec)} USDC`}</span>
            <TxLink hash={r.txHash} />
          </div>
        ))
      )}
    </section>
  );
}
