import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vickrey — sealed-bid auctions on STRK20",
  description:
    "Second-price auctions where the losing bids are never published. The outcome is proved on-chain, not asserted.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
