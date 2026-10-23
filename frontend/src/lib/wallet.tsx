"use client";

/**
 * Wallet connection over EIP-1193 (EIP-6963 discovery, with window.ethereum as a fallback).
 * Adds / switches to Avalanche Fuji automatically and exposes a viem WalletClient. Message
 * signatures are memoized per session so deriving the eERC keys never prompts twice.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, defineChain, type Account, type Chain, type Transport, type WalletClient } from "viem";
import { chainMeta, config } from "@/config";
import { friendlyError } from "@/lib/errors";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...a: never[]) => void): void;
  removeListener?(event: string, handler: (...a: never[]) => void): void;
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193;
}

export type PythiaWalletClient = WalletClient<Transport, Chain, Account>;

export const fuji = defineChain({
  id: config.chainId,
  network: "fuji",
  name: chainMeta.name,
  nativeCurrency: chainMeta.currency,
  rpcUrls: { default: { http: [config.rpcUrl] }, public: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: "Snowtrace", url: config.explorerUrl } },
});

interface WalletCtx {
  wallets: DiscoveredWallet[];
  address: `0x${string}` | null;
  chainId: number | null;
  onFuji: boolean;
  connecting: boolean;
  error: string | null;
  connect(id?: string): Promise<void>;
  disconnect(): void;
  dismissError(): void;
  /** Re-run wallet discovery (extensions can announce late). */
  refreshWallets(): DiscoveredWallet[];
  /** Switch (or add) Fuji; resolves once the wallet is on the right chain. */
  ensureNetwork(): Promise<void>;
  /** A viem wallet client whose signMessage is memoized for this session. */
  getWalletClient(): PythiaWalletClient;
  /** The wallet's own error from the last failed signature, if any (cleared on read). */
  takeSignError(): unknown;
}

const Ctx = createContext<WalletCtx | null>(null);
const LAST_KEY = "pythia:wallet";

