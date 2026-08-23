"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuctionKind, Status, type PublicBid } from "@vickrey/client";
import { readAuction, readAuctionCount, readBids, type AuctionView } from "@/lib/chain";
import {
  config, countdown, explorerContract, formatUnits, isDeployed, kindLabel, priceAt, shortAddr,
} from "@/lib/config";
import { bidsFor, type StoredBid } from "@/lib/vault";
import { connect, sameAddress, type Connection } from "@/lib/wallet";
import { Ladder } from "@/components/Ladder";
import { Hero, HowItWorks } from "@/components/Hero";
import { AuctionCard } from "@/components/AuctionCard";
import { BidPanel, ClaimPanel, DisputePanel, RevealPanel } from "@/components/Panels";
import { AuctioneerSection } from "@/components/AuctioneerSection";

/** R2: both sentences, verbatim, above the fold. Never shortened, never a tooltip. */
const TRUST_ASSURED =
  "the winner and the clearing price are established by hash-preimage proofs verified on-chain over a bid set the contract froze before any bid could be opened, so the auctioneer cannot alter the outcome, exclude a bid, or misreport the price without failing a proof or being slashed in the dispute window.";
const TRUST_NOT =
  "after sealing, the auctioneer learns every bid amount — it can never publish them, prove a false outcome, or spend anyone's funds, but it knows them; and the number of bids, their timing, and the uniform escrow amount are public on-chain.";

const STATUS: Record<Status, { label: string; cls: string }> = {
  [Status.None]:      { label: "unknown",   cls: "cancelled" },
  [Status.Open]:      { label: "bidding",   cls: "open" },
  [Status.Sealed]:    { label: "sealed",    cls: "sealed" },
  [Status.Settled]:   { label: "settled",   cls: "settled" },
  [Status.Finalized]: { label: "resolved",  cls: "resolved" },
  [Status.Cancelled]: { label: "cancelled", cls: "cancelled" },
};

