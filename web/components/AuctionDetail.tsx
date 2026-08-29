"use client";


import { AuctionKind, Status, type PublicBid } from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import { countdown, formatUnits, kindLabel, priceAt, utcDate } from "@/lib/config";
import type { StoredBid } from "@/lib/vault";
import type { Connection } from "@/lib/wallet";
import { STATUS } from "@/lib/ui";
import { useWallet } from "@/components/WalletProvider";
import { Ladder } from "@/components/Ladder";
import { CountUp } from "@/components/CountUp";
import { TrustStatement } from "@/components/TrustStatement";
import { BidPanel, ClaimPanel, DisputePanel, RevealPanel } from "@/components/Panels";

/**
 * The auction view, rendered once and used by both the public route and the dashboard.
 *
 * The split the whole restructure turns on: **viewing is public, acting needs a wallet.**
 * Everything in `Record` — the instrument, the terms, the clearing price, the bid book —
 * renders with no connection at all, because a judge has to be able to verify the claim
 * without connecting anything. `connection` only ever *adds* the action column; it never
 * gates evidence.
 *
 * So there is no `mode` prop. Passing `connection={null}` is the public view, and that
 * is not a special case handled elsewhere — it is the same component with one column
 * absent, which is what stops the two from drifting apart.
 */
export function AuctionDetail({
  auction, bids, mine, connection, now, onRefresh, motionKey = 0, playing = false,
}: {
  auction: AuctionView;
  bids: PublicBid[];
  mine: StoredBid[];
  connection: Connection | null;
  now: number;
  onRefresh: () => void;
  motionKey?: number;
  playing?: boolean;
}) {
  const { connect, connecting } = useWallet();
  const settled = auction.status === Status.Settled || auction.status === Status.Finalized;
  const resolved = auction.status === Status.Finalized;
  /* The price is derived from the proved level, not stored — the chain records the
     level the proofs pinned, and the ladder turns that into a figure. */
  const clearingPrice = settled ? priceAt(auction.terms, auction.clearingLevel) : null;
  const hasActions = Boolean(connection);

  return (
    <>
      <div className="panel">
        <div className="spread">
          <h1 className="display" style={{ fontSize: "var(--step-2)" }}>
            Auction #{auction.terms.auctionId.toString()}
            <span className="note" style={{ marginLeft: ".6rem" }}>{kindLabel(auction.terms.kind)}</span>
          </h1>
          <span className={`pill ${STATUS[auction.status].cls}`}>{STATUS[auction.status].label}</span>
        </div>

        <dl className="facts" style={{ marginTop: "1.1rem" }}>
          <div className="fact"><dt>Lot</dt>
            <dd>{formatUnits(auction.lotAmount, auction.lotDecimals)} {auction.lotSymbol}</dd></div>
          <div className="fact"><dt>Reserve</dt>
            <dd>{formatUnits(auction.terms.reservePrice, auction.paymentDecimals)} {auction.paymentSymbol}</dd></div>
          <div className="fact"><dt>Escrow, everyone</dt>
            <dd>{formatUnits(auction.collateral, auction.paymentDecimals)} {auction.paymentSymbol}</dd></div>
          <div className="fact"><dt>Levels</dt><dd>{auction.terms.numLevels}</dd></div>
          <div className="fact"><dt>Bids received</dt><dd>{auction.bidCount}</dd></div>
          <div className="fact"><dt>Clearing price</dt>
            {clearingPrice === null
              ? <dd className="undisclosed">not yet proved</dd>
              : <dd style={{ color: "var(--seal)", fontWeight: 600 }}>
                  {formatUnits(clearingPrice, auction.paymentDecimals)} {auction.paymentSymbol}</dd>}
          </div>
          {/* R4: the window is always on screen, always counting, and always carries the
              absolute UTC time beside it — a countdown alone is unciteable. */}
          <div className="fact">
            <dt>{auction.status === Status.Open ? "Bidding closes" : "Dispute window"}</dt>
            <dd>
              {auction.status === Status.Open ? (
                <>
                  {countdown(auction.bidDeadline, now) ?? "closed"}
                  <span className="note" style={{ display: "block" }}>{utcDate(auction.bidDeadline)}</span>
                </>
              ) : auction.status === Status.Settled ? (
                <>
                  <span className="countdown">{countdown(auction.disputeDeadline, now) ?? "closed"}</span>
                  <span className="note" style={{ display: "block" }}>{utcDate(auction.disputeDeadline)}</span>
                </>
              ) : `${auction.disputeWindow}s`}
            </dd>
          </div>
        </dl>
      </div>

      {resolved && (
        <div className="panel accent" style={{ marginTop: "1rem" }}>
          <div className="spread">
            <h2 className="display" style={{ fontSize: "var(--step-2)" }}>Resolved</h2>
            <span className="pill resolved">final</span>
          </div>
          <p className="note" style={{ marginTop: ".5rem" }}>
            The dispute window closed clean and the funds have moved. Bid #{auction.winnerIndex}{" "}
            won and paid {formatUnits(clearingPrice ?? 0n, auction.paymentDecimals)} {auction.paymentSymbol}.
          </p>
          <dl className="facts" style={{ marginTop: "1rem" }}>
            <div className="fact"><dt>Paid</dt>
              <dd><span className="price">
                <CountUp key={`paid-${motionKey}`} value={clearingPrice ?? 0n} animate={playing}
                  format={(v) => formatUnits(v, auction.paymentDecimals)} /></span>{" "}
                <span style={{ color: "var(--ink-2)" }}>{auction.paymentSymbol}</span></dd></div>
            <div className="fact"><dt>What #{auction.winnerIndex} bid</dt>
              <dd className="undisclosed">never disclosed</dd></div>
            <div className="fact"><dt>The other {Math.max(auction.bidCount - 1, 0)}</dt>
              <dd className="undisclosed">never disclosed</dd></div>
            <div className="fact"><dt>Lot</dt>
              <dd>{auction.lotClaimed ? "collected privately" : "awaiting collection"}</dd></div>
          </dl>
          <p className="note" style={{ marginTop: ".9rem" }}>
            There is nothing left to open. In a{" "}
            {auction.terms.kind === AuctionKind.Vickrey ? "second-price" : "first-price"} auction
            that is the complete disclosure.
          </p>
        </div>
      )}

      <div className={hasActions ? "cols" : ""} style={{ marginTop: "1rem" }}>
        <div className="panel">
          <p className="eyebrow">The ladder</p>
          <Ladder
            key={`detail-${motionKey}`}
            numLevels={auction.terms.numLevels}
            reservePrice={auction.terms.reservePrice}
            tick={auction.terms.tick}
            symbol={auction.paymentSymbol}
            decimals={auction.paymentDecimals}
            bidCount={auction.bidCount}
            status={auction.status}
            clearingLevel={settled ? auction.clearingLevel : null}
          />
        </div>

        <div className="stack">
          {hasActions ? (
            <>
              {auction.status === Status.Open && (
                <div className="panel">
                  <BidPanel auction={auction} connection={connection} onPlaced={onRefresh} />
                </div>
              )}
              <RevealPanel auction={auction} bids={mine} />
              <DisputePanel auction={auction} bids={mine} connection={connection} now={now} />
              <ClaimPanel auction={auction} bids={mine} connection={connection} />
            </>
          ) : (
            /* Not a wall. The evidence above rendered without a wallet and will keep
               rendering without one; this is the door to the half that moves money. */
            <div className="panel">
              <p className="eyebrow">To take part</p>
              <p style={{ marginTop: ".5rem" }}>
                {auction.status === Status.Open
                  ? "Everything above is on-chain and needs no wallet. Connect one to place a sealed bid."
                  : "Everything above is on-chain and needs no wallet. Connect one to claim, reveal or dispute if you took part."}
              </p>
              {/* Connects here rather than routing to the dashboard: the reason someone
                  is on this page is this auction, and sending them elsewhere loses it.
                  The panel to the left is unchanged by connecting — only this column
                  gains the actions. */}
              <button className="primary" style={{ marginTop: ".9rem" }}
                      onClick={() => void connect()} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
              <p className="note" style={{ marginTop: ".8rem" }}>
                Bid amounts stay sealed on either rail. Connecting reveals nothing about
                what you bid.
              </p>
            </div>
          )}
        </div>
      </div>

      <h2 className="section" data-reveal>The whole public record</h2>
      <div className="panel scroller">
        <p className="note" style={{ marginBottom: ".8rem" }}>
          This is everything the chain holds about the bid book. No address, no amount —
          two hash anchors and a claim handle per bid.
        </p>
        <table>
          <thead>
            <tr><th>#</th><th>Claim handle</th><th>Ascending</th><th>Descending</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {bids.map((b) => (
              <tr key={b.index}>
                <td className="mono">{b.index}</td>
                <td className="mono">0x{b.claimCommitment.toString(16).slice(0, 12)}…</td>
                <td className="mono">0x{b.upAnchor.toString(16).slice(0, 12)}…</td>
                <td className="mono">0x{b.downAnchor.toString(16).slice(0, 12)}…</td>
                <td className="undisclosed">not disclosed</td>
              </tr>
            ))}
            {bids.length === 0 && <tr><td colSpan={5} className="note">No bids yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* R2: on every auction detail page, not only the landing page. */}
      <div style={{ marginTop: "1.5rem" }}><TrustStatement /></div>
    </>
  );
}
