"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActivityList } from "@/components/ActivityList";
import { BetPanel } from "@/components/BetPanel";
import { Banner, OddsBar, StatusBadge } from "@/components/ui";
import { addressUrl } from "@/config";
import { fetchDecimals, fetchFeedInfo } from "@/lib/chain";
import { countdown, fmtDateTime, fmtUnits, shortAddr, yesPercent } from "@/lib/format";
import { useMarket, useNow } from "@/lib/hooks";
import { ethers } from "ethers";

export default function MarketPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id >= 0;
  const { data: m, error, loading, reload } = useMarket(valid ? id : 0);
  const now = useNow(1000);
  const [dec, setDec] = useState<number | null>(null);
  const [feed, setFeed] = useState<{ decimals: number; description: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetchDecimals().then((d) => setDec(d.eerc)).catch(() => {});
  }, []);
  useEffect(() => {
    if (m?.resolutionType === "PriceFeed") fetchFeedInfo(m.priceFeed).then(setFeed).catch(() => {});
  }, [m?.resolutionType, m?.priceFeed]);

  if (!valid) return <Banner tone="error">That is not a valid market id.</Banner>;
  if (error && !m) {
    return (
      <Banner tone="error">
        {/(call revert|MarketNotFound|could not decode)/i.test(error) ? "This market does not exist." : `Could not load this market. ${error}`}{" "}
        <button className="underline" onClick={reload}>
          Retry
        </button>{" "}
        · <Link className="underline" href="/markets">All markets</Link>
      </Banner>
    );
  }
  if (loading && !m) return <p className="text-sm text-fog">Loading market…</p>;
  if (!m) return null;

  const pct = yesPercent(m.publishedYes, m.publishedNo);
  const open = m.status === "Open" && now < m.closeTime;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <div>
          <Link href="/markets" className="text-xs text-fog hover:text-pearl">
            ← All markets
          </Link>
          <div className="mb-3 mt-3 flex items-center gap-2">
            <span className="chip capitalize">{m.category || "general"}</span>
            <StatusBadge status={m.status} />
            <span className="chip num">#{m.id}</span>
          </div>
          <h1 className="heading text-4xl leading-tight sm:text-5xl">{m.question}</h1>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <p className="label">{open ? "Closes in" : "Closed"}</p>
            <p className="num text-xl text-gold">{open ? countdown(m.closeTime, now) : fmtDateTime(m.closeTime)}</p>
          </div>
          <div className="card p-4">
            <p className="label">Bets (published)</p>
            <p className="num text-xl">{m.publishedBetCount}</p>
          </div>
          <div className="card col-span-2 p-4 sm:col-span-1">
            <p className="label">Resolution</p>
            <p className="text-sm">
              {m.resolutionType === "PriceFeed" && feed ? `${feed.description} ${m.priceAbove ? "above" : "below"} $${ethers.formatUnits(m.strikePrice, feed.decimals)} (Chainlink)` : m.resolutionType === "PriceFeed" ? "Chainlink price feed" : "Manual (resolver)"}
            </p>
          </div>
        </div>

        {(m.status === "Resolved" || m.status === "Settled") && (
          <Banner tone="ok">
            Outcome: <strong>{m.outcome.toUpperCase()}</strong>
            {m.status === "Settled" ? ` · paid out in ${m.settlementTxCount} private transfers` : " · payouts in progress"}
          </Banner>
        )}
        {m.status === "Cancelled" && <Banner tone="warn">This market was cancelled. All bets are refunded.</Banner>}

        <section className="card p-6">
          <h2 className="heading mb-4 text-2xl">Odds</h2>
          <OddsBar yesPct={pct} />
          {dec !== null && pct !== null && (
            <div className="num mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="label">YES pool</p>
                {fmtUnits(m.publishedYes, dec)} USDC
              </div>
              <div>
                <p className="label">NO pool</p>
                {fmtUnits(m.publishedNo, dec)} USDC
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-fog">
            Odds update in batches to protect bettors. {m.lastPublishedAt ? `Last update ${fmtDateTime(m.lastPublishedAt)}.` : "Nothing has been published yet."}
          </p>
        </section>

        <section className="card p-6">
          <h2 className="heading mb-2 text-2xl">Activity</h2>
          <p className="mb-3 text-xs text-fog">Who bet and on which side is public. Amounts are encrypted.</p>
          <ActivityList marketId={m.id} refreshKey={tick} />
        </section>

        <section className="text-xs text-fog">
          <p className="num">
            YES pool{" "}
            <a className="text-violet-soft" href={addressUrl(m.yesPool)} target="_blank" rel="noreferrer">
              {shortAddr(m.yesPool)}
            </a>{" "}
            · NO pool{" "}
            <a className="text-violet-soft" href={addressUrl(m.noPool)} target="_blank" rel="noreferrer">
              {shortAddr(m.noPool)}
            </a>
          </p>
        </section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <BetPanel market={m} onPlaced={() => (setTick((t) => t + 1), reload())} />
      </aside>
    </div>
  );
}
