import { notFound } from "next/navigation";
import { readAuction, readBids, toWire } from "@/lib/chain";
import { config } from "@/lib/config";
import AuctionPageClient, { type WireBid } from "../../[id]/AuctionPageClient";

/**
 * An auction on the earlier (v1) contract, read-only. The record stays visible while its
 * escrow exists; the page offers no action, because this site no longer drives v1.
 */
export const revalidate = 60;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !config.legacyAuctionAddress) notFound();
  let auction = null;
  let bids: WireBid[] = [];
  try {
    auction = await readAuction(BigInt(id), 1);
    if (auction) {
      bids = (await readBids(BigInt(id), auction.bidCount, config.legacyAuctionAddress)).map((b) => ({
        index: b.index, claimCommitment: b.claimCommitment.toString(),
        upAnchor: b.upAnchor.toString(), downAnchor: b.downAnchor.toString(),
      }));
    }
  } catch {
    return <AuctionPageClient id={id} initial={null} initialBids={[]} version={1} />;
  }
  if (!auction) notFound();
  return <AuctionPageClient id={id} initial={toWire(auction)} initialBids={bids} version={1} />;
}
