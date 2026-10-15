import Link from "next/link";
import { txUrl } from "@/config";
import { shortHash } from "@/lib/format";
import type { Market, StatusName } from "@/lib/chain";

const STATUS_STYLE: Record<StatusName, string> = {
  Open: "border-yes/40 text-yes",
  Closed: "border-gold/40 text-gold",
  Resolved: "border-violet/50 text-violet-soft",
  Settled: "border-line text-fog",
  Cancelled: "border-no/40 text-no",
};

export function StatusBadge({ status }: { status: StatusName }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{status}</span>;
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-fog/30 border-t-violet ${className}`} aria-hidden />;
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const t = { info: "border-violet/40 bg-violet/10 text-pearl", warn: "border-gold/40 bg-gold/10 text-gold-soft", error: "border-no/40 bg-no/10 text-pearl", ok: "border-yes/40 bg-yes/10 text-pearl" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${t}`}>
      {children}
    </div>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="num text-violet-soft underline-offset-2 hover:underline">
      {label ?? shortHash(hash)} ↗
    </a>
  );
}

/** YES/NO split of the PUBLISHED totals. Shows a neutral bar when nothing has been published. */
export function OddsBar({ yesPct }: { yesPct: number | null }) {
  if (yesPct === null) {
    return (
      <div>
        <div className="h-2.5 w-full rounded-full bg-raised" />
        <p className="mt-1.5 text-xs text-fog">No odds published yet</p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-raised" role="img" aria-label={`YES ${yesPct.toFixed(0)} percent, NO ${(100 - yesPct).toFixed(0)} percent`}>
        <div className="bg-yes transition-all" style={{ width: `${yesPct}%` }} />
        <div className="bg-no transition-all" style={{ width: `${100 - yesPct}%` }} />
      </div>
      <div className="num mt-1.5 flex justify-between text-xs">
        <span className="text-yes">YES {yesPct.toFixed(0)}%</span>
        <span className="text-no">NO {(100 - yesPct).toFixed(0)}%</span>
      </div>
    </div>
  );
}

export function MarketCard({ m, now, yesPct, countdownText }: { m: Market; now: number; yesPct: number | null; countdownText: string }) {
  return (
    <Link href={`/markets/${m.id}`} className="card block p-5 transition hover:border-violet/60 hover:shadow-glow">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="chip capitalize">{m.category || "general"}</span>
        <StatusBadge status={m.status} />
      </div>
      <h3 className="heading mb-4 text-xl leading-snug sm:text-2xl">{m.question}</h3>
      <OddsBar yesPct={yesPct} />
      <div className="mt-4 flex items-center justify-between text-xs text-fog">
        <span className="num">{m.publishedBetCount} bets published</span>
        <span className="num">{m.status === "Open" && m.closeTime > now ? `closes in ${countdownText}` : m.status === "Open" ? "closing" : ""}</span>
      </div>
    </Link>
  );
}
