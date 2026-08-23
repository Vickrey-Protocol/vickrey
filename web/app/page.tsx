import HomeClient from "@/components/HomeClient";
import { readAll, toWire } from "@/lib/chain";
import { isDeployed } from "@/lib/config";

/**
 * The auction book is read on the server and rendered into the HTML.
 *
 * An earlier version fetched it in the browser, which meant the page painted a grey
 * skeleton, waited on the chain, and only then started the animation — so on a slow
 * connection the moment the whole design exists to show sat behind a dead wait. The
 * structure of the instrument is configuration, not live state, so it belongs here.
 *
 * Cached and revalidated, so the fetch does not sit in front of time-to-first-byte
 * either. The client refreshes on mount because auction state moves; it no longer
 * needs to in order to draw.
 */
export const revalidate = 30;

export default async function Page() {
  if (!isDeployed()) return <HomeClient initial={[]} />;
  try {
    const auctions = await readAll();
    return <HomeClient initial={auctions.map(toWire)} />;
  } catch {
    // The client retries and shows an honest error on the data line. It never blocks
    // the instrument from drawing.
    return <HomeClient initial={[]} />;
  }
}
