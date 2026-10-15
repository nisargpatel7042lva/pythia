"use client";

import { useEffect, useState } from "react";
import { config } from "@/config";
import { Banner, Spinner, TxLink } from "@/components/ui";
import { placeBet, STAGE_LABELS, type BetResult, type BetStage } from "@/lib/bet";
import { fetchDecimals, type Market } from "@/lib/chain";
import { friendlyError } from "@/lib/errors";
import { parseAmount } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useEercSession } from "@/lib/session";
import { useWallet } from "@/lib/wallet";

const ORDER: BetStage[] = ["network", "keys", "register", "balance", "shield", "proof", "wallet", "confirm", "done"];

export function BetPanel({ market, onPlaced }: { market: Market; onPlaced?: () => void }) {
  const w = useWallet();
  const { unlock, markRegistered } = useEercSession();
  const now = useNow(1000);
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amountText, setAmountText] = useState("");
  const [eercDecimals, setEercDecimals] = useState<number | null>(null);
  const [stage, setStage] = useState<BetStage | null>(null);
  const [visited, setVisited] = useState<BetStage[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [result, setResult] = useState<BetResult | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const busy = stage !== null && stage !== "done";

  useEffect(() => {
    fetchDecimals().then((d) => setEercDecimals(d.eerc)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  const closed = market.status !== "Open" || now >= market.closeTime;
  const amount = eercDecimals === null ? null : parseAmount(amountText, eercDecimals);
  const amountInvalid = amountText !== "" && amount === null;
  const tooSmall = amount !== null && amount <= 0n;

  async function submit() {
    if (amount === null || amount <= 0n) return;
    setError(null);
    setVisited([]);
    setResult(null);
    setTxHash(null);
    setElapsed(0);
    try {
      const r = await placeBet({
        walletClient: w.getWalletClient(),
        ensureNetwork: w.ensureNetwork,
        unlock,
        markRegistered,
        market,
        side,
        amount,
        onStage: (s, d) => {
          setStage(s);
          setVisited((v) => (v.includes(s) ? v : [...v, s]));
          if (d?.hash) setTxHash(d.hash);
        },
      });
      setResult(r);
      setStage("done");
      onPlaced?.();
    } catch (e) {
      setStage(null);
      setError(friendlyError(e));
    }
  }

  if (closed) {
    return (
      <div className="card p-6">
        <h3 className="heading mb-2 text-2xl">Betting closed</h3>
        <p className="text-sm text-fog">
          {market.status === "Open" ? "This market has passed its close time. New bets are no longer accepted." : `This market is ${market.status.toLowerCase()}. New bets are no longer accepted.`}
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h3 className="heading mb-4 text-2xl">Place a private bet</h3>

      <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Side">
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={side === s}
            disabled={busy}
            onClick={() => setSide(s)}
            className={`btn border ${side === s ? (s === "YES" ? "border-yes bg-yes/15 text-yes" : "border-no bg-no/15 text-no") : "border-line text-fog hover:border-fog"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="label" htmlFor="amount">
        Amount (USDC)
      </label>
      <input
        id="amount"
        className="field num"
        inputMode="decimal"
        placeholder="0.00"
        value={amountText}
        disabled={busy}
        onChange={(e) => setAmountText(e.target.value)}
      />
      {amountInvalid && <p className="mt-1.5 text-xs text-no">Enter a number with at most {eercDecimals} decimal places.</p>}
      {tooSmall && <p className="mt-1.5 text-xs text-no">Amount must be greater than zero.</p>}
      <p className="mt-2 text-xs text-fog">The amount is encrypted before it leaves your browser. Everyone can see that you bet and on which side, never how much.</p>

      <div className="mt-5">
        {!w.address ? (
          <button className="btn-primary w-full" onClick={() => w.connect()} disabled={w.connecting}>
            Connect wallet to bet
          </button>
        ) : !w.onFuji ? (
          <button className="btn w-full border border-gold/60 text-gold hover:bg-gold/10" onClick={() => w.ensureNetwork().catch((e) => setError(friendlyError(e)))}>
            Switch to Avalanche Fuji
          </button>
        ) : (
          <button className="btn-primary w-full" disabled={busy || amount === null || amount <= 0n} onClick={submit}>
            {busy ? (
              <>
                <Spinner className="h-4 w-4" /> Working…
              </>
            ) : (
              `Bet ${amountText || "…"} on ${side}`
            )}
          </button>
        )}
      </div>

      {stage && (
        <ol className="mt-5 space-y-2 text-sm" aria-live="polite">
          {ORDER.filter((s) => s !== "done" && (visited.includes(s) || !["register", "shield"].includes(s)))
            .map((s) => {
              const state = ORDER.indexOf(s) < ORDER.indexOf(stage) ? "done" : s === stage ? "active" : "todo";
              return (
                <li key={s} className={`flex items-center gap-2 ${state === "todo" ? "text-fog/50" : state === "active" ? "text-pearl" : "text-fog"}`}>
                  {state === "done" ? <span className="text-yes">✓</span> : state === "active" ? <Spinner /> : <span className="h-4 w-4" />}
                  <span>{STAGE_LABELS[s]}</span>
                  {state === "active" && s === "proof" && <span className="num text-xs text-fog">{elapsed}s (runs in a background worker)</span>}
                </li>
              );
            })}
        </ol>
      )}
      {busy && stage === "proof" && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full w-1/3 animate-sheen rounded-full bg-gradient-to-r from-transparent via-violet to-transparent bg-[length:200%_100%]" /></div>}

      {error && (
        <div className="mt-4 space-y-2">
          <Banner tone={error.code === "REJECTED" ? "warn" : "error"}>{error.message}</Banner>
          {error.code === "NO_USDC" && (
            <a className="text-sm text-violet-soft underline" href={config.usdcFaucetUrl} target="_blank" rel="noreferrer">
              Open the USDC faucet ↗
            </a>
          )}
        </div>
      )}

      {result && txHash && (
        <div className="mt-4">
          <Banner tone="ok">
            <p className="font-medium">Bet placed privately.</p>
            <p className="mt-1">
              Transaction: <TxLink hash={result.hash} /> (the amount is not visible there)
            </p>
            <p className="num mt-1 text-xs text-fog">
              proof generated in {result.proofMs !== null ? `${(result.proofMs / 1000).toFixed(1)}s` : "n/a"} · total {(result.totalMs / 1000).toFixed(1)}s
            </p>
          </Banner>
        </div>
      )}
    </div>
  );
}
