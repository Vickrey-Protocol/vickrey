import type { Metadata } from "next";
import { Bodoni_Moda, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";

/* Self-hosted by Next, so the page makes no third-party font request.
   Bodoni is display-only and never below 30px — see docs/typography.md. */
const display = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-display",
  display: "swap",
});
/* Not Inter and not Space Grotesk — those are the tells. */
const body = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vickrey.0xo.in";
const DESCRIPTION =
  "The highest bidder wins and pays the second-highest bid, and the chain never learns " +
  "what anyone bid. The outcome is proved on-chain, not asserted.";

/**
 * `metadataBase` is what turns every relative URL in a page's metadata into an absolute
 * one — canonical links and Open Graph both need absolute URLs, and without a base Next
 * silently emits none. Sourced from an env var so the domain lives in one place; the
 * fallback is the live host rather than localhost, because a preview that advertises
 * localhost in its OG tags is worse than one that advertises production.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Vickrey — sealed-bid auctions on STRK20",
    template: "%s · Vickrey",
  },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Vickrey",
    url: "/",
    title: "Vickrey — sealed-bid auctions on STRK20",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Vickrey — sealed-bid auctions on STRK20",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body><WalletProvider>{children}</WalletProvider></body>
    </html>
  );
}
