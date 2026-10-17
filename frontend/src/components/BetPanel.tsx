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
      <div className="p-6 sm:p-8">
        <p className="tag mb-4 text-sage">Position</p>
        <h3 className="display text-4xl">Betting closed</h3>
        <p className="mt-4 text-sm text-fog">
          {market.status === "Open" ? "This market has passed its close time. New bets are no longer accepted." : `This market is ${market.status.toLowerCase()}. New bets are no longer accepted.`}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8">
      <p className="tag mb-4 text-sage">Place a private bet</p>

      <div className="grid grid-cols-2 border border-line" role="radiogroup" aria-label="Side">
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={side === s}
            disabled={busy}
            onClick={() => setSide(s)}
            className={`display py-5 text-4xl transition-colors first:border-r first:border-line ${
              side === s ? (s === "YES" ? "bg-mint text-ink" : "bg-clay text-ink") : "text-fog hover:bg-raised hover:text-bone"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="label mt-6" htmlFor="amount">
        Amount (USDC)
      </label>
      <input id="amount" className="field num text-2xl" inputMode="decimal" placeholder="0.00" value={amountText} disabled={busy} onChange={(e) => setAmountText(e.target.value)} />
      {amountInvalid && <p className="mt-2 text-xs text-clay">Enter a number with at most {eercDecimals} decimal places.</p>}
      {tooSmall && <p className="mt-2 text-xs text-clay">Amount must be greater than zero.</p>}
      <p className="mt-3 text-xs leading-relaxed text-fog">Encrypted before it leaves your browser. Everyone can see that you bet and on which side, never how much.</p>

      <div className="mt-6">
        {!w.address ? (
          <button className="btn-primary w-full py-4 text-base" onClick={() => w.connect()} disabled={w.connecting}>
            Connect wallet to bet
          </button>
        ) : !w.onFuji ? (
          <button className="btn w-full border border-clay py-4 text-base text-clay hover:bg-clay hover:text-ink" onClick={() => w.ensureNetwork().catch((e) => setError(friendlyError(e)))}>
            Switch to Avalanche Fuji
          </button>
        ) : (
          <button className="btn-primary w-full py-4 text-base" disabled={busy || amount === null || amount <= 0n} onClick={submit}>
            {busy ? (
              <>
                <Spinner className="h-4 w-4" /> Working…
              </>
            ) : (
              <>Bet {amountText || "…"} on {side} →</>
            )}
          </button>
        )}
      </div>

      {stage && (
        <ol className="mt-6 border-t border-line pt-4" aria-live="polite">
          {ORDER.filter((s) => s !== "done" && (visited.includes(s) || !["register", "shield"].includes(s))).map((s) => {
            const state = ORDER.indexOf(s) < ORDER.indexOf(stage) ? "done" : s === stage ? "active" : "todo";
            return (
              <li key={s} className={`tag flex items-center gap-3 border-b border-line py-2.5 ${state === "todo" ? "text-fog/40" : state === "active" ? "text-bone" : "text-fog"}`}>
                <span className="w-4">{state === "done" ? <span className="text-mint">✓</span> : state === "active" ? <Spinner /> : null}</span>
                <span>{STAGE_LABELS[s]}</span>
                {state === "active" && s === "proof" && <span className="num ml-auto text-fog">{elapsed}s · background worker</span>}
              </li>
            );
          })}
        </ol>
      )}
      {busy && stage === "proof" && (
        <div className="mt-3 h-1 overflow-hidden bg-raised">
          <div className="h-full w-1/3 animate-sheen bg-gradient-to-r from-transparent via-sage to-transparent bg-[length:200%_100%]" />
        </div>
      )}

      {error && (
        <div className="mt-5 space-y-2">
          <Banner tone={error.code === "REJECTED" ? "warn" : "error"}>{error.message}</Banner>
          {error.code === "NO_USDC" && (
            <a className="tag text-sage underline underline-offset-4" href={config.usdcFaucetUrl} target="_blank" rel="noreferrer">
              Open the USDC faucet ↗
            </a>
          )}
        </div>
      )}

      {result && txHash && (
        <div className="mt-5">
          <Banner tone="ok">
            <p className="font-semibold">Bet placed privately.</p>
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
