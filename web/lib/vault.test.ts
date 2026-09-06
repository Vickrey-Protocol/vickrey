/**
 * A stored bid must point at the bid the chain actually has.
 *
 * Two ways it stopped doing so. A reverted transaction left its entry behind, because the
 * write happens before the send and nothing undid it — which is where a claim row for
 * index 3 came from in an auction with three bids. And the index was read from a polled
 * `bidCount`, so a bid arriving in the gap between the poll and the send shifted it.
 *
 * Neither could take money: `claim_refund` asserts `bid_index < bid_count`, and a
 * mismatched index fails the commitment check. What they could do is look exactly like a
 * defect during a run where every figure is being checked by eye.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { allBids, dropBid, reindexBid, saveBid } from "@/lib/vault";

const KEY = "vickrey.bids.v1";
const bid = (level: number) => ({
  level, claimSecret: 11n, seed: 22n, claimCommitment: 33n, upAnchor: 44n, downAnchor: 55n,
});

beforeEach(() => window.localStorage.removeItem(KEY));

describe("rolling back a bid that never landed", () => {
  it("removes exactly the entry, leaving the others", () => {
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 1);
    saveBid(8n, bid(3), 2);
    dropBid(8n, 1);
    expect(allBids().map((b) => b.index)).toEqual([0, 2]);
  });

  it("does not touch an identical index in another auction", () => {
    /* Indices repeat across auctions, so a drop keyed on index alone would take both. */
    saveBid(8n, bid(1), 0);
    saveBid(9n, bid(1), 0);
    dropBid(8n, 0);
    expect(allBids().map((b) => b.auctionId)).toEqual(["9"]);
  });
});

describe("correcting an index the chain assigned differently", () => {
  it("renumbers in place, keeping the secret", () => {
    saveBid(8n, bid(4), 3);
    reindexBid(8n, 3, 1);
    const [only] = allBids();
    expect(only!.index).toBe(1);
    expect(only!.claimSecret).toBe("11");
    expect(only!.level).toBe(4);
  });

  it("is a no-op when the guess was right", () => {
    saveBid(8n, bid(4), 2);
    reindexBid(8n, 2, 2);
    expect(allBids()).toHaveLength(1);
    expect(allBids()[0]!.index).toBe(2);
  });

  it("leaves other auctions alone", () => {
    saveBid(8n, bid(1), 0);
    saveBid(9n, bid(1), 0);
    reindexBid(8n, 0, 5);
    expect(allBids().map((b) => `${b.auctionId}:${b.index}`).sort()).toEqual(["8:5", "9:0"]);
  });
});
