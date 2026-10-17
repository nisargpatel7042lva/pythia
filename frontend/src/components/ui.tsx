import Link from "next/link";
import { txUrl } from "@/config";
import { shortHash } from "@/lib/format";
import type { Market, StatusName } from "@/lib/chain";

const STATUS_STYLE: Record<StatusName, { box: string; dot: string }> = {
  Open: { box: "border-mint text-mint group-hover:border-ink group-hover:text-ink", dot: "bg-mint group-hover:bg-ink" },
  Closed: { box: "border-bone text-bone group-hover:border-ink group-hover:text-ink", dot: "bg-bone group-hover:bg-ink" },
  Resolved: { box: "border-sage text-sage group-hover:border-ink group-hover:text-ink", dot: "bg-sage group-hover:bg-ink" },
  Settled: { box: "border-line text-fog group-hover:border-ink group-hover:text-ink", dot: "bg-fog group-hover:bg-ink" },
  Cancelled: { box: "border-line text-fog line-through group-hover:border-ink group-hover:text-ink", dot: "bg-fog group-hover:bg-ink" },
};

export function StatusBadge({ status }: { status: StatusName }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`tag inline-flex items-center gap-1.5 border px-2 py-0.5 ${s.box}`}>
      <span className={`h-1.5 w-1.5 ${s.dot} ${status === "Open" ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-fog/30 border-t-sage ${className}`} aria-hidden />;
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const t = {
    info: "border-l-bone",
    warn: "border-l-clay",
    error: "border-l-clay bg-clay/10",
    ok: "border-l-mint bg-mint/5",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`border border-line border-l-4 bg-panel px-4 py-3 text-sm ${t}`}>
      {children}
    </div>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="num text-sage underline decoration-sage/40 underline-offset-4 hover:decoration-sage">
      {label ?? shortHash(hash)} ↗
    </a>
  );
}

/** YES/NO split of the PUBLISHED totals. A flat bar with hard edges; neutral when nothing is published. */
export function OddsBar({ yesPct, invertOnHover = false }: { yesPct: number | null; invertOnHover?: boolean }) {
  const yes = invertOnHover ? "bg-mint group-hover:bg-ink" : "bg-mint";
  const no = invertOnHover ? "bg-clay group-hover:bg-bone" : "bg-clay";
  const track = invertOnHover ? "bg-raised group-hover:bg-ink/20" : "bg-raised";
  if (yesPct === null) {
    return (
      <div>
        <div className={`h-3 w-full ${track}`} />
        <p className="tag mt-2 text-fog group-hover:text-ink/70">No odds published yet</p>
      </div>
    );
  }
  return (
    <div>
      <div className={`flex h-3 w-full gap-[2px] ${track}`} role="img" aria-label={`YES ${yesPct.toFixed(0)} percent, NO ${(100 - yesPct).toFixed(0)} percent`}>
        <div className={`${yes} transition-[width] duration-700`} style={{ width: `${yesPct}%` }} />
        <div className={`${no} transition-[width] duration-700`} style={{ width: `${100 - yesPct}%` }} />
      </div>
      <div className="num mt-2 flex justify-between text-xs">
        <span>YES {yesPct.toFixed(0)}%</span>
        <span>NO {(100 - yesPct).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/** One market as a ruled table row. Inverts to sage on hover. */
export function MarketRow({ m, yesPct, countdownText, index }: { m: Market; yesPct: number | null; countdownText: string; index: number }) {
  const live = m.status === "Open";
  return (
    <Link
      href={`/markets/${m.id}`}
      className="group grid grid-cols-[auto_1fr] gap-x-5 gap-y-5 border-b border-line px-4 py-6 transition-colors duration-200 hover:bg-sage hover:text-ink sm:px-8 md:grid-cols-[72px_1fr_260px_150px] md:items-center md:gap-x-8"
    >
      <span className="num pt-1 text-sm text-fog group-hover:text-ink/70 md:pt-0">{String(index).padStart(2, "0")}</span>
      <div className="min-w-0">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <StatusBadge status={m.status} />
          <span className="tag text-fog group-hover:text-ink/70">{m.category || "general"}</span>
          <span className="tag text-fog group-hover:text-ink/70">· #{m.id}</span>
        </div>
        <h3 className="display text-[22px] sm:text-[28px]">{m.question}</h3>
      </div>
      <div className="col-span-2 md:col-span-1">
        <OddsBar yesPct={yesPct} invertOnHover />
      </div>
      <div className="col-span-2 flex items-center justify-between gap-4 md:col-span-1 md:block md:text-right">
        <p className="num text-sm">{m.publishedBetCount} bets</p>
        <p className="tag mt-1 text-fog group-hover:text-ink/70">{live ? `closes in ${countdownText}` : m.status}</p>
        <span className="tag mt-3 hidden items-center gap-1 md:inline-flex">Open →</span>
      </div>
    </Link>
  );
}
