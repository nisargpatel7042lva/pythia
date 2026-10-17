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
    <ul className="border-t border-line">
      {[...bets].reverse().map((b) => (
        <li key={b.txHash} className="grid grid-cols-[56px_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line py-3.5 text-sm sm:grid-cols-[56px_1fr_150px_auto]">
          <span className={`tag font-semibold ${b.side === "YES" ? "text-mint" : "text-clay"}`}>{b.side}</span>
          <a href={addressUrl(b.bettor)} target="_blank" rel="noreferrer" className="num truncate hover:text-sage">
            {shortAddr(b.bettor)}
          </a>
          <span className="flex items-center gap-2" title="Bet sizes are encrypted on-chain">
            <span className="redact !h-3.5 !min-w-[3.5rem]" />
            <span className="tag text-fog">Hidden</span>
          </span>
          <span className="col-span-3 flex items-center justify-between gap-4 sm:col-span-1 sm:justify-end">
            <span className="tag hidden text-fog lg:inline">{fmtDateTime(b.blockTime)}</span>
            <TxLink hash={b.txHash} />
          </span>
        </li>
      ))}
    </ul>
  );
}
