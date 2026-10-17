import type { Config } from "tailwindcss";

/**
 * PYTHIA design tokens. Language: flat sage and ink, a visible hairline grid, heavy tight
 * grotesk, small mono labels, and "redaction" (black bars) as the brand idea for hidden amounts.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1112",
        panel: "#111A1B",
        raised: "#172223",
        line: "#243030",
        // calm, desaturated accent (sage) instead of a loud brand colour
        sage: { DEFAULT: "#A8C8B8", deep: "#7FA896", soft: "#C4DBCE" },
        bone: "#EFE9DD",
        fog: "#8A9692",
        // semantic: YES = mint, NO / warnings = soft clay
        mint: "#9AD7B4",
        clay: "#D98E7B",
        yes: "#9AD7B4",
        no: "#D98E7B",
        // legacy aliases
        pearl: "#EFE9DD",
        violet: { DEFAULT: "#A8C8B8", soft: "#C4DBCE", deep: "#7FA896" },
        gold: { DEFAULT: "#A8C8B8", soft: "#C4DBCE" },
      },
      fontFamily: {
        display: ["var(--font-display)", "Helvetica Neue", "Arial", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        serif: ["var(--font-display)", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        glow: "none",
        hard: "6px 6px 0 0 #0B1112",
      },
      keyframes: {
        marquee: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-50%)" } },
        sheen: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
        rise: { "0%": { opacity: "0", transform: "translateY(18px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        redact: { "0%": { transform: "scaleX(0)" }, "100%": { transform: "scaleX(1)" } },
      },
      animation: {
        marquee: "marquee 38s linear infinite",
        sheen: "sheen 2.2s linear infinite",
        rise: "rise .8s cubic-bezier(.2,.7,.2,1) both",
        redact: "redact .7s cubic-bezier(.7,0,.2,1) .5s both",
      },
    },
  },
  plugins: [],
};

export default config;
