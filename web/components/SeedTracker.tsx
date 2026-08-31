"use client";

import { useEffect, useState } from "react";
import type { PublicBid } from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import { countdown, utcDate } from "@/lib/config";

/**
 * Which seeds have arrived, which have not, and how long is left.
 *
 * The auctioneer needs this because a missing seed is not an error anyone is told
 * about — it is a bid that will be forfeited, and the only way to prevent that is to
 * notice and go and ask. Previously the console reported a count once, after collection,
 * which is the moment it stops being useful.
 *
 * **It renders arrival and nothing else.** The reveal payload contains each bidder's
 * level; drawing it here would put every bid amount on the auctioneer's screen, and a
 * screenshot of this console would then be the disclosure the whole protocol exists to
 * prevent. The auctioneer learns the levels after sealing — the interface still must not
 * draw them.
 */
export function SeedTracker({
  auction, bids, now,
}: { auction: AuctionView; bids: PublicBid[]; now: number }) {
  const [arrived, setArrived] = useState<Set<number> | null>(null);
  const [failed, setFailed] = useState(false);
  /* 503 is the relay saying it is switched off, which is terminal — polling a deliberate
     decision every ten seconds forever is noise, and calling it "could not reach" reads
     as a fault when nothing is wrong. */
  const [relayOff, setRelayOff] = useState(false);

  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/reveals?auctionId=${auction.terms.auctionId}`);
        if (res.status === 503) { if (live) { setRelayOff(true); clearInterval(t); } return; }
        const { reveals } = (await res.json()) as { reveals: Array<{ index: number }> };
        if (!live) return;
        /* Only the index is read out of the payload. The level travels with it and is
           deliberately not destructured, so it cannot reach state and cannot be
           rendered by accident later. */
        setArrived(new Set(reveals.map((r) => r.index)));
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    };
    const t = setInterval(() => void poll(), 10_000);
    void poll();
    return () => { live = false; clearInterval(t); };
  }, [auction.terms.auctionId]);

  /* The same instant `abandon` becomes callable: seal plus the dispute window. It is
     the auctioneer's deadline to settle and, working backwards, every bidder's deadline
     to have sent a seed. */
  const deadline = auction.sealedAtTime + auction.disputeWindow;
  const left = countdown(deadline, now);
  const urgent = left !== null && deadline - now < 3600;
  const missing = arrived ? bids.filter((b) => !arrived.has(b.index)) : [];

  return (
    <div className="panel" style={{ marginBlockStart: ".9rem" }}>
      <div className="spread">
        <p className="eyebrow">Seeds</p>
        <span className={urgent ? "countdown urgent" : "countdown"}>
          {left ?? "window closed"}
        </span>
      </div>
      <p className="note" style={{ marginTop: ".3rem" }}>
        Settle before {utcDate(deadline)} — after that anyone can abandon the auction and
        every bid is refunded.
      </p>

      {relayOff ? (
        <p className="note" style={{ marginTop: ".8rem" }}>
          The relay is switched off — it exposed every revealed bid to anyone who asked.
          Bidders send you their reveal directly; paste them below and this tracks them.
        </p>
      ) : failed ? (
        <p className="note" style={{ marginTop: ".8rem" }}>
          Could not reach the relay. Pasted reveals still work.
        </p>
      ) : arrived === null ? (
        <p className="note" style={{ marginTop: ".8rem" }}>Checking…</p>
      ) : (
        <>
          <p style={{ marginTop: ".8rem" }}>
            <b>{arrived.size} of {bids.length}</b> received
            {missing.length > 0 && (
              <span className="note">
                {" "}· {missing.length} outstanding, and each one is a forfeited bid if it
                never arrives
              </span>
            )}
          </p>
          <div className="seeds">
            {bids.map((b) => {
              const here = arrived.has(b.index);
              return (
                /* No title: the state is already spelled out in the chip itself, so a
                   hover duplicate would only be information touch users cannot reach. */
                <span key={b.index} className={here ? "seed seed-in" : "seed"}>
                  <span className="mono">#{b.index}</span>
                  <span className="note">{here ? "received" : "waiting"}</span>
                </span>
              );
            })}
          </div>
          <p className="note" style={{ marginTop: ".7rem" }}>
            Arrival only. Levels are never drawn here — a screenshot of this console must
            not be a disclosure.
          </p>
        </>
      )}
    </div>
  );
}
