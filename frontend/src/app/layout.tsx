import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Footer, Nav } from "@/components/Nav";
import { SessionProvider } from "@/lib/session";
import { WalletProvider } from "@/lib/wallet";

const display = Inter_Tight({ subsets: ["latin"], weight: ["500", "600", "700", "800", "900"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "PYTHIA: private prediction markets",
  description: "On Polymarket, your bet size is public. On PYTHIA, it isn't. Private prediction markets on Avalanche.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#A8C8B8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <SessionProvider>
            <Nav />
            <main>{children}</main>
            <Footer />
          </SessionProvider>
        </WalletProvider>
        <Analytics />
      </body>
    </html>
  );
}
