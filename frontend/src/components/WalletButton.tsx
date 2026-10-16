"use client";

import { useEffect, useRef, useState } from "react";
import { addressUrl } from "@/config";
import { shortAddr } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

/** Close a popover on outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function WalletButton() {
  const w = useWallet();
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const pickerRef = useDismiss(picker, () => setPicker(false));
  const menuRef = useDismiss(menu, () => setMenu(false));

  async function onConnectClick() {
    const list = w.refreshWallets(); // wallets may have announced after page load
    if (list.length === 1) await w.connect(list[0].id);
    else setPicker((p) => !p); // several wallets: choose; none: show install help
  }

  if (!w.address) {
    return (
      <div className="relative" ref={pickerRef}>
        <button className="btn-primary" disabled={w.connecting} onClick={onConnectClick} aria-haspopup="dialog" aria-expanded={picker}>
          {w.connecting ? "Check your wallet…" : "Connect wallet"}
        </button>
        {picker && (
          <div role="dialog" aria-label="Choose a wallet" className="card absolute right-0 z-40 mt-2 w-64 p-2 shadow-glow">
            {w.wallets.length > 0 ? (
              <>
                <p className="px-2 pb-1.5 pt-1 text-xs uppercase tracking-wider text-fog">Choose a wallet</p>
                {w.wallets.map((x) => (
                  <button
                    key={x.id}
                    className="btn-ghost mb-1 w-full justify-start gap-3"
                    onClick={async () => {
                      setPicker(false);
                      await w.connect(x.id);
                    }}
                  >
                    {x.icon ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={x.icon} alt="" className="h-5 w-5 rounded" /> : <span className="h-5 w-5 rounded bg-raised" />}
                    {x.name}
                  </button>
                ))}
              </>
            ) : (
              <div className="p-2 text-sm">
                <p className="mb-2 font-medium">No wallet detected</p>
                <p className="mb-3 text-xs text-fog">Install a wallet extension, then reload this page.</p>
                <a className="mb-1 block text-violet-soft underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  Get MetaMask ↗
                </a>
                <a className="block text-violet-soft underline" href="https://core.app/" target="_blank" rel="noreferrer">
                  Get Core ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2" ref={menuRef}>
      {!w.onFuji && (
        <button className="btn border border-gold/60 text-gold hover:bg-gold/10" onClick={() => w.ensureNetwork().catch(() => {})}>
          Switch to Fuji
        </button>
      )}
      <button className="btn-ghost num gap-2" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
        <span className={`h-2 w-2 rounded-full ${w.onFuji ? "bg-yes" : "bg-gold"}`} />
        {shortAddr(w.address)}
      </button>
      {menu && (
        <div role="menu" className="card absolute right-0 top-full z-40 mt-2 w-56 p-2 shadow-glow">
          <p className="num break-all px-2 pb-2 pt-1 text-xs text-fog">{w.address}</p>
          <button
            role="menuitem"
            className="btn-ghost mb-1 w-full justify-start"
            onClick={async () => {
              await navigator.clipboard?.writeText(w.address!).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          <a role="menuitem" className="btn-ghost mb-1 w-full justify-start" href={addressUrl(w.address)} target="_blank" rel="noreferrer">
            View on Snowtrace ↗
          </a>
          {!w.onFuji && (
            <button role="menuitem" className="btn-ghost mb-1 w-full justify-start text-gold" onClick={() => (setMenu(false), w.ensureNetwork().catch(() => {}))}>
              Switch to Avalanche Fuji
            </button>
          )}
          <button
            role="menuitem"
            className="btn-ghost w-full justify-start text-no"
            onClick={() => {
              setMenu(false);
              w.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Visible, dismissible connection error (the old inline text was easy to miss, especially on mobile). */
export function WalletError() {
  const w = useWallet();
  if (!w.error) return null;
  return (
    <div role="alert" className="border-b border-no/40 bg-no/10 px-4 py-2.5 text-center text-sm text-pearl">
      {w.error}{" "}
      <button className="ml-2 underline" onClick={w.dismissError}>
        Dismiss
      </button>
    </div>
  );
}
