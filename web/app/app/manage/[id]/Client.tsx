"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicBid } from "@vickrey/client";
import { readAuction, readBids, type AuctionView } from "@/lib/chain";
import { formatUnits } from "@/lib/config";
import { bidsFor, type StoredBid } from "@/lib/vault";
import { sameAddress } from "@/lib/wallet";
import { DashShell } from "@/components/DashShell";
import { useDashData } from "@/components/DashData";
import { AuctionDetail } from "@/components/AuctionDetail";
import { AuctioneerSection } from "@/components/AuctioneerSection";
import { useNow, useWallet } from "@/components/WalletProvider";

/**
 * The auctioneer console.
 *
 * It renders the same `AuctionDetail` everyone else sees and adds the operator controls
 * beneath it, rather than being a separate screen with its own idea of the auction —
 * an auctioneer acting on a different view of the state from the bidders is how a wrong
 * settlement gets submitted.
 *
 * It never renders a bid amount. The auctioneer knows them after sealing; the interface
 * must not draw them, or a screenshot of this console becomes the disclosure the whole
 * protocol exists to avoid.
 */
export default function Client({ id }: { id: string }) {
  const { connection } = useWallet();
  const now = useNow();
  const d = useDashData();
  const [auction, setAuction] = useState<AuctionView | null>(null);
  const [bids, setBids] = useState<PublicBid[]>([]);
  const [mine, setMine] = useState<StoredBid[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const a = await readAuction(BigInt(id));
      setAuction(a);
      setBids(a ? await readBids(BigInt(id), a.bidCount) : []);
      setMine(bidsFor(BigInt(id)));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(t);
  }, [refresh]);

  const isAuctioneer = !!(connection && auction && sameAddress(connection.address, auction.auctioneer));

  return (
    <DashShell title={`Auction #${id}`} actionsDue={d.actions.length} ownsAuctions={d.ownsAuctions}>
      <p className="note" style={{ marginBottom: ".8rem" }}>
        <Link href="/app/manage">← All your auctions</Link>
      </p>

      {!auction ? (
        <div className="panel">
          <p className="note">
            {error ? `Could not read auction #${id}: ${error}` : `Reading auction #${id}…`}
          </p>
        </div>
      ) : !isAuctioneer ? (
        <div className="banner">
          <b>You are not the auctioneer for #{id}.</b> Only{" "}
          <span className="mono">{auction.auctioneer.slice(0, 10)}…</span> can seal, settle
          or finalize it. <Link href={`/auction/${id}`}>Open the public view</Link>.
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Your bond</p>
            <p style={{ marginTop: ".4rem" }}>
              <b>{formatUnits(auction.bond)} {auction.paymentSymbol}</b> is staked on this
              settlement being correct.
            </p>
            <p className="note" style={{ marginTop: ".4rem" }}>
              If anyone proves during the dispute window that a bid above the clearing
              price was excluded, the bond is slashed to them. Settling honestly is the
              only way to get it back.
            </p>
          </div>

          <AuctioneerSection
            auction={auction} bids={bids} connection={connection}
            now={now} isAuctioneer={isAuctioneer}
          />

          <div style={{ marginTop: "1.6rem" }}>
            <AuctionDetail
              auction={auction} bids={bids} mine={mine}
              connection={connection} now={now} onRefresh={() => void refresh()}
            />
          </div>
        </>
      )}
    </DashShell>
  );
}
