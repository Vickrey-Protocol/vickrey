"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuctionKind, Status, type PublicBid } from "@vickrey/client";
import { readAuction, readAuctionCount, readBids, type AuctionView } from "@/lib/chain";
import { config, explorerContract, formatUnits, isDeployed, kindLabel } from "@/lib/config";
import { bidsFor, type StoredBid } from "@/lib/vault";
import { connect, type Connection } from "@/lib/wallet";
import { ClaimPanel, DisputePanel, PlaceBid, RevealPanel } from "@/components/Bidding";
import { FinalizePanel, SealPanel, SettlePanel } from "@/components/Auctioneer";

const TRUST_ASSURED =
  "the winner and the clearing price are established by hash-preimage proofs verified on-chain over a bid set the contract froze before any bid could be opened, so the auctioneer cannot alter the outcome, exclude a bid, or misreport the price without failing a proof or being slashed in the dispute window.";
const TRUST_NOT =
  "after sealing, the auctioneer learns every bid amount — it can never publish them, prove a false outcome, or spend anyone's funds, but it knows them; and the number of bids, their timing, and the uniform escrow amount are public on-chain.";

const statusName: Record<Status, string> = {
  [Status.None]: "unknown",
  [Status.Open]: "open",
  [Status.Sealed]: "sealed",
  [Status.Settled]: "settled",
  [Status.Finalized]: "final",
  [Status.Cancelled]: "cancelled",
};

const statusClass = (s: Status) =>
  s === Status.Open ? "open" : s === Status.Sealed ? "sealed" : "final";

