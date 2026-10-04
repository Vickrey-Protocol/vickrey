"use client";


import { AuctionKind, Status, type PublicBid } from "@vickrey/client";
import { readLotCollection, readTerms, type AuctionView, type Terms } from "@/lib/chain";
import { lotText as lotLine } from "@/lib/lot";
import { DeliveryOutcome, LotKind } from "@/lib/v2";
import { parseTerms } from "@/lib/terms";
import { lotLabel, type LotRail } from "@/lib/lotRail";
import { useEffect, useState } from "react";
import { countdown, explorerContract, formatUnits, kindLabel, priceAt, utcDate } from "@/lib/config";
import type { StoredBid } from "@/lib/vault";
import type { Connection } from "@/lib/wallet";
import { STATUS } from "@/lib/ui";
import { NftImage } from "@/components/NftImage";
import { useWallet } from "@/components/WalletProvider";
import { Ladder } from "@/components/Ladder";
import { CountUp } from "@/components/CountUp";
import { TrustStatement } from "@/components/TrustStatement";
import {
  AbandonPanel, BidPanel, CollectPanel, DeliveryPanel, DisputePanel, RevealPanel, SellerPanel,
} from "@/components/Panels";
import { AuctioneerSection } from "@/components/AuctioneerSection";
import { sameAddress } from "@/lib/wallet";

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
  const hasActions = Boolean(connection) && auction.version === 2;

  /* How the lot actually left: the pool or a public address. Read from the chain, never
     assumed — the card used to say "privately" whichever rail was used. */
  const [lotHow, setLotHow] = useState<LotRail | null | undefined>(undefined);
  const lotClaimed = resolved && auction.lotClaimed;
  useEffect(() => {
    if (!lotClaimed) return;
    let live = true;
    readLotCollection(auction.terms.auctionId)
      .then((r) => { if (live) setLotHow(r); })
      .catch(() => { if (live) setLotHow(null); });
    return () => { live = false; };
  }, [lotClaimed, auction.terms.auctionId]);

  /* Off-chain terms: read from the listing's event and checked against the stored hash. */
  const offchain = auction.lotKind === LotKind.OffChain;
  const [terms, setTerms] = useState<Terms | null | undefined>(undefined);
  useEffect(() => {
    if (!offchain) return;
    let live = true;
    readTerms(auction).then((t) => { if (live) setTerms(t); }).catch(() => { if (live) setTerms(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offchain, auction.terms.auctionId, auction.contract]);

  const lotText = offchain ? "Off-chain item · terms below" : lotLine(auction);
  const readOnly = auction.version === 1;
  const days = Math.round(auction.deliveryWindow / 86400);
  const windowWords = auction.deliveryWindow >= 86400
    ? `${days} day${days === 1 ? "" : "s"}`
    : `${Math.round(auction.deliveryWindow / 60)} minutes`;
  /* Once delivery is decided or its deadline has passed, "you can reject before" a past
     date would be wrong; the warning gives way to what happened. */
  const rejectOpen = !auction.delivery || auction.delivery.outcome === DeliveryOutcome.None
    || (auction.delivery.outcome === DeliveryOutcome.Pending && now < auction.delivery.deadline);
  const deadlineLine = auction.delivery
    ? utcDate(auction.delivery.deadline)
    : `the delivery deadline, ${windowWords} after the auction ends`;

  return (
    <>
      {readOnly && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <p style={{ margin: 0 }}><b>This auction is on the earlier contract (v1).</b> It’s shown
            read-only: nothing here can be bid on or collected from this site.</p>
        </div>
      )}
      <div className="panel">
        <div className="spread">
          <h1 className="display" style={{ fontSize: "var(--step-2)" }}>
            Auction #{auction.terms.auctionId.toString()}
            <span className="note" style={{ marginLeft: ".6rem" }}>{kindLabel(auction.terms.kind)}</span>
          </h1>
          <span className="row" style={{ gap: ".5rem" }}>
            {offchain && <span className="lot-chip trust">Off-chain · you trust the seller</span>}
            {auction.lotKind === LotKind.Erc721 && <span className="lot-chip">NFT</span>}
            <span className={`pill ${STATUS[auction.status].cls}`}>{STATUS[auction.status].label}</span>
          </span>
        </div>

        <dl className="facts" style={{ marginTop: "1.1rem" }}>
          <div className="fact"><dt>Lot</dt>
            <dd>{lotText}
              {auction.lotKind === LotKind.Erc721 && (
                <a className="note" style={{ display: "block" }} href={explorerContract(auction.lotToken)}
                   target="_blank" rel="noreferrer">the collection on the explorer</a>
              )}</dd></div>
          {offchain && (
            <>
              <div className="fact"><dt>Seller bond</dt>
                <dd>{formatUnits(auction.sellerBond, auction.paymentDecimals)} {auction.paymentSymbol}</dd></div>
              <div className="fact"><dt>Delivery window</dt><dd>{windowWords}</dd></div>
            </>
          )}
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
        {auction.lotKind === LotKind.Erc721 && (
          <div className="row" style={{ marginTop: "1rem", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
            <NftImage collection={auction.lotToken} tokenId={auction.lotTokenId} />
            <p className="note" style={{ margin: 0, maxWidth: "32ch" }}>
              Held by the contract until the auction ends. The winner names a public address to receive it.
            </p>
          </div>
        )}
      </div>

      {offchain && !rejectOpen && auction.delivery && (
        <p className="note" style={{ marginTop: "1rem" }}>
          The contract did not hold this item.{" "}
          {auction.delivery.outcome === DeliveryOutcome.Confirmed ? "The buyer confirmed delivery."
            : auction.delivery.outcome === DeliveryOutcome.Rejected ? "The buyer rejected delivery."
              : `The window to reject delivery closed ${utcDate(auction.delivery.deadline)} without a rejection.`}
        </p>
      )}
      {offchain && rejectOpen && (
        <section aria-label="Before you bid" className="warnbox trust-warning" style={{ marginTop: "1rem" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
          <p style={{ margin: 0 }}>
            <b>The contract does not hold this item.</b> You are trusting the seller to deliver
            it. If they don’t, you can reject before <b>{deadlineLine}</b>. The seller then gets
            nothing and loses their{" "}
            <b>{formatUnits(auction.sellerBond, auction.paymentDecimals)} {auction.paymentSymbol}</b>{" "}
            bond, but <b>your payment does not come back — it is destroyed.</b>
          </p>
        </section>
      )}

      {offchain && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <div className="spread">
            <h2 style={{ fontSize: "var(--step-1)" }}>Terms</h2>
            {terms && (terms.verified
              ? <span className="ok">Matches the hash on chain</span>
              : <span className="err">Does not match the hash on chain — don’t rely on this text</span>)}
          </div>
          {terms === undefined && <p className="note">Reading the terms from the chain…</p>}
          {terms === null && <p className="note">Couldn’t read the terms from the chain. Reload to try again.</p>}
          {terms && (
            <dl className="terms-rows">
              {parseTerms(terms.text).map((row, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <dt>{row.label}</dt><dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="note mono" style={{ marginTop: ".6rem" }}>terms_hash 0x{auction.termsHash.toString(16).slice(0, 6)}…{auction.termsHash.toString(16).slice(-4)}</p>
        </div>
      )}

      {resolved && (
        <div className="panel accent" style={{ marginTop: "1rem" }}>
          <div className="spread">
            <h2 className="display" style={{ fontSize: "var(--step-2)" }}>Resolved</h2>
            <span className="pill resolved">final</span>
          </div>
          <p className="note" style={{ marginTop: ".5rem" }}>
            The dispute window closed clean. Bid #{auction.winnerIndex}{" "}
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
              <dd>{offchain
                ? (!auction.lotClaimed ? "awaiting the winner"
                  : auction.delivery?.outcome === DeliveryOutcome.Confirmed ? "delivered — the buyer confirmed"
                    : auction.delivery?.outcome === DeliveryOutcome.Rejected ? "rejected by the buyer"
                      : auction.delivery?.outcome === DeliveryOutcome.Released ? "the seller was paid"
                        : "with the seller to deliver")
                : auction.lotKind === LotKind.Erc721
                  ? (auction.lotClaimed ? "collected to a public address" : "awaiting collection")
                  : lotLabel(auction.lotClaimed, lotHow)}</dd></div>
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
                  <BidPanel auction={auction} connection={connection} now={now} onPlaced={onRefresh} />
                </div>
              )}
              {/*
                Seal and finalize live here as well as on the manage page, because both
                are permissionless and this is the page anyone actually lands on. Their
                absence is what sent a seal attempt through the bid form: the auction page
                offered no seal control at all, so the only live button was "Place sealed
                bid" — which the chain then refused.

                `isAuctioneer` is passed honestly. It only governs `settle`, which is the
                one step with a caller check, and the section hides that rather than
                hiding itself.
              */}
              <AuctioneerSection
                auction={auction} connection={connection} bids={bids} now={now}
                isAuctioneer={!!connection && sameAddress(connection.address, auction.auctioneer)}
              />
              <AbandonPanel auction={auction} connection={connection} now={now} onDone={onRefresh} />
              <RevealPanel auction={auction} bids={mine} connection={connection} now={now} />
              <DisputePanel auction={auction} bids={mine} connection={connection} now={now} />
              <CollectPanel auction={auction} bids={mine} connection={connection} />
              <DeliveryPanel auction={auction} connection={connection} now={now} mine={mine} onDone={onRefresh} />
              <SellerPanel auction={auction} connection={connection} onDone={onRefresh} />
            </>
          ) : readOnly ? null : (
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
      <div style={{ marginTop: "1.5rem" }}><TrustStatement version={auction.version} /></div>
    </>
  );
}
