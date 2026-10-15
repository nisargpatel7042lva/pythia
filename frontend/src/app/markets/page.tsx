"use client";

import { useMemo, useState } from "react";
import { Banner, MarketCard } from "@/components/ui";
import { STATUS, type StatusName } from "@/lib/chain";
import { countdown, yesPercent } from "@/lib/format";
import { useMarkets, useNow } from "@/lib/hooks";

export default function MarketsPage() {
  const { data, error, loading, reload } = useMarkets();
  const now = useNow(1000);
  const [status, setStatus] = useState<StatusName | "All">("All");
  const [category, setCategory] = useState("All");

  const categories = useMemo(() => ["All", ...Array.from(new Set((data ?? []).map((m) => m.category || "general")))], [data]);
  const shown = (data ?? []).filter((m) => (status === "All" || m.status === status) && (category === "All" || (m.category || "general") === category));

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading text-5xl">Markets</h1>
        <p className="mt-2 text-sm text-fog">Odds update in batches to protect bettors. Individual bet sizes are never shown.</p>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {(["All", ...STATUS] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`chip transition ${status === s ? "border-violet text-pearl" : "hover:border-fog"}`}>
              {s}
            </button>
          ))}
        </div>
        <select aria-label="Filter by category" className="field w-full capitalize sm:w-48" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "All" ? "All categories" : c}
            </option>
          ))}
        </select>
      </div>

      {error && !data && (
        <Banner tone="error">
          Could not load markets from the chain. {error}{" "}
          <button className="underline" onClick={reload}>
            Retry
          </button>
        </Banner>
      )}
      {loading && !data && <p className="text-sm text-fog">Loading markets from the chain…</p>}
      {data && shown.length === 0 && <p className="text-sm text-fog">No markets match these filters.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((m) => (
          <MarketCard key={m.id} m={m} now={now} yesPct={yesPercent(m.publishedYes, m.publishedNo)} countdownText={countdown(m.closeTime, now)} />
        ))}
      </div>
    </div>
  );
}
