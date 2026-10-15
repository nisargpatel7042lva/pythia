"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { friendlyError } from "@/lib/errors";
import { useHealth, useOwner } from "@/lib/hooks";
import { shortAddr } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="PYTHIA home">
      <span className="grid h-7 w-7 place-items-center rounded-full border border-gold/60 text-gold">
        <span className="h-2 w-2 rounded-full bg-gold shadow-[0_0_12px_2px_rgba(212,175,55,.7)]" />
      </span>
      <span className="heading text-2xl tracking-[0.18em]">PYTHIA</span>
    </Link>
  );
}

function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  if (!w.address) {
    return (
      <div className="relative">
        <button
          className="btn-primary"
          disabled={w.connecting}
          onClick={async () => {
            if (w.wallets.length > 1) setOpen((o) => !o);
            else await w.connect();
          }}
        >
          {w.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {open && (
          <div className="card absolute right-0 z-30 mt-2 w-56 p-2">
            {w.wallets.map((x) => (
              <button key={x.id} className="btn-ghost mb-1 w-full justify-start" onClick={() => (setOpen(false), w.connect(x.id))}>
                {x.name}
              </button>
            ))}
          </div>
        )}
        {w.error && <p className="absolute right-0 mt-2 w-64 text-right text-xs text-no">{friendlyError({ message: w.error }).message}</p>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {!w.onFuji && (
        <button className="btn border border-gold/60 text-gold hover:bg-gold/10" onClick={() => w.ensureNetwork().catch(() => {})}>
          Switch to Fuji
        </button>
      )}
      <button className="btn-ghost num" onClick={w.disconnect} title="Disconnect">
        {shortAddr(w.address)}
      </button>
    </div>
  );
}

export function Nav() {
  const path = usePathname();
  const w = useWallet();
  const owner = useOwner();
  const health = useHealth();
  const [menu, setMenu] = useState(false);
  const isOwner = !!w.address && !!owner.data && w.address.toLowerCase() === owner.data.toLowerCase();
  const links = [
    { href: "/markets", label: "Markets" },
    { href: "/portfolio", label: "Portfolio" },
    ...(isOwner ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  const online = !!health.data?.ok;
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden gap-6 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={`text-sm transition hover:text-pearl ${path.startsWith(l.href) ? "text-pearl" : "text-fog"}`}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`hidden items-center gap-1.5 text-xs sm:flex ${online ? "text-fog" : "text-no"}`}
            title={online ? "Resolver online" : "Resolver unreachable: activity feed unavailable"}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-yes" : "bg-no"}`} />
            {online ? "resolver online" : health.loading ? "…" : "resolver offline"}
          </span>
          <WalletButton />
          <button className="btn-ghost px-3 md:hidden" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
            ☰
          </button>
        </div>
      </div>
      {menu && (
        <nav className="flex flex-col gap-1 border-t border-line px-4 py-3 md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className="rounded-lg px-3 py-2 text-sm text-pearl hover:bg-raised">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line/70 py-10 text-center text-xs text-fog">
      <p>PYTHIA on Avalanche Fuji testnet. Bet sizes are hidden with eERC; who bet and which side is public.</p>
      <p className="mt-1">Trust model v1: the resolver is trusted for custody and settlement.</p>
    </footer>
  );
}
