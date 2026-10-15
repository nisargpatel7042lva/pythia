"use client";

import { useEffect, useState } from "react";
import { Banner, TxLink } from "@/components/ui";
import { addressUrl } from "@/config";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, shortAddr } from "@/lib/format";
import { fetchActivity, type ActivityBet } from "@/lib/resolverApi";

export function ActivityList({ marketId, refreshKey }: { marketId: number; refreshKey?: number }) {
  const [bets, setBets] = useState<ActivityBet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetchActivity(marketId);
        if (alive) (setBets(r.bets), setError(null));
      } catch (e) {
        if (alive) setError(friendlyError(e).message);
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [marketId, refreshKey]);

  if (error && !bets) {
    return (
      <Banner tone="warn">
        The activity feed is unavailable right now (the resolver may be offline). Bets and balances are unaffected; on-chain data above is still live.
      </Banner>
    );
  }
  if (!bets) return <p className="text-sm text-fog">Loading activity…</p>;
  if (bets.length === 0) return <p className="text-sm text-fog">No bets yet. Be the first.</p>;

  return (
    <ul className="divide-y divide-line">
      {[...bets].reverse().map((b) => (
        <li key={b.txHash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
          <div className="flex items-center gap-3">
            <span className={`num w-10 text-xs font-semibold ${b.side === "YES" ? "text-yes" : "text-no"}`}>{b.side}</span>
            <a href={addressUrl(b.bettor)} target="_blank" rel="noreferrer" className="num text-pearl hover:text-violet-soft">
              {shortAddr(b.bettor)}
            </a>
          </div>
          <div className="flex items-center gap-4">
            <span className="num rounded-md bg-raised px-2 py-0.5 text-xs tracking-widest text-gold" title="Bet sizes are encrypted on-chain">
              HIDDEN
            </span>
            <span className="hidden text-xs text-fog sm:inline">{fmtDateTime(b.blockTime)}</span>
            <TxLink hash={b.txHash} />
          </div>
        </li>
      ))}
    </ul>
  );
}
