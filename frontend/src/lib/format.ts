import { ethers } from "ethers";

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Fixed-point bigint to a trimmed decimal string, with thousands separators. */
export function fmtUnits(v: bigint, decimals: number, maxFrac = 2): string {
  const s = ethers.formatUnits(v, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, maxFrac).replace(/0+$/, "");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${int}.${frac.padEnd(Math.min(2, maxFrac), "0")}` : int;
}

/** Parse a user-typed decimal amount into base units; null if invalid or too precise. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  try {
    return ethers.parseUnits(t, decimals);
  } catch {
    return null;
  }
}

export function countdown(toSeconds: number, nowSeconds: number): string {
  const d = toSeconds - nowSeconds;
  if (d <= 0) return "closed";
  const days = Math.floor(d / 86400);
  const h = Math.floor((d % 86400) / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  if (days > 0) return `${days}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export const fmtDateTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** YES share of the published pool in percent (0..100), or null when nothing is published. */
export function yesPercent(yes: bigint, no: bigint): number | null {
  const total = yes + no;
  if (total === 0n) return null;
  return Number((yes * 10000n) / total) / 100;
}
