import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

// Hebrew glyphs fall back to this per character, so Latin text and numbers keep
// the terminal's monospace look while Hebrew renders in a readable sans-serif.
const heebo = Heebo({ subsets: ["hebrew", "latin"], variable: "--font-he", display: "swap" });

export const metadata: Metadata = {
  title: "OpenTerminal",
  description: "Bloomberg-style financial terminal on free data sources",
  other: { google: "notranslate" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" translate="no" className={heebo.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
