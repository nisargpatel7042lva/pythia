"use client";

import { ethers } from "ethers";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ActivityList } from "@/components/ActivityList";
import { BetPanel } from "@/components/BetPanel";
import { Frame } from "@/components/Nav";
import { Banner, OddsBar, StatusBadge } from "@/components/ui";
import { addressUrl } from "@/config";
import { effectiveStatus, fetchDecimals, fetchFeedInfo } from "@/lib/chain";
import { countdown, fmtDateTime, fmtUnits, shortAddr, yesPercent } from "@/lib/format";
import { useMarket, useNow } from "@/lib/hooks";

export default function MarketPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id >= 0;
  const { data: raw, error, loading, reload } = useMarket(valid ? id : 0);
  const now = useNow(1000);
  const m = raw ? { ...raw, status: effectiveStatus(raw, now) } : null;
  const [dec, setDec] = useState<number | null>(null);
  const [feed, setFeed] = useState<{ decimals: number; description: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetchDecimals().then((d) => setDec(d.eerc)).catch(() => {});
  }, []);
  useEffect(() => {
    if (m?.resolutionType === "PriceFeed") fetchFeedInfo(m.priceFeed).then(setFeed).catch(() => {});
  }, [m?.resolutionType, m?.priceFeed]);

  const shell = (children: React.ReactNode) => (
    <Frame>
      <div className="p-6 sm:p-10">{children}</div>
    </Frame>
  );

  if (!valid) return shell(<Banner tone="error">That is not a valid market id.</Banner>);
  if (error && !m) {
    return shell(
      <Banner tone="error">
        {/(call revert|MarketNotFound|could not decode)/i.test(error) ? "This market does not exist." : `Could not load this market. ${error}`}{" "}
        <button className="underline" onClick={reload}>
          Retry
        </button>{" "}
        ·{" "}
        <Link className="underline" href="/markets">
          All markets
        </Link>
      </Banner>,
    );
  }
  if (loading && !m) return shell(<p className="text-sm text-fog">Loading market…</p>);
  if (!m) return null;

  const pct = yesPercent(m.publishedYes, m.publishedNo);
  const open = m.status === "Open" && now < m.closeTime;
  const resolution =
    m.resolutionType === "PriceFeed" && feed
      ? `${feed.description} ${m.priceAbove ? "above" : "below"} $${ethers.formatUnits(m.strikePrice, feed.decimals)}`
      : m.resolutionType === "PriceFeed"
        ? "Chainlink price feed"
        : "Manual (resolver)";

  return (
    <Frame>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 border-line lg:border-r">
          {/* head */}
          <div className="border-b border-line p-6 sm:p-10">
            <Link href="/markets" className="tag text-fog hover:text-coral">
              ← All markets
            </Link>
            <div className="mb-5 mt-6 flex flex-wrap items-center gap-3">
              <StatusBadge status={m.status} />
              <span className="tag text-fog">{m.category || "general"}</span>
              <span className="tag text-fog">· #{m.id}</span>
            </div>
            <h1 className="display text-[clamp(36px,4.6vw,76px)]">{m.question}</h1>
          </div>

          {/* stats */}
          <div className="grid grid-cols-2 border-b border-line sm:grid-cols-3">
            <div className="border-r border-line p-6 sm:p-8">
              <p className="tag text-fog">{open ? "Closes in" : "Closed"}</p>
              <p className={`num mt-2 ${open ? "text-2xl text-coral sm:text-3xl" : "text-base leading-snug"}`}>{open ? countdown(m.closeTime, now) : fmtDateTime(m.closeTime)}</p>
            </div>
            <div className="p-6 sm:border-r sm:border-line sm:p-8">
              <p className="tag text-fog">Bets published</p>
              <p className="num mt-2 text-2xl sm:text-3xl">{m.publishedBetCount}</p>
            </div>
            <div className="col-span-2 border-t border-line p-6 sm:col-span-1 sm:border-t-0 sm:p-8">
              <p className="tag text-fog">Resolution</p>
              <p className="mt-2 text-sm font-semibold leading-snug">{resolution}</p>
            </div>
          </div>

          {(m.status === "Resolved" || m.status === "Settled") && (
            <div className="border-b border-line bg-coral p-6 text-ink sm:px-10">
              <p className="tag">Outcome</p>
              <p className="display text-5xl">{m.outcome.toUpperCase()}</p>
              <p className="tag mt-2">{m.status === "Settled" ? `Paid out in ${m.settlementTxCount} private transfers` : "Payouts in progress"}</p>
            </div>
          )}
          {m.status === "Cancelled" && (
            <div className="border-b border-line p-6 sm:px-10">
              <Banner tone="warn">This market was cancelled. All bets are refunded.</Banner>
            </div>
          )}

          {/* odds */}
          <section className="border-b border-line p-6 sm:p-10">
            <p className="tag mb-5 text-coral">Odds</p>
            <OddsBar yesPct={pct} />
            {dec !== null && pct !== null && (
              <div className="num mt-6 grid grid-cols-2 border border-line text-sm">
                <div className="border-r border-line p-4">
                  <p className="tag text-fog">YES pool</p>
                  <p className="mt-1 text-xl">{fmtUnits(m.publishedYes, dec)} USDC</p>
                </div>
                <div className="p-4">
                  <p className="tag text-fog">NO pool</p>
                  <p className="mt-1 text-xl">{fmtUnits(m.publishedNo, dec)} USDC</p>
                </div>
              </div>
            )}
            <p className="tag mt-5 text-fog">
              Odds update in batches to protect bettors. {m.lastPublishedAt ? `Last update ${fmtDateTime(m.lastPublishedAt)}.` : "Nothing published yet."}
            </p>
          </section>

          {/* activity */}
          <section className="border-b border-line p-6 sm:p-10">
            <div className="mb-5 flex items-end justify-between gap-4">
              <p className="tag text-coral">Activity</p>
              <p className="tag text-fog">Who and which side is public. Amounts are not.</p>
            </div>
            <ActivityList marketId={m.id} refreshKey={tick} />
          </section>

          <section className="p-6 text-xs text-fog sm:px-10">
            <p className="num">
              YES pool{" "}
              <a className="text-coral" href={addressUrl(m.yesPool)} target="_blank" rel="noreferrer">
                {shortAddr(m.yesPool)}
              </a>{" "}
              · NO pool{" "}
              <a className="text-coral" href={addressUrl(m.noPool)} target="_blank" rel="noreferrer">
                {shortAddr(m.noPool)}
              </a>
            </p>
          </section>
        </div>

        <aside className="border-t border-line lg:sticky lg:top-16 lg:self-start lg:border-t-0">
          <BetPanel market={m} onPlaced={() => (setTick((t) => t + 1), reload())} />
        </aside>
      </div>
    </Frame>
  );
}
