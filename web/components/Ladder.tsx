"use client";

import type { CSSProperties } from "react";
import { Status } from "@vickrey/client";
import { formatUnits } from "@/lib/config";

export interface LadderProps {
  numLevels: number;
  reservePrice: bigint;
  tick: bigint;
  symbol?: string;
  decimals?: number;
  /** Set once the auction is settled. Before that nothing about any bid is known. */
  clearingLevel?: number | null;
  /** How many bids exist. Absence has to read as rigour, and it can't without a count. */
  bidCount?: number;
  pickedLevel?: number | null;
  onPick?: (level: number) => void;
  status: Status;
  /** Thumbnail form for a card: no scale, no annotations. */
  compact?: boolean;
  /** Draw the frame without a price scale, for when the config is not known yet. */
  hideScale?: boolean;
}

/**
 * The price ladder — a measuring instrument, not a canvas.
 *
 * Two rules govern it.
 *
 * **Rungs are always drawn.** Hatching tints each rung's own background rather than
 * being a panel laid over the top, so an unknown range reads as "these levels,
 * unreadable" and never as a box that failed to load.
 *
 * **The bids have to be visible as bids.** A hatched strip with nothing in it reads as
 * empty, which is the opposite of the point: the bids exist, they are escrowed, and
 * their positions are the only thing missing. So every band is braced and counted —
 * "3 bids somewhere in this range" before settlement; after it, one bid at or above
 * the line, the rest at or below, and the line itself carrying the only number the
 * chain learned.
 */
export function Ladder({
  numLevels,
  reservePrice,
  tick,
  symbol = "",
  decimals = 18,
  clearingLevel = null,
  bidCount = 0,
  pickedLevel = null,
  onPick,
  status,
  compact = false,
  hideScale = false,
}: LadderProps) {
  const settled = clearingLevel !== null && status >= Status.Settled;
  const rows = Array.from({ length: numLevels }, (_, i) => numLevels - 1 - i);
  const price = (l: number) => reservePrice + tick * BigInt(l);

  const plural = (n: number) => `${n} bid${n === 1 ? "" : "s"}`;

  // Where each brace starts and how far it runs, in rows.
  const bands = settled
    ? [
        { from: numLevels - 1, to: clearingLevel! + 1, kind: "above" as const,
          label: numLevels - 1 >= clearingLevel! + 1 ? `1 bid, at or above` : "" },
        { from: clearingLevel! - 1, to: 0, kind: "below" as const,
          label: clearingLevel! - 1 >= 0 ? `${plural(Math.max(bidCount - 1, 0))}, at or below` : "" },
      ].filter((b) => b.from >= b.to && b.label)
    : bidCount > 0
      ? [{ from: numLevels - 1, to: 0, kind: "unknown" as const,
           label: `${plural(bidCount)} somewhere in here` }]
      : [];

  const bandFor = (level: number) => bands.find((b) => level <= b.from && level >= b.to);

  return (
    /* `pickable` marks the interactive ladder. A rung is 1.28rem tall, which is legible
       as a diagram and far under the 44px a finger needs — but only the ladder you can
       actually bid on should grow, since the one on a settled auction is a picture. */
    <div className={[
      "ladder-wrap", compact ? "compact" : "", onPick ? "pickable" : "",
    ].filter(Boolean).join(" ")}>
      <div
        className="ladder"
        role="img"
        aria-label={
          settled
            ? `Price ladder. Cleared at ${formatUnits(price(clearingLevel!), decimals)} ${symbol}. No bid amount is disclosed.`
            : `Price ladder with ${plural(bidCount)}. No bid amount is readable.`
        }
      >
        {rows.map((level) => {
          const isClearing = settled && level === clearingLevel;
          const isAbove = settled && level > clearingLevel!;
          const isPicked = !settled && pickedLevel === level;
          const band = bandFor(level);
          const bandStarts = band && level === band.from;

          const cls = [
            "rung",
            isClearing ? "is-clearing" : isAbove ? "is-above" : "is-unknown",
            isPicked ? "is-picked" : "",
            onPick ? "is-pick" : "",
          ].filter(Boolean).join(" ");

          return (
            <div className="ladder-row" key={level}>
              {!compact && !hideScale && (
                <span className={`scale${isClearing ? " at" : ""}`}>
                  {formatUnits(price(level), decimals, 4, 2)}
                </span>
              )}

              {onPick ? (
                <button
                  type="button"
                  className={cls}
                  style={{ "--i": rows.length - 1 - level } as CSSProperties}
                  onClick={() => onPick(level)}
                  aria-pressed={isPicked}
                  aria-label={`Bid ${formatUnits(price(level), decimals)} ${symbol}`}
                />
              ) : (
                <span className={cls} style={{ "--i": rows.length - 1 - level } as CSSProperties} />
              )}

              {!compact && (
                <span className="ann">
                  {isClearing && (
                    <b className="clearing-note">
                      {formatUnits(price(level), decimals)} {symbol} · clearing price
                    </b>
                  )}
                  {isPicked && <b className="picked-note">your bid</b>}
                  {/* One brace per band, anchored on its first row. Rendering it on
                      every row stacks N copies and the line runs off the page. */}
                  {bandStarts && (
                    <span
                      className={`brace ${band.kind}`}
                      style={{ height: `calc(100% * ${band.from - band.to + 1})` }}
                    >
                      <em>{band.label}</em>
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
