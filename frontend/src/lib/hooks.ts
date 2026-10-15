"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHealth, type Health } from "@/lib/resolverApi";
import { fetchMarket, fetchMarkets, fetchOwner, type Market } from "@/lib/chain";
import { friendlyError } from "@/lib/errors";

/** Current unix time in seconds, re-rendering every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

interface Polled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[]): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(friendlyError(e).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ms, ...deps]);
  return { data, error, loading, reload: load };
}

export const useMarkets = () => usePoll<Market[]>(fetchMarkets, 15_000, []);
export const useMarket = (id: number) => usePoll<Market>(() => fetchMarket(id), 10_000, [id]);
export const useOwner = () => usePoll<string>(fetchOwner, 300_000, []);
export const useHealth = () => usePoll<Health>(fetchHealth, 20_000, []);
