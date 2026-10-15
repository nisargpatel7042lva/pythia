import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PYTHIA",
  description: "Private prediction markets on Avalanche. Who bet is public. How much is hidden.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
