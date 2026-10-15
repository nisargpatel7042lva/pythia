import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Footer, Nav } from "@/components/Nav";
import { SessionProvider } from "@/lib/session";
import { WalletProvider } from "@/lib/wallet";

const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-serif", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "PYTHIA: private prediction markets",
  description: "On Polymarket, your bet size is public. On PYTHIA, it isn't. Private prediction markets on Avalanche.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#070709" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <SessionProvider>
            <Nav />
            <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">{children}</main>
            <Footer />
          </SessionProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
