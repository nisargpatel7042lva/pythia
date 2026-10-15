"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addressUrl, config, txUrl } from "@/config";
import { provider, withRetry } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

interface TxFacts {
  from: string;
  to: string;
  value: string;
  bytes: number;
  words: number;
  smallWords: string[];
}

function useExampleTx() {
  const [facts, setFacts] = useState<TxFacts | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const tx = await withRetry(() => provider.getTransaction(config.exampleBetTx));
        if (!tx) throw new Error("not found");
        const body = tx.data.slice(10);
        const words: bigint[] = [];
        for (let i = 0; i < body.length; i += 64) words.push(BigInt("0x" + body.slice(i, i + 64).padEnd(64, "0")));
        setFacts({
          from: tx.from,
          to: tx.to ?? "",
          value: tx.value.toString(),
          bytes: (tx.data.length - 2) / 2,
          words: words.length,
          smallWords: words.filter((w) => w < 2n ** 64n).map(String),
        });
      } catch {
        setError(true);
      }
    })();
  }, []);
  return { facts, error };
}

const STEPS = [
  { n: "01", title: "Bet privately", body: "Pick a side and an amount. Your browser encrypts the amount and proves, in zero knowledge, that you can cover it. Only the ciphertext goes on-chain." },
  { n: "02", title: "Odds in batches", body: "Pool totals are published only after enough new bets have arrived, so no one can difference the numbers to isolate your stake." },
  { n: "03", title: "Settled privately", body: "When the market resolves, winners are paid from the pools through private transfers. Even payouts stay hidden." },
];

export default function Landing() {
  const { facts, error } = useExampleTx();
  return (
    <div className="space-y-24 pb-8">
      <section className="pt-8 text-center sm:pt-16">
        <p className="num mb-5 text-xs uppercase tracking-[0.3em] text-gold">Private prediction markets · Avalanche</p>
        <h1 className="heading mx-auto max-w-4xl text-5xl leading-[1.05] sm:text-7xl">
          On Polymarket, your bet size is public. <span className="text-violet-soft">On PYTHIA, it isn&apos;t.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-fog">
          Who bet and which side is public. How much is hidden, encrypted with eERC. Whales can&apos;t be tracked, and copy-trading your edge stops working.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/markets" className="btn-primary px-6 py-3 text-base">
            Launch App
          </Link>
          <a href="#proof" className="btn-ghost px-6 py-3 text-base">
            See the proof
          </a>
        </div>
      </section>

      <section>
        <h2 className="heading mb-8 text-center text-4xl">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="card p-6">
              <span className="num text-sm text-gold">{s.n}</span>
              <h3 className="heading mb-2 mt-2 text-2xl">{s.title}</h3>
              <p className="text-sm leading-relaxed text-fog">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="proof" className="scroll-mt-24">
        <h2 className="heading mb-2 text-center text-4xl">A real bet, on-chain</h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-fog">
          This is an actual PYTHIA bet on Fuji. Everything below is read live from the chain right now.
        </p>
        <div className="card mx-auto max-w-3xl p-6">
          {error && <p className="text-sm text-no">Could not load the example transaction right now. Open it on Snowtrace instead.</p>}
          {!facts && !error && <p className="text-sm text-fog">Reading the transaction from the chain…</p>}
          {facts && (
            <dl className="num grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
              <dt className="text-fog">Bettor</dt>
              <dd className="break-all">{facts.from}</dd>
              <dt className="text-fog">Called</dt>
              <dd className="break-all">{shortAddr(facts.to)} · EncryptedERC.transfer</dd>
              <dt className="text-fog">Native value</dt>
              <dd>{facts.value} wei</dd>
              <dt className="text-fog">Calldata</dt>
              <dd>
                {facts.bytes} bytes, {facts.words} words of proof and ciphertext
              </dd>
              <dt className="text-fog">Small numbers visible</dt>
              <dd>
                {facts.smallWords.join(", ") || "none"} <span className="text-fog">(the token id)</span>
              </dd>
              <dt className="text-fog">Bet amount</dt>
              <dd className="text-gold">not present anywhere</dd>
            </dl>
          )}
          <div className="mt-5 flex flex-wrap gap-4 text-sm">
            <a className="text-violet-soft underline" href={txUrl(config.exampleBetTx)} target="_blank" rel="noreferrer">
              View on Snowtrace ↗
            </a>
            {facts && (
              <a className="text-violet-soft underline" href={addressUrl(facts.from)} target="_blank" rel="noreferrer">
                Bettor address ↗
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="card mx-auto max-w-3xl p-8 text-center">
        <h2 className="heading mb-3 text-3xl">Honest about trust</h2>
        <p className="text-sm leading-relaxed text-fog">
          In v1 the resolver holds the pool accounts and is trusted for custody and settlement. Privacy holds against everyone watching the chain, not against the resolver. Threshold keys and decryption proofs are on the roadmap.
        </p>
      </section>
    </div>
  );
}
