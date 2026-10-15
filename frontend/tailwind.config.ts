import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#070709", // page background
        panel: "#0d0d13", // cards
        raised: "#14141c", // inputs, hovers
        line: "#23232f",
        violet: { DEFAULT: "#8B5CF6", soft: "#A78BFA", deep: "#6D3FD6" },
        gold: { DEFAULT: "#D4AF37", soft: "#E6C75F" },
        fog: "#9a9aae", // muted text
        pearl: "#ECECF3", // primary text
        yes: "#34D399",
        no: "#F472B6",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(139,92,246,.35), 0 8px 40px -8px rgba(139,92,246,.45)",
      },
      keyframes: {
        sheen: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
      },
      animation: { sheen: "sheen 2.2s linear infinite" },
    },
  },
  plugins: [],
};

export default config;
