"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicBid } from "@vickrey/client";
import { fromWire, readAuction, readBids, type AuctionView, type WireAuction } from "@/lib/chain";
import { config } from "@/lib/config";
import { bidsFor, type StoredBid } from "@/lib/vault";
import { PublicShell } from "@/components/PublicShell";
import { AuctionDetail } from "@/components/AuctionDetail";
import { useNow, useWallet } from "@/components/WalletProvider";

export interface WireBid {
  index: number; claimCommitment: string; upAnchor: string; downAnchor: string;
}
const unwire = (b: WireBid): PublicBid => ({
  index: b.index,
  claimCommitment: BigInt(b.claimCommitment),
  upAnchor: BigInt(b.upAnchor),
  downAnchor: BigInt(b.downAnchor),
});

export default function AuctionPageClient({
  id, initial, initialBids,
}: { id: string; initial: WireAuction | null; initialBids: WireBid[] }) {
  const { connection } = useWallet();
  const now = useNow();
  const [auction, setAuction] = useState<AuctionView | null>(initial ? fromWire(initial) : null);
  const [bids, setBids] = useState<PublicBid[]>(initialBids.map(unwire));
  const [mine, setMine] = useState<StoredBid[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [missing, setMissing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const a = await readAuction(BigInt(id));
      if (!a) return;
      setAuction(a);
      setBids(await readBids(BigInt(id), a.bidCount));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("AUCTION_NOT_FOUND")) setMissing(true);
      else setError(msg);
    }
  }, [id]);

  // State moves; the page must not sit on a snapshot from build time.
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 15_000); return () => clearInterval(t); }, [refresh]);
  // Claim secrets are per-browser, so this can only run client-side.
  useEffect(() => { setMine(bidsFor(BigInt(id))); }, [id, auction?.bidCount]);

  return (
    <PublicShell>
      <p className="note" style={{ marginBottom: ".8rem" }}>
        <Link href="/auctions">← All auctions</Link>
      </p>
      {auction ? (
        <AuctionDetail
          auction={auction} bids={bids} mine={mine}
          connection={connection} now={now} onRefresh={() => void refresh()}
        />
      ) : (
        <div className="panel">
          <h1 className="display" style={{ fontSize: "var(--step-2)" }}>Auction #{id}</h1>
          {missing ? (
            <>
              <p style={{ marginTop: ".6rem" }}>
                <b>No auction #{id} exists</b> on {config.label}.
              </p>
              <p className="note" style={{ marginTop: ".4rem" }}>
                Auctions are numbered from 0 in the order they were created.{" "}
                <Link href="/auctions">See the ones that do exist</Link>.
              </p>
            </>
          ) : (
            <p className="note" style={{ marginTop: ".6rem" }}>
              {error
                ? `Could not read ${config.label}: ${error}`
                : `Reading auction #${id} from ${config.label}…`}
            </p>
          )}
        </div>
      )}
    </PublicShell>
  );
}