export default function Home() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [auction, setAuction] = useState<AuctionView | null>(null);
  const [bids, setBids] = useState<PublicBid[]>([]);
  const [mine, setMine] = useState<StoredBid[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!isDeployed() || selected === null) return;
    try {
      const view = await readAuction(selected);
      setAuction(view);
      setBids(view ? await readBids(selected, view.bidCount) : []);
      setMine(bidsFor(selected));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [selected]);

  useEffect(() => {
    if (!isDeployed()) return;
    readAuctionCount()
      .then((n) => {
        setCount(n);
        if (n > 0 && selected === null) setSelected(BigInt(n - 1));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [selected]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 12000);
    return () => clearInterval(t);
  }, [refresh]);

  const clearingPrice = useMemo(() => {
    if (!auction) return null;
    if (auction.status !== Status.Settled && auction.status !== Status.Finalized) return null;
    return auction.terms.reservePrice + auction.terms.tick * BigInt(auction.clearingLevel);
  }, [auction]);

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
      <div className="spread">
        <div>
          <h1>Vickrey</h1>
          <p className="lede">
            Sealed-bid auctions where the losing bids are never published. The highest
            bidder wins and pays the second-highest bid — and the chain never learns what
            anyone bid, including the winner.
          </p>
        </div>
        <div className="row">
          {connection ? (
            <span className="pill final">
              {connection.address.slice(0, 6)}…{connection.address.slice(-4)}
              {connection.strk20 ? "" : " · no STRK20"}
            </span>
          ) : (
            <button className="primary" onClick={doConnect}>
              Connect wallet
            </button>
          )}
        </div>
      </div>
      {connectError && <p className="small err">{connectError}</p>}

      <div className="trust">
        <strong>What is assured:</strong> {TRUST_ASSURED} <strong>What is not:</strong>{" "}
        {TRUST_NOT}
      </div>

      {!isDeployed() && (
        <div className="banner">
          <strong>Not deployed.</strong> No contract address is configured, so there is
          nothing to read. Set <span className="mono">NEXT_PUBLIC_AUCTION_ADDRESS</span>,{" "}
          <span className="mono">NEXT_PUBLIC_ANONYMIZER_ADDRESS</span> and{" "}
          <span className="mono">NEXT_PUBLIC_RPC_URL</span>. See the repo README for the
          honest status of every piece.
        </div>
      )}

      {isDeployed() && (
        <>
          <div className="row" style={{ marginBottom: "1rem" }}>
            <label style={{ margin: 0 }}>Auction</label>
            <select
              value={selected?.toString() ?? ""}
              onChange={(e) => setSelected(BigInt(e.target.value))}
              style={{ width: "auto" }}
            >
              {Array.from({ length: count ?? 0 }, (_, i) => (
                <option key={i} value={i}>
                  #{i}
                </option>
              ))}
            </select>
            <button onClick={() => void refresh()}>Refresh</button>
            <a className="small mono" href={explorerContract(config.auctionAddress)}>
              contract
            </a>
          </div>

          {loadError && <p className="small err">{loadError}</p>}

          {auction && (
            <>
              <div className="panel">
                <div className="spread">
                  <h3 style={{ margin: 0 }}>
                    Auction #{auction.terms.auctionId.toString()} ·{" "}
                    {kindLabel(auction.terms.kind)}
                  </h3>
                  <span className={`pill ${statusClass(auction.status)}`}>
                    {statusName[auction.status]}
                  </span>
                </div>
                <div className="grid2" style={{ marginTop: "1rem" }}>
                  <div>
                    <label>Reserve</label>
                    <div className="mono">{formatUnits(auction.terms.reservePrice)}</div>
                  </div>
                  <div>
                    <label>Tick × levels</label>
                    <div className="mono">
                      {formatUnits(auction.terms.tick)} × {auction.terms.numLevels}
                    </div>
                  </div>
                  <div>
                    <label>Escrow (everyone)</label>
                    <div className="mono">{formatUnits(auction.collateral)}</div>
                  </div>
                  <div>
                    <label>Bids received</label>
                    <div className="mono">{auction.bidCount}</div>
                  </div>
                  <div>
                    <label>Bidding closes</label>
                    <div className="mono">
                      {new Date(auction.bidDeadline * 1000).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <label>Clearing price</label>
                    <div className="mono">
                      {clearingPrice === null ? "not yet proved" : formatUnits(clearingPrice)}
                    </div>
                  </div>
                </div>
              </div>

              {auction.status === Status.Open && (
                <PlaceBid auction={auction} connection={connection} onPlaced={() => void refresh()} />
              )}
              <RevealPanel auction={auction} bids={mine} />
              <SealPanel auction={auction} connection={connection} now={now} />
              <SettlePanel auction={auction} bids={bids} connection={connection} />
              <DisputePanel auction={auction} bids={mine} connection={connection} />
              <FinalizePanel auction={auction} connection={connection} now={now} />
              <ClaimPanel auction={auction} bids={mine} connection={connection} />

              <h2>What the chain knows</h2>
              <div className="panel scroll">
                <p className="small muted">
                  This is the whole public record of the bid book. No address, no amount
                  — two hash anchors and a claim handle per bid.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Claim commitment</th>
                      <th>Ascending anchor</th>
                      <th>Descending anchor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bids.map((b) => (
                      <tr key={b.index}>
                        <td className="mono">{b.index}</td>
                        <td className="mono">0x{b.claimCommitment.toString(16).slice(0, 14)}…</td>
                        <td className="mono">0x{b.upAnchor.toString(16).slice(0, 14)}…</td>
                        <td className="mono">0x{b.downAnchor.toString(16).slice(0, 14)}…</td>
                      </tr>
                    ))}
                    {bids.length === 0 && (
                      <tr>
                        <td colSpan={4} className="small muted">
                          No bids yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {auction.status >= Status.Settled && (
                <div className="panel">
                  <h3>After settlement</h3>
                  <p className="small">
                    The chain now knows the clearing price and which bid index won. It
                    still does not know what bid #{auction.winnerIndex} was, and it never
                    learned any of the others. In a{" "}
                    {auction.terms.kind === AuctionKind.Vickrey ? "second-price" : "first-price"}{" "}
                    auction that is the complete disclosure.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
