"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo, Logomark } from "@/components/Logo";
import { WalletButton, WalletError } from "@/components/WalletButton";
import { useHealth, useOwner } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet";

/** Max-width frame with hairline side rules: the page grid every screen sits in. */
export function Frame({ children, className = "", tone = "ink" }: { children: React.ReactNode; className?: string; tone?: "ink" | "sage" }) {
  return <div className={`mx-auto max-w-[1440px] border-x ${tone === "sage" ? "border-ink" : "border-line"} ${className}`}>{children}</div>;
}

export function Nav() {
  const path = usePathname();
  const w = useWallet();
  const owner = useOwner();
  const health = useHealth();
  const [menu, setMenu] = useState(false);
  const onSage = path === "/";
  const isOwner = !!w.address && !!owner.data && w.address.toLowerCase() === owner.data.toLowerCase();
  const links = [
    { href: "/markets", label: "Markets" },
    { href: "/portfolio", label: "Portfolio" },
    ...(isOwner ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  const online = !!health.data?.ok;

  const line = onSage ? "border-ink" : "border-line";
  return (
    <header className={`sticky top-0 z-30 ${onSage ? "bg-sage text-ink" : "bg-ink/95 text-bone backdrop-blur"}`}>
      <Frame tone={onSage ? "sage" : "ink"}>
        <div className={`flex h-[72px] items-stretch border-b ${line}`}>
          <div className={`flex items-center border-r px-4 sm:px-6 lg:w-[300px] ${line}`}>
            <Logo tone={onSage ? "ink" : "bone"} />
          </div>

          <nav className="hidden flex-1 items-stretch md:flex" aria-label="Primary">
            {links.map((l) => {
              const active = path.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`tag flex items-center border-r px-6 transition-colors ${line} ${
                    onSage ? (active ? "bg-ink text-sage" : "hover:bg-ink hover:text-sage") : active ? "bg-sage text-ink" : "text-fog hover:bg-raised hover:text-bone"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            <div className="flex-1" />
            <span
              className={`tag hidden items-center gap-2 border-l px-5 lg:flex ${line} ${online ? "" : onSage ? "" : "text-clay"}`}
              title={online ? "Resolver online" : "Resolver unreachable: activity feed unavailable"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${online ? (onSage ? "bg-ink" : "bg-mint") : onSage ? "bg-ink/40" : "bg-clay"}`} />
              {online ? "Resolver live" : health.loading ? "…" : "Resolver offline"}
            </span>
          </nav>

          <div className={`ml-auto flex items-center gap-2 px-3 md:ml-0 md:border-l md:px-4 ${line}`}>
            <WalletButton onSage={onSage} />
            <button className={`${onSage ? "btn-outline-ink" : "btn-ghost"} px-3 md:hidden`} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <span className="block h-0.5 w-4 bg-current shadow-[0_5px_0_currentColor,0_-5px_0_currentColor]" />
            </button>
          </div>
        </div>
        <WalletError />
        {menu && (
          <nav className={`flex flex-col border-b md:hidden ${line}`}>
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className={`tag border-b px-6 py-4 last:border-b-0 ${line}`}>
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </Frame>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 overflow-hidden border-t border-line">
      <Frame>
        <div className="grid gap-px border-b border-line bg-line md:grid-cols-4">
          {[
            ["Product", [["Markets", "/markets"], ["Portfolio", "/portfolio"]]],
            ["Network", [["Avalanche Fuji", "https://testnet.snowtrace.io"], ["eERC", "https://github.com/ava-labs/EncryptedERC"]]],
            ["Trust", [["Resolver is trusted (v1)", "/#trust"], ["Roadmap: threshold keys", "/#trust"]]],
          ].map(([title, items]) => (
            <div key={title as string} className="bg-ink p-6">
              <p className="tag mb-4 text-fog">{title as string}</p>
              <ul className="space-y-2 text-sm">
                {(items as string[][]).map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="hover:text-sage" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex flex-col justify-between bg-ink p-6">
            <Logomark size={44} className="text-sage" />
            <p className="tag mt-6 text-fog">
              Testnet. Unaudited.
              <br />
              Who bet is public. How much is hidden.
            </p>
          </div>
        </div>
        <div className="select-none px-4 pb-8 pt-12 text-center" aria-hidden="true">
          <span className="block font-display text-[16vw] font-extrabold leading-[1.05] tracking-[0.01em] text-sage/[0.14] min-[1440px]:text-[230px]">PYTHIA</span>
        </div>
      </Frame>
    </footer>
  );
}
