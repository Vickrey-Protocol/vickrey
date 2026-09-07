import { Geist, Geist_Mono } from "next/font/google";
import LandingClient from "@/components/LandingClient";
import { readAll, toWire, type WireAuction } from "@/lib/chain";
import { isDeployed } from "@/lib/config";
import "./landing.css";

/* Geist, self-hosted by next/font so the page makes no third-party request. The
   variables are set on this page's wrapper rather than on <html>, so no other route
   pays for a face it does not use. */
const sans = Geist({ subsets: ["latin"], variable: "--font-lp", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-lp-mono", display: "swap" });

/**
 * The book is read on the server and rendered into the HTML.
 *
 * An earlier version fetched it in the browser, so the page painted a grey skeleton,
 * waited on the chain, and only then started the animation — the moment the design
 * exists to show sat behind a dead wait. Cached and revalidated so the fetch does not
 * sit in front of time-to-first-byte either.
 */
export const revalidate = 30;

export default async function Page() {
  let initial: WireAuction[] = [];
  if (isDeployed()) {
    try { initial = (await readAll()).map(toWire); }
    catch { /* The client retries and shows an honest error. It never blocks the instrument. */ }
  }
  return (
    <div className={`lp ${sans.variable} ${mono.variable}`}>
      <LandingClient initial={initial} />
    </div>
  );
}
