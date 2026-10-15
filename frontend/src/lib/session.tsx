"use client";

/**
 * The user's eERC session: which key derivation matches their on-chain key, and whether they are
 * registered. The decryption key lives only in memory; it is derived from a wallet signature and
 * never stored or sent anywhere.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { config } from "@/config";
import { useWallet } from "@/lib/wallet";

export interface EercSession {
  address: `0x${string}`;
  decryptionKey: string;
  scheme: "sdk" | "backend-i0";
  registered: boolean;
}

interface Ctx {
  session: EercSession | null;
  unlocking: boolean;
  unlock(): Promise<EercSession>;
  /** Mark the account as registered after a successful registration. */
  markRegistered(): void;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [session, setSession] = useState<EercSession | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // A different account means a different key.
  useEffect(() => {
    setSession((s) => (s && s.address.toLowerCase() === wallet.address?.toLowerCase() ? s : null));
  }, [wallet.address]);

  const unlock = useCallback(async (): Promise<EercSession> => {
    if (session && session.address.toLowerCase() === wallet.address?.toLowerCase()) return session;
    setUnlocking(true);
    try {
      await wallet.ensureNetwork();
      const wc = wallet.getWalletClient();
      const core = await import("@pythia/eerc-core");
      const signer = { signMessage: (message: string) => wc.signMessage({ message }) };
      const r = await core.resolveDecryptionKey(wc, signer, {
        rpcUrl: config.rpcUrl,
        addresses: { encryptedERC: config.addresses.encryptedERC, registrar: config.addresses.registrar, token: config.addresses.token },
      });
      const s: EercSession = { address: wallet.address!, decryptionKey: r.decryptionKey, scheme: r.scheme, registered: r.registered };
      setSession(s);
      return s;
    } finally {
      setUnlocking(false);
    }
  }, [session, wallet]);

  const markRegistered = useCallback(() => setSession((s) => (s ? { ...s, registered: true } : s)), []);

  const value = useMemo(() => ({ session, unlocking, unlock, markRegistered }), [session, unlocking, unlock, markRegistered]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useEercSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useEercSession must be used inside <SessionProvider>");
  return c;
}
