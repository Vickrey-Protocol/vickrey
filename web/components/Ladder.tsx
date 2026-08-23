"use client";

import { Status } from "@vickrey/client";
import { formatUnits } from "@/lib/config";

export interface LadderProps {
  numLevels: number;
  reservePrice: bigint;
  tick: bigint;
  decimals?: number;
  /** Set once the auction is settled. Before that, nothing about any bid is known. */
  clearingLevel?: number | null;
  /** Highlights the level the user is about to bid at. */
  pickedLevel?: number | null;
  onPick?: (level: number) => void;
  status: Status;
  /** Thumbnail form for a card: shorter rungs, no prices, no legend. */
  compact?: boolean;
}

/**
 * The price ladder.
 *
 * One rule governs this component: **a hatched region is never drawn without the
 * rungs behind it**. Hatching is applied to each rung's own background rather than
 * as a panel laid over the top, so an unknown range always reads as "these levels,
 * unreadable" and never as an empty box that has not loaded.
 *
 * Before settlement every rung is hatched, because that is the literal truth: any
 * bid could be at any level. After settlement there is exactly one solid line — the
 * clearing price — with hatch above it and hatch below. That image is the whole
 * protocol in two seconds.
 */
export function Ladder({
  numLevels,
  reservePrice,
  tick,
  decimals = 18,
  clearingLevel = null,
  pickedLevel = null,
  onPick,
  status,
  compact = false,
}: LadderProps) {
  const settled = clearingLevel !== null && status >= Status.Settled;
  const levels = Array.from({ length: numLevels }, (_, i) => numLevels - 1 - i);
  const price = (l: number) => reservePrice + tick * BigInt(l);

  return (
    <div>
      <div
        className={compact ? "ladder compact" : "ladder"}
        role="img"
        aria-label={
          settled
            ? `Price ladder, settled at level ${clearingLevel}. No bid amount is disclosed.`
            : "Price ladder. No bid amount is readable."
        }
      >
        {levels.map((level) => {
          const isClearing = settled && level === clearingLevel;
          const isAbove = settled && level > (clearingLevel as number);
          const isPicked = !settled && pickedLevel === level;

          const cls = [
            "ladder-track",
            isClearing ? "clearing" : isAbove ? "above" : "unknown",
            isPicked ? "picked" : "",
            onPick ? "pick" : "",
          ].filter(Boolean).join(" ");

          // A tag only on the boundaries of a region, so the ladder stays readable.
          let tag = "";
          if (compact) tag = "";
          else if (isClearing) tag = "clearing price";
          else if (settled && level === numLevels - 1) tag = "winner, at or above";
          else if (settled && level === (clearingLevel as number) - 1) tag = "the rest, at or below";
          else if (!settled && level === numLevels - 1) tag = "any bid, anywhere";
          if (isPicked) tag = "your bid";

          return (
            <div className="ladder-row" key={level} style={{ display: "contents" }}>
              {!compact && (
                <div className={`ladder-price${isClearing ? " at" : ""}`}>
                  {formatUnits(price(level), decimals)}
                </div>
              )}
              {onPick ? (
                <button
                  type="button"
                  className={cls}
                  style={{ padding: 0, textTransform: "none", letterSpacing: 0 }}
                  onClick={() => onPick(level)}
                  aria-pressed={isPicked}
                  aria-label={`Bid ${formatUnits(price(level), decimals)}`}
                >
                  {tag && <span className="tag">{tag}</span>}
                </button>
              ) : (
                <div className={cls}>{tag && <span className="tag">{tag}</span>}</div>
              )}
            </div>
          );
        })}
      </div>

      {!compact && (
        <div className="ladder-legend">
          <span><i className="h" />not disclosed</span>
          {settled && <span><i className="a" />winner is somewhere here</span>}
          {settled && <span><i className="c" />the one revealed number</span>}
        </div>
      )}
    </div>
  );
}
