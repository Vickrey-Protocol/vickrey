"use client";

import { Status } from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import { countdown, formatUnits, kindLabel, priceAt } from "@/lib/config";
import { Ladder } from "./Ladder";

const LABEL: Record<Status, string> = {
  [Status.None]: "unknown",
  [Status.Open]: "bidding",
  [Status.Sealed]: "sealed",
  [Status.Settled]: "settled",
  [Status.Finalized]: "resolved",
  [Status.Cancelled]: "cancelled",
};
const CLS: Record<Status, string> = {
  [Status.None]: "cancelled",
  [Status.Open]: "open",
  [Status.Sealed]: "sealed",
  [Status.Settled]: "settled",
  [Status.Finalized]: "resolved",
  [Status.Cancelled]: "cancelled",
};

/**
 * A card per auction, each carrying a thumbnail of its own ladder. Two of these side
 * by side show a visitor the whole idea before they click anything: one ladder wholly
 * hatched, one cut by a single line.
 */
export function AuctionCard({
  auction,
  selected,
  onSelect,
  now,
}: {
  auction: AuctionView;
  selected: boolean;
  onSelect: () => void;
  now: number;
}) {
  const settled =
    auction.status >= Status.Settled && auction.status !== Status.Cancelled;
  const price = settled ? priceAt(auction.terms, auction.clearingLevel) : null;

  return (
    <button
      type="button"
      className="card-auction glow"
      aria-current={selected}
      onClick={onSelect}
    >
      <div className="meta">
        <span className="title">Auction #{auction.terms.auctionId.toString()}</span>
        <span className={`pill ${CLS[auction.status]}`}>{LABEL[auction.status]}</span>
      </div>

      <Ladder
        compact
        numLevels={auction.terms.numLevels}
        reservePrice={auction.terms.reservePrice}
        tick={auction.terms.tick}
        symbol={auction.paymentSymbol}
        bidCount={auction.bidCount}
        status={auction.status}
        clearingLevel={settled ? auction.clearingLevel : null}
      />

      <div className="meta">
        <span>{kindLabel(auction.terms.kind)}</span>
        <span>
          {auction.bidCount} bid{auction.bidCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="meta">
        <span>{price === null ? "clearing price" : "cleared at"}</span>
        {price === null ? (
          <b>{auction.status === Status.Open
            ? (countdown(auction.bidDeadline, now) ? "still open" : "closing")
            : "not yet proved"}</b>
        ) : (
          <b className="price">{formatUnits(price, auction.paymentDecimals)} {auction.paymentSymbol}</b>
        )}
      </div>
    </button>
  );
}
