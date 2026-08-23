"use client";

import { Status } from "@vickrey/client";
import { CountUp } from "./CountUp";
import { Ladder } from "./Ladder";
import type { AuctionView } from "@/lib/chain";
import { formatUnits, priceAt } from "@/lib/config";

/**
 * The instrument, at full size, as the hero object.
 *
 * Not a thumbnail with a caption — this object *is* the pitch, so it carries every
 * element that makes the argument: the price scale, the hatched band above the
 * clearing rung, the gradient clearing rung itself, the hatched band below, the
 * braced counts on the right, and the clearing price read out large.
 *
 * It shows a real settled auction read from chain, never a mock.
 */
export function HeroInstrument({
  auction,
  playing,
  motionKey,
  onReplay,
  onOpen,
}: {
  auction: AuctionView;
  playing: boolean;
  motionKey: number;
  onReplay: () => void;
  onOpen: () => void;
}) {
  const settled =
    auction.status >= Status.Settled && auction.status !== Status.Cancelled;
  const clearing = settled ? priceAt(auction.terms, auction.clearingLevel) : 0n;

  return (
    <div className="rig">
      <div className="rig-head">
        <span>
          Auction #{auction.terms.auctionId.toString()} · {auction.terms.numLevels} levels
        </span>
        <button className="rig-replay" onClick={onReplay} title="Replay the settlement (R)">
          replay
        </button>
      </div>

      <div className="rig-ladder">
        <Ladder
          key={`hero-${motionKey}`}
          numLevels={auction.terms.numLevels}
          reservePrice={auction.terms.reservePrice}
          tick={auction.terms.tick}
          symbol={auction.paymentSymbol}
          bidCount={auction.bidCount}
          status={auction.status}
          clearingLevel={settled ? auction.clearingLevel : null}
        />
      </div>

      <div className="rig-readout">
        <div>
          <div className="rig-lab">Clearing price</div>
          <div className="price">
            <CountUp
              key={`hero-price-${motionKey}`}
              value={clearing}
              animate={playing}
              format={(v) => formatUnits(v)}
            />
            <span className="rig-unit"> {auction.paymentSymbol}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="rig-lab">Bids</div>
          <div className="rig-bids">{auction.bidCount}</div>
        </div>
      </div>

      <button className="rig-open" onClick={onOpen}>
        Inspect this auction →
      </button>
    </div>
  );
}