export default function Home() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [all, setAll] = useState<AuctionView[]>([]);
  const [auction, setAuction] = useState<AuctionView | null>(null);
  const [bids, setBids] = useState<PublicBid[]>([]);
  const [mine, setMine] = useState<StoredBid[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Read every auction so the index always has something to show, and default to a
  // live one rather than merely the newest - a visitor should land on a sealed ladder
  // they can actually bid into.
  useEffect(() => {
    if (!isDeployed()) return;
    (async () => {
      try {
        const c = await readAuctionCount();
        setCount(c);
        const views = (await Promise.all(
          Array.from({ length: c }, (_, i) => readAuction(BigInt(i))),
        )).filter((v): v is AuctionView => v !== null);
        setAll(views);
        setSelected((s) => {
          if (s !== null) return s;
          const open = views.find((v) => v.status === Status.Open);
          return (open ?? views[views.length - 1])?.terms.auctionId ?? null;
        });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!isDeployed() || selected === null) return;
    try {
      const view = await readAuction(selected);
      setAuction(view);
      if (view) {
        setAll((prev) =>
          prev.map((a) => (a.terms.auctionId === view.terms.auctionId ? view : a)),
        );
      }
      setBids(view ? await readBids(selected, view.bidCount) : []);
      setMine(bidsFor(selected));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 12000);
    return () => clearInterval(t);
  }, [refresh]);

  const isAuctioneer = useMemo(
    () => !!(connection && auction && sameAddress(connection.address, auction.auctioneer)),
    [connection, auction],
  );

  const settled = auction && auction.status >= Status.Settled && auction.status !== Status.Cancelled;
  const clearingPrice = settled ? priceAt(auction!.terms, auction!.clearingLevel) : null;
  const resolved = auction?.status === Status.Finalized;

  /** Whether the right-hand column has anything to show for this viewer. */
  const hasActions = !!(
    auction && (auction.status === Status.Open || mine.length > 0)
  );

  async function doConnect() {
    setConnectError(null);
    try {
      setConnection(await connect());
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main>
      <header className="masthead">
        <div className="wordmark">
          Vickrey<span>.</span>
          <small>{config.label}</small>
        </div>
        <div className="row">
          {connection ? (
            <span className="pill sealed">
              {shortAddr(connection.address)}
              {connection.strk20 ? "" : " · no strk20"}
            </span>
          ) : (
            <button className="primary" onClick={doConnect}>Connect wallet</button>
          )}
        </div>
      </header>

      <Hero />

      <p className="trust">
        <b>What is assured:</b> {TRUST_ASSURED} <b>What is not:</b> {TRUST_NOT}
      </p>

      <HowItWorks />
      {connectError && <p className="err">{connectError}</p>}

      {!isDeployed() && (
        <div className="banner">
          <b>No contract configured for {config.label}.</b> Set{" "}
          <span className="mono">NEXT_PUBLIC_AUCTION_ADDRESS</span> and{" "}
          <span className="mono">NEXT_PUBLIC_ANONYMIZER_ADDRESS</span>. The repo README
          carries the honest status of every piece.
        </div>
      )}

      {isDeployed() && count === 0 && all.length === 0 && (
        <div className="banner">
          <b>No auctions listed yet</b> on {config.label}. Nothing has been created
          against this contract.
        </div>
      )}

      {all.length > 0 && (
        <>
          <div className="spread" style={{ marginBottom: ".9rem" }}>
            <h2 className="section" style={{ margin: 0 }}>Auctions</h2>
            <div className="row">
              <button onClick={() => void refresh()}>Refresh</button>
              <a className="note mono" href={explorerContract(config.auctionAddress)}
                 target="_blank" rel="noreferrer">contract ↗</a>
            </div>
          </div>
          <div className="cards" style={{ marginBottom: "1.5rem" }}>
            {all.map((a) => (
              <AuctionCard
                key={a.terms.auctionId.toString()}
                auction={a}
                now={now}
                selected={selected === a.terms.auctionId}
                onSelect={() => setSelected(a.terms.auctionId)}
              />
            ))}
          </div>
        </>
      )}

      {loadError && <p className="err">{loadError}</p>}

      {auction && (
        <>
          <div className="panel">
            <div className="spread">
              <h1 className="display" style={{ fontSize: "var(--step-2)" }}>
                Auction #{auction.terms.auctionId.toString()}
                <span className="note" style={{ marginLeft: ".6rem" }}>
                  {kindLabel(auction.terms.kind)}
                </span>
              </h1>
              <span className={`pill ${STATUS[auction.status].cls}`}>
                {STATUS[auction.status].label}
              </span>
            </div>

            <dl className="facts" style={{ marginTop: "1.1rem" }}>
              <div className="fact">
                <dt>Lot</dt>
                <dd>{formatUnits(auction.lotAmount)} {auction.lotSymbol}</dd>
              </div>
              <div className="fact">
                <dt>Reserve</dt>
                <dd>{formatUnits(auction.terms.reservePrice)} {auction.paymentSymbol}</dd>
              </div>
              <div className="fact">
                <dt>Escrow, everyone</dt>
                <dd>{formatUnits(auction.collateral)}</dd>
              </div>
              <div className="fact">
                <dt>Bids received</dt>
                <dd>{auction.bidCount}</dd>
              </div>
              <div className="fact">
                <dt>Clearing price</dt>
                {clearingPrice === null
                  ? <dd className="undisclosed">not yet proved</dd>
                  : <dd style={{ color: "var(--seal)", fontWeight: 600 }}>
                      {formatUnits(clearingPrice)} {auction.paymentSymbol}
                    </dd>}
              </div>
              <div className="fact">
                {/* R4: the window is always on screen and always counting. */}
                <dt>{auction.status === Status.Open ? "Bidding closes" : "Dispute window"}</dt>
                <dd>
                  {auction.status === Status.Open
                    ? (countdown(auction.bidDeadline, now) ?? "closed")
                    : auction.status === Status.Settled
                      ? <span className="countdown">{countdown(auction.disputeDeadline, now) ?? "closed"}</span>
                      : `${auction.disputeWindow}s`}
                </dd>
              </div>
            </dl>
          </div>

          {/* ── the resolved state: what the video ends on ── */}
          {resolved && (
            <div className="panel accent" style={{ marginTop: "1rem" }}>
              <div className="spread">
                <h2 className="display" style={{ fontSize: "var(--step-2)" }}>Resolved</h2>
                <span className="pill resolved">final</span>
              </div>
              <p className="note" style={{ marginTop: ".5rem" }}>
                The dispute window closed clean and the funds have moved. Bid #{auction.winnerIndex}{" "}
                won and paid {formatUnits(clearingPrice ?? 0n)} {auction.paymentSymbol}.
              </p>
              <dl className="facts" style={{ marginTop: "1rem" }}>
                <div className="fact">
                  <dt>Paid</dt>
                  <dd style={{ color: "var(--seal)", fontWeight: 600 }}>
                    {formatUnits(clearingPrice ?? 0n)} {auction.paymentSymbol}
                  </dd>
                </div>
                <div className="fact">
                  <dt>What #{auction.winnerIndex} bid</dt>
                  <dd className="undisclosed">never disclosed</dd>
                </div>
                <div className="fact">
                  <dt>The other {Math.max(auction.bidCount - 1, 0)}</dt>
                  <dd className="undisclosed">never disclosed</dd>
                </div>
                <div className="fact">
                  <dt>Lot</dt>
                  <dd>{auction.lotClaimed ? "collected privately" : "awaiting collection"}</dd>
                </div>
              </dl>
              <p className="note" style={{ marginTop: ".9rem" }}>
                There is nothing left to open. In a{" "}
                {auction.terms.kind === AuctionKind.Vickrey ? "second-price" : "first-price"}{" "}
                auction that is the complete disclosure.
              </p>
            </div>
          )}

          <div className={hasActions ? "cols" : ""} style={{ marginTop: "1rem" }}>
            <div className="panel">
              <p className="eyebrow">The ladder</p>
              <Ladder
                numLevels={auction.terms.numLevels}
                reservePrice={auction.terms.reservePrice}
                tick={auction.terms.tick}
                status={auction.status}
                clearingLevel={settled ? auction.clearingLevel : null}
              />
            </div>

            {hasActions && <div className="stack">
              {auction.status === Status.Open && (
                <div className="panel">
                  <BidPanel auction={auction} connection={connection} onPlaced={() => void refresh()} />
                </div>
              )}
              <RevealPanel auction={auction} bids={mine} />
              <DisputePanel auction={auction} bids={mine} connection={connection} now={now} />
              <ClaimPanel auction={auction} bids={mine} connection={connection} />
            </div>}
          </div>

          <AuctioneerSection
            auction={auction}
            bids={bids}
            connection={connection}
            now={now}
            isAuctioneer={isAuctioneer}
          />

          <h2 className="section">The whole public record</h2>
          <div className="panel scroller">
            <p className="note" style={{ marginBottom: ".8rem" }}>
              This is everything the chain holds about the bid book. No address, no
              amount — two hash anchors and a claim handle per bid.
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
                {bids.length === 0 && (
                  <tr><td colSpan={5} className="note">No bids yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <footer>
        <span>Vickrey · sealed-bid auctions on STRK20 · MIT</span>
        <span>{config.label}</span>
      </footer>
    </main>
  );
}
