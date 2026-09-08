"use client";

import { useEffect, useState } from "react";
import {
  staleTabState, startVaultSync, subscribeStaleTab, type StaleTabState,
} from "@/lib/vaultSync";

const quiet: StaleTabState = { restored: 0, lastRestoredAt: null, olderTab: null, thisTabOld: false };

function useStaleTab(): StaleTabState {
  /* Quiet on the server and on first paint; the truth arrives after mount. */
  const [s, setS] = useState<StaleTabState>(quiet);
  useEffect(() => {
    startVaultSync();
    setS(staleTabState());
    return subscribeStaleTab(() => setS(staleTabState()));
  }, []);
  return s;
}

/**
 * Says which tab is the problem, and what it will do until it is fixed.
 *
 * Rendered by both shells, so any page that can hold a vault can carry the warning. It is
 * empty in the ordinary case and does not reserve space, so the gates that measure the
 * page see nothing until there is something to say.
 */
export function StaleTabNotice() {
  const s = useStaleTab();
  if (s.thisTabOld) {
    return (
      <div className="banner stale-tab" role="alert" data-stale-tab="this">
        <b>This tab is running an older version of Vickrey.</b> Until it is reloaded it
        can delete bids that other tabs save — every 20 seconds, without an error.{" "}
        <button type="button" onClick={() => window.location.reload()}>Reload this tab</button>
      </div>
    );
  }
  if (s.olderTab || s.restored) {
    return (
      <div className="banner stale-tab" role="alert" data-stale-tab="other">
        <b>Another tab is running an older version of Vickrey
        {s.restored ? " and has been deleting saved bids" : ""}.</b>{" "}
        {s.restored
          ? `They were restored here (${s.restored} so far). `
          : "It may delete saved bids. "}
        Until that tab is closed or reloaded it will keep doing this every 20 seconds.
        Close or reload every other Vickrey tab, then this one.
      </div>
    );
  }
  return null;
}
