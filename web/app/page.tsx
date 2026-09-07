import LandingClient from "@/components/LandingClient";
import { readAll, toWire, type WireAuction } from "@/lib/chain";
import { isDeployed } from "@/lib/config";
import "./landing.css";


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
    <div className="lp">
      <LandingClient initial={initial} />
    </div>
  );
}
