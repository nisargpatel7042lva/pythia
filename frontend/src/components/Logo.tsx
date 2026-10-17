import Link from "next/link";

/**
 * The PYTHIA mark: an isometric "P" built from slabs.
 * Drawn on a 120 x 124 grid; uses currentColor so it works on sage, ink or bone.
 */
export function Logomark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 120 124" width={size} height={(size * 124) / 120} fill="currentColor" className={className} aria-hidden="true">
      <polygon points="32,6 112,6 90,28 10,28" />
      <polygon points="112,6 112,52 90,74 90,28" />
      <polygon points="32,52 112,52 90,74 10,74" />
      <polygon points="10,74 32,52 32,96 10,118" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-display font-extrabold tracking-[-0.04em] ${className}`}>PYTHIA</span>;
}

/** Mark + wordmark, as used in the header. */
export function Logo({ tone = "bone", href = "/" }: { tone?: "bone" | "ink"; href?: string }) {
  return (
    <Link href={href} aria-label="PYTHIA home" className={`flex items-center gap-2.5 ${tone === "ink" ? "text-ink" : "text-bone"}`}>
      <Logomark size={32} className={tone === "ink" ? "text-ink" : "text-sage"} />
      <Wordmark className="text-[26px] leading-none" />
    </Link>
  );
}