const hex = (n: number) => `0x${n.toString(16)}`;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [active, setActive] = useState<DiscoveredWallet | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sigCache = useRef(new Map<string, Promise<`0x${string}`>>());
  const lastSignError = useRef<unknown>(null);
  const takeSignError = useCallback(() => {
    const e = lastSignError.current;
    lastSignError.current = null;
    return e;
  }, []);

  const discover = useCallback(() => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail as { info: { uuid: string; name: string; icon?: string }; provider: Eip1193 };
      found.set(d.info.uuid, { id: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    // EIP-6963 wallets are preferred; only fall back to window.ethereum when none announced
    // (otherwise MetaMask would show up twice: once by name and once as "Browser wallet").
    const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (found.size === 0 && injected) {
      found.set("injected", { id: "injected", name: "Browser wallet", provider: injected });
    }
    const list = [...found.values()];
    setWallets(list);
    return list;
  }, []);

  // Keep discovering (wallets may announce after load) and silently reconnect the last wallet.
  // Extensions often inject a moment after the page hydrates, so a single check at load misses them:
  // retry whenever the saved wallet shows up, and keep probing for a few seconds.
  const restoredRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const last = localStorage.getItem(LAST_KEY);

    const restore = async (w: DiscoveredWallet) => {
      if (restoredRef.current || cancelled) return;
      try {
        const accts = (await w.provider.request({ method: "eth_accounts" })) as string[];
        if (restoredRef.current || cancelled || !accts[0]) return; // locked or permission revoked: stay disconnected
        restoredRef.current = true;
        setActive(w);
        setAddress(accts[0] as `0x${string}`);
        setChainId(Number(await w.provider.request({ method: "eth_chainId" })));
      } catch {
        /* wallet not ready yet; the next announce or probe will retry */
      }
    };

    const keep = (e: Event) => {
      const d = (e as CustomEvent).detail as { info: { uuid: string; name: string; icon?: string }; provider: Eip1193 };
      const w: DiscoveredWallet = { id: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider };
      setWallets((prev) => (prev.some((x) => x.id === w.id) ? prev : [...prev, w]));
      if (last && w.id === last) void restore(w);
    };
    window.addEventListener("eip6963:announceProvider", keep);

    const attempt = (list: DiscoveredWallet[]) => {
      if (!last) return;
      const w = list.find((x) => x.id === last);
      if (w) void restore(w);
    };
    attempt(discover());

    // Probe for ~4 s: re-ask for EIP-6963 announcements and look for a late window.ethereum.
    let tries = 0;
    const probe = window.setInterval(() => {
      if (restoredRef.current || cancelled || !last || ++tries > 16) {
        window.clearInterval(probe);
        return;
      }
      attempt(discover());
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(probe);
      window.removeEventListener("eip6963:announceProvider", keep);
    };
  }, [discover]);

  // Follow account / chain changes from the wallet.
  useEffect(() => {
    if (!active?.provider.on) return;
    const onAccounts = (accts: string[]) => {
      sigCache.current.clear();
      setAddress((accts[0] as `0x${string}`) ?? null);
    };
    const onChain = (id: string) => setChainId(Number(id));
    active.provider.on("accountsChanged", onAccounts as never);
    active.provider.on("chainChanged", onChain as never);
    return () => {
      active.provider.removeListener?.("accountsChanged", onAccounts as never);
      active.provider.removeListener?.("chainChanged", onChain as never);
    };
  }, [active]);

  const switchToFuji = useCallback(async (provider: Eip1193) => {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(config.chainId) }] });
    } catch (e) {
      const code = (e as { code?: number }).code;
      // 4902: chain not added yet (some wallets report -32603 / "Unrecognized chain").
      if (code === 4902 || code === -32603 || /unrecognized|not added|add/i.test((e as Error).message ?? "")) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex(config.chainId),
              chainName: chainMeta.name,
              nativeCurrency: chainMeta.currency,
              rpcUrls: [config.rpcUrl],
              blockExplorerUrls: [config.explorerUrl],
            },
          ],
        });
      } else {
        throw e;
      }
    }
  }, []);

  const connectingRef = useRef(false);
  const connect = useCallback(
    async (id?: string) => {
      if (connectingRef.current) return; // ignore double clicks while a wallet prompt is open
      connectingRef.current = true;
      setConnecting(true);
      setError(null);
      try {
        const list = discover();
        const w = list.find((x) => x.id === id) ?? list.find((x) => x.id === localStorage.getItem(LAST_KEY)) ?? list[0];
        if (!w) throw new Error("No wallet found. Install MetaMask or Core, then reload this page.");
        const accts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
        if (!accts[0]) throw new Error("Your wallet returned no account. Unlock it and try again.");
        restoredRef.current = true;
        setActive(w);
        setAddress(accts[0] as `0x${string}`);
        localStorage.setItem(LAST_KEY, w.id);
        let cid = Number(await w.provider.request({ method: "eth_chainId" }));
        setChainId(cid);
        if (cid !== config.chainId) {
          // Connected is connected: a refused network switch must not undo the connection.
          try {
            await switchToFuji(w.provider);
            cid = Number(await w.provider.request({ method: "eth_chainId" }));
            setChainId(cid);
          } catch (e) {
            setError(`Connected, but your wallet is not on Avalanche Fuji. ${friendlyError(e).message}`);
          }
        }
      } catch (e) {
        setError(friendlyError(e).message);
      } finally {
        connectingRef.current = false;
        setConnecting(false);
      }
    },
    [discover, switchToFuji],
  );

  const dismissError = useCallback(() => setError(null), []);

  const disconnect = useCallback(() => {
    // Best effort: also revoke the site's permission so the wallet really forgets this connection.
    active?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
    sigCache.current.clear();
    localStorage.removeItem(LAST_KEY);
    restoredRef.current = true; // an explicit disconnect must never be undone by a late auto-restore
    setActive(null);
    setAddress(null);
    setChainId(null);
    setError(null);
  }, [active]);

  const ensureNetwork = useCallback(async () => {
    if (!active) throw new Error("Wallet not connected");
    const cid = Number(await active.provider.request({ method: "eth_chainId" }));
    if (cid !== config.chainId) await switchToFuji(active.provider);
    setChainId(Number(await active.provider.request({ method: "eth_chainId" })));
  }, [active, switchToFuji]);

  const getWalletClient = useCallback((): PythiaWalletClient => {
    if (!active || !address) throw new Error("Wallet not connected");
    const base = createWalletClient({ account: address, chain: fuji, transport: custom(active.provider) });
    const sign = base.signMessage.bind(base);
    // Memoize signatures (the eERC key derivation signs the same message more than once).
    const memo: typeof base.signMessage = ((args: { message: string }) => {
      const key = `${address}:${typeof args.message === "string" ? args.message : "raw"}`;
      let p = sigCache.current.get(key);
      if (!p) {
        p = sign(args as never) as Promise<`0x${string}`>;
        sigCache.current.set(key, p);
        p.catch((e) => {
          sigCache.current.delete(key);
          lastSignError.current = e; // the SDK may rethrow a generic error; keep the wallet's own
        });
      }
      return p;
    }) as never;
    return Object.assign(base, { signMessage: memo }) as unknown as PythiaWalletClient;
  }, [active, address]);

  const value = useMemo<WalletCtx>(
    () => ({
      wallets,
      address,
      chainId,
      onFuji: chainId === config.chainId,
      connecting,
      error,
      connect,
      disconnect,
      dismissError,
      refreshWallets: discover,
      ensureNetwork,
      getWalletClient,
      takeSignError,
    }),
    [wallets, address, chainId, connecting, error, connect, disconnect, dismissError, discover, ensureNetwork, getWalletClient, takeSignError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used inside <WalletProvider>");
  return c;
}
