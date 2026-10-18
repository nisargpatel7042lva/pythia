"use client";

import { ethers } from "ethers";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Frame } from "@/components/Nav";
import { Logomark } from "@/components/Logo";
import { MarketRow } from "@/components/ui";
import { addressUrl, config, txUrl } from "@/config";
import { effectiveStatus, provider, withRetry } from "@/lib/chain";
import { countdown, shortAddr, yesPercent } from "@/lib/format";
import { useMarkets, useNow } from "@/lib/hooks";
import { CountUp, Reveal } from "@/lib/reveal";
import { fetchActivity, type ActivityBet } from "@/lib/resolverApi";

interface TxFacts {
  hash: string;
  from: string;
  to: string;
  value: string;
  bytes: number;
  preview: string;
}

/** Read a real transaction from the chain (nothing here is hardcoded except the hash in config). */
function useTx(hash: string) {
  const [facts, setFacts] = useState<TxFacts | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tx = await withRetry(() => provider.getTransaction(hash));
        if (!tx) throw new Error("not found");
        if (alive)
          setFacts({
            hash,
            from: tx.from,
            to: tx.to ?? "",
            value: `${ethers.formatEther(tx.value)} AVAX`,
            bytes: (tx.data.length - 2) / 2,
            preview: tx.data.length > 2 ? tx.data.slice(0, 74) : "0x",
          });
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [hash]);
  return { facts, error };
}

const STEPS = [
  { n: "01", title: "Bet privately", body: "Pick a side and an amount. Your browser encrypts the amount and proves, in zero knowledge, that you can cover it. Only ciphertext goes on-chain." },
  { n: "02", title: "Odds in batches", body: "Pool totals are published only after enough new bets arrive, so nobody can subtract two numbers to expose your stake." },
  { n: "03", title: "Paid privately", body: "When the market resolves, winners are paid from the pools through private transfers. Even the payouts stay hidden." },
];

