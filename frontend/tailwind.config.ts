import type { Config } from "tailwindcss";

/**
 * PYTHIA design tokens. Language: flat coral and ink, a visible hairline grid, heavy tight
 * grotesk, small mono labels, and "redaction" (black bars) as the brand idea for hidden amounts.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A0B",
        panel: "#101012",
        raised: "#17171A",
        line: "#2B2B30",
        coral: { DEFAULT: "#FF5B45", deep: "#E5432D", soft: "#FF8A78" },
        bone: "#F3EEE6",
        fog: "#8F8C87",
        lime: "#C5F63D",
        // semantic
        yes: "#C5F63D",
        no: "#FF5B45",
        // legacy aliases so older class names keep working
        pearl: "#F3EEE6",
        violet: { DEFAULT: "#FF5B45", soft: "#FF8A78", deep: "#E5432D" },
        gold: { DEFAULT: "#FF5B45", soft: "#FF8A78" },
      },
      fontFamily: {
        display: ["var(--font-display)", "Helvetica Neue", "Arial", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        serif: ["var(--font-display)", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        glow: "none",
        hard: "6px 6px 0 0 #0A0A0B",
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
