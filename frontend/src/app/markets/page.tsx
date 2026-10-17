"use client";

import { useMemo, useState } from "react";
import { Frame } from "@/components/Nav";
import { PageHead } from "@/components/Page";
import { Banner, MarketRow } from "@/components/ui";
import { STATUS, effectiveStatus, type StatusName } from "@/lib/chain";
import { countdown, yesPercent } from "@/lib/format";
import { useMarkets, useNow } from "@/lib/hooks";

export default function MarketsPage() {
  const { data, error, loading, reload } = useMarkets();
  const now = useNow(1000);
  const [status, setStatus] = useState<StatusName | "All">("All");
  const [category, setCategory] = useState("All");

  const all = useMemo(() => (data ?? []).map((m) => ({ ...m, status: effectiveStatus(m, now) })), [data, now]);
  const categories = useMemo(() => ["All", ...Array.from(new Set(all.map((m) => m.category || "general")))], [all]);
  const shown = all.filter((m) => (status === "All" || m.status === status) && (category === "All" || (m.category || "general") === category));

  return (
    <>
      <PageHead
        tag="Live on Avalanche Fuji"
        title="Markets"
        sub="Odds update in batches to protect bettors. Individual bet sizes are never shown."
        right={<p className="num text-sm text-fog">{data ? `${shown.length} of ${data.length} markets` : ""}</p>}
      />
      <Frame>
        <div className="flex flex-col border-b border-line md:flex-row">
          <div className="flex flex-wrap" role="group" aria-label="Filter by status">
            {(["All", ...STATUS] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`tag border-r border-line px-5 py-4 transition-colors ${status === s ? "bg-coral text-ink" : "text-fog hover:bg-raised hover:text-bone"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="md:ml-auto md:border-l md:border-line">
            <select
              aria-label="Filter by category"
              className="tag h-full w-full cursor-pointer bg-ink px-5 py-4 text-bone focus:outline-none md:w-56"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "All" ? "All categories" : c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && !data && (
          <div className="p-6">
            <Banner tone="error">
              Could not load markets from the chain. {error}{" "}
              <button className="underline" onClick={reload}>
                Retry
              </button>
            </Banner>
          </div>
        )}
        {loading && !data && <p className="p-8 text-sm text-fog">Loading markets from the chain…</p>}
        {data && shown.length === 0 && <p className="p-8 text-sm text-fog">No markets match these filters.</p>}

        <div>
          {shown.map((m, i) => (
            <MarketRow key={m.id} m={m} index={i + 1} yesPct={yesPercent(m.publishedYes, m.publishedNo)} countdownText={countdown(m.closeTime, now)} />
          ))}
        </div>
      </Frame>
    </>
  );
}