/** Hairline label/value rows, the way the reference lays out its spec column. */
function Spec({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-ink border-t border-ink">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[120px_1fr] gap-4 px-6 py-3.5 sm:px-8">
          <dt className="tag">{k}</dt>
          <dd className="tag font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Marquee({ items }: { items: React.ReactNode[] }) {
  if (items.length === 0) return <div className="h-12 bg-ink" />;
  return (
    <div className="overflow-hidden border-y border-ink bg-ink py-3.5 text-sage" aria-label="Live activity">
      <div className="flex w-max animate-marquee gap-12 whitespace-nowrap hover:[animation-play-state:paused]">
        {[...items, ...items].map((it, i) => (
          <span key={i} className="tag flex items-center gap-12">
            {it}
            <span className="text-bone/30">/</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const now = useNow(1000);
  const { data: rawMarkets } = useMarkets();
  const markets = useMemo(() => rawMarkets?.map((m) => ({ ...m, status: effectiveStatus(m, now) })), [rawMarkets, now]);
  const plain = useTx(config.examplePlainTx);
  const bet = useTx(config.exampleBetTx);
  const [activity, setActivity] = useState<ActivityBet[]>([]);

  const live = useMemo(() => (markets ?? []).filter((m) => m.status === "Open"), [markets]);
  const newest = markets?.[0];

  useEffect(() => {
    const target = live[0] ?? newest;
    if (!target) return;
    fetchActivity(target.id)
      .then((r) => setActivity(r.bets.slice(-6)))
      .catch(() => setActivity([]));
  }, [live, newest]);

  const stats = useMemo(() => {
    const ms = markets ?? [];
    return {
      markets: ms.length,
      open: ms.filter((m) => m.status === "Open").length,
      bets: ms.reduce((s, m) => s + m.publishedBetCount, 0),
      payouts: ms.reduce((s, m) => s + m.settlementTxCount, 0),
    };
  }, [markets]);

  const marqueeItems = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (const m of (markets ?? []).slice(0, 4)) {
      const p = yesPercent(m.publishedYes, m.publishedNo);
      out.push(
        <span key={`m${m.id}`}>
          Market #{m.id} · {m.status} · {m.publishedBetCount} bets{p !== null ? ` · YES ${p.toFixed(0)}% / NO ${(100 - p).toFixed(0)}%` : ""}
        </span>,
      );
    }
    for (const b of activity) {
      out.push(
        <span key={b.txHash} className="flex items-center gap-3">
          {shortAddr(b.bettor)} → {b.side} <span className="redact !bg-sage" style={{ minWidth: "5.5em", height: "0.85em" }} /> hidden
        </span>,
      );
    }
    return out;
  }, [markets, activity]);

  return (
    <div>
      {/* ── HERO: sage, ruled, like the reference ───────────────────────── */}
      <section className="bg-sage text-ink">
        <Frame tone="sage">
          <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="relative flex min-h-[560px] flex-col justify-between border-b border-ink p-6 sm:p-10 lg:min-h-[680px] lg:border-b-0 lg:border-r">
              <div>
                <p className="tag mb-8 flex items-center gap-3 animate-rise">
                  <span className="h-2 w-2 bg-ink" /> Private prediction markets
                </p>
                <h1 className="display animate-rise leading-[1.12] text-[clamp(36px,4.3vw,68px)]" style={{ animationDelay: "80ms" }}>
                  On Polymarket, your bet size is{" "}
                  <span className="text-transparent [-webkit-text-stroke:2px_#0B1112]">public.</span>{" "}
                  <br className="hidden sm:block" />
                  <span className="redact-title">On PYTHIA, it isn&apos;t.</span>
                </h1>
              </div>
              <div className="mt-14 animate-rise" style={{ animationDelay: "220ms" }}>
                <p className="max-w-lg text-[20px] font-medium leading-snug tracking-[-0.02em] sm:text-[23px]">
                  Who bet and which side is public. How much is hidden, encrypted on-chain with eERC.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/markets" className="btn-dark px-6 py-3.5 text-base">
                    Launch App <span aria-hidden>→</span>
                  </Link>
                  <a href="#proof" className="btn-outline-ink px-6 py-3.5 text-base">
                    See the proof
                  </a>
                </div>
              </div>
            </div>

            <div className="flex flex-col">
              <div className="grid grid-cols-2 border-b border-ink">
                <p className="tag border-r border-ink px-6 py-3.5 sm:px-8">System</p>
                <p className="tag px-6 py-3.5 sm:px-8">Est. 2026</p>
              </div>
              {/* Square logo cell. The four rules are the box's own edges extended to the cell border,
                  so every line meets the box exactly and the mark sits dead centre. */}
              <div
                className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-12 sm:px-8"
                style={{ ["--box" as string]: "280px" }}
              >
                <div className="draw-x absolute inset-x-0 z-10 h-px bg-ink" style={{ top: "calc(50% - var(--box) / 2)" }} />
                <div className="draw-x absolute inset-x-0 z-10 h-px bg-ink" style={{ top: "calc(50% + var(--box) / 2)", animationDelay: "100ms" }} />
                <div className="draw-y absolute inset-y-0 z-10 w-px bg-ink" style={{ left: "calc(50% - var(--box) / 2)" }} />
                <div className="draw-y absolute inset-y-0 z-10 w-px bg-ink" style={{ left: "calc(50% + var(--box) / 2)", animationDelay: "100ms" }} />
                <div
                  className="relative z-0 flex animate-rise items-center justify-center bg-sage"
                  style={{ width: "var(--box)", height: "var(--box)", animationDelay: "300ms" }}
                >
                  <Logomark size={140} className="text-ink" />
                </div>
              </div>
              <Spec
                rows={[
                  ["Network", "Avalanche Fuji"],
                  ["Privacy", "eERC · amounts encrypted"],
                  ["Settlement", "Parimutuel · zero fee"],
                  ["Odds", "Published in batches, K ≥ 3"],
                ]}
              />
            </div>
          </div>
        </Frame>
      </section>

      <Marquee items={marqueeItems} />

      {/* ── LIVE STATS (real, from the chain) ────────────────────────────── */}
      <Frame>
        <div className="grid grid-cols-2 border-b border-line md:grid-cols-4">
          {[
            ["Markets created", stats.markets],
            ["Open right now", stats.open],
            ["Bets published", stats.bets],
            ["Private payouts sent", stats.payouts],
          ].map(([label, n], i) => (
            <div key={label as string} className={`border-line p-6 sm:p-8 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b md:border-b-0" : ""} ${i === 1 ? "md:border-r" : ""}`}>
              <p className="tag text-fog">{label as string}</p>
              <p className="display mt-3 text-5xl text-sage sm:text-6xl">{markets ? <CountUp to={n as number} /> : "·"}</p>
            </div>
          ))}
        </div>

        {/* ── ANATOMY: same chain, two transactions ─────────────────────── */}
        <section id="proof" className="scroll-mt-20 border-b border-line">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Reveal className="border-b border-line p-6 sm:p-10 lg:border-b-0 lg:border-r">
              <p className="tag mb-6 text-sage">Anatomy of a bet</p>
              <h2 className="display text-[clamp(32px,3.6vw,54px)]">Same chain. Different transparency.</h2>
              <p className="mt-6 max-w-md text-fog">
                Both transactions below are real and read live from Avalanche Fuji right now. One reveals its amount in plain sight. The other carries only proof and ciphertext.
              </p>
            </Reveal>
            <div className="grid md:grid-cols-2">
              <TxPanel title="A normal transfer" light facts={plain.facts} error={plain.error} amountLabel="Amount" amount={plain.facts?.value} visible />
              <TxPanel title="A PYTHIA bet" facts={bet.facts} error={bet.error} amountLabel="Amount" visible={false} />
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
        <section className="grid border-b border-line md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90} className={`group p-6 transition-colors hover:bg-sage hover:text-ink sm:p-10 ${i < 2 ? "md:border-r md:border-line" : ""} ${i < 2 ? "border-b border-line md:border-b-0" : ""}`}>
              <p className="display text-[84px] text-transparent [-webkit-text-stroke:1.5px_#EFE9DD] group-hover:[-webkit-text-stroke:1.5px_#0B1112]">{s.n}</p>
              <h3 className="display mt-8 text-4xl">{s.title}</h3>
              <p className="mt-4 text-fog group-hover:text-ink/80">{s.body}</p>
            </Reveal>
          ))}
        </section>

        {/* ── LIVE MARKETS ──────────────────────────────────────────────── */}
        <section>
          <div className="flex items-end justify-between border-b border-line p-6 sm:p-10">
            <div>
              <p className="tag mb-4 text-sage">Live on Fuji</p>
              <h2 className="display text-[clamp(32px,3.6vw,54px)]">Markets</h2>
            </div>
            <Link href="/markets" className="btn-ghost">
              All markets →
            </Link>
          </div>
          {!markets && <p className="p-8 text-sm text-fog">Loading markets from the chain…</p>}
          {(live.length ? live : markets ?? []).slice(0, 3).map((m, i) => (
            <MarketRow key={m.id} m={m} index={i + 1} yesPct={yesPercent(m.publishedYes, m.publishedNo)} countdownText={countdown(m.closeTime, now)} />
          ))}
        </section>
      </Frame>

      {/* ── TRUST: sage band, honest ─────────────────────────────────────── */}
      <section id="trust" className="mt-24 scroll-mt-16 bg-sage text-ink">
        <Frame tone="sage">
          <div className="grid lg:grid-cols-2">
            <div className="border-b border-ink p-6 sm:p-10 lg:border-b-0 lg:border-r">
              <p className="tag mb-6">Honest about trust</p>
              <h2 className="display text-[clamp(32px,3.8vw,58px)]">Private from everyone watching. Not from the resolver.</h2>
              <p className="mt-6 max-w-lg text-lg font-medium leading-snug">
                In v1 the resolver holds the pool accounts and is trusted for custody and settlement. It can see every stake, and so can the eERC auditor key. We say so up front.
              </p>
              <Link href="/markets" className="btn-dark mt-10 px-6 py-3.5 text-base">
                Launch App →
              </Link>
            </div>
            <dl className="divide-y divide-ink">
              {[
                ["Hidden", "Bet amounts and payout amounts on-chain"],
                ["Public", "Who bet, which side, when, and the batched odds"],
                ["Roadmap", "Threshold-shared keys: no single custodian"],
                ["Roadmap", "Zero-knowledge proofs that published totals and payouts are correct"],
              ].map(([k, v], i) => (
                <div key={i} className="grid grid-cols-[110px_1fr] gap-4 px-6 py-6 sm:px-10">
                  <dt className="tag">{k}</dt>
                  <dd className="text-lg font-semibold leading-snug tracking-[-0.01em]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Frame>
      </section>
    </div>
  );
}

/** One transaction, shown as hairline rows. `visible` decides whether the amount is shown or redacted. */
function TxPanel({
  title,
  facts,
  error,
  light = false,
  visible,
  amount,
  amountLabel,
}: {
  title: string;
  facts: TxFacts | null;
  error: boolean;
  light?: boolean;
  visible: boolean;
  amount?: string;
  amountLabel: string;
}) {
  const bg = light ? "bg-bone text-ink border-ink/20" : "bg-panel text-bone border-line";
  const muted = light ? "text-ink/55" : "text-fog";
  return (
    <div className={`flex flex-col border-t md:border-t-0 md:first:border-r ${bg}`}>
      <p className={`tag border-b px-6 py-4 ${light ? "border-ink/20" : "border-line"}`}>{title}</p>
      <div className="flex-1 space-y-4 p-6 text-sm">
        {error && <p className="text-sage">Could not read this transaction right now.</p>}
        {!facts && !error && <p className={muted}>Reading from the chain…</p>}
        {facts && (
          <>
            <Row k="From" v={<a className="num break-all underline-offset-4 hover:underline" href={addressUrl(facts.from)} target="_blank" rel="noreferrer">{shortAddr(facts.from)}</a>} muted={muted} />
            <Row k="Value" v={<span className="num">{facts.value}</span>} muted={muted} />
            <Row k="Calldata" v={<span className="num break-all text-xs">{facts.bytes === 0 ? "0x (empty)" : `${facts.preview}… ${facts.bytes} bytes`}</span>} muted={muted} />
            <div className={`border-t pt-4 ${light ? "border-ink/20" : "border-line"}`}>
              <p className={`tag mb-2 ${muted}`}>{amountLabel}</p>
              {visible ? (
                <p className="display text-5xl">{amount}</p>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="redact !h-12 !min-w-[8rem] !bg-sage" />
                  <span className="tag text-sage">not on-chain</span>
                </div>
              )}
            </div>
            <a className={`tag inline-block underline underline-offset-4 ${light ? "" : "text-sage"}`} href={txUrl(facts.hash)} target="_blank" rel="noreferrer">
              View on Snowtrace ↗
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: React.ReactNode; muted: string }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-3">
      <span className={`tag ${muted}`}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
