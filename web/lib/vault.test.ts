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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VaultWriteError, allBids, dropBid, exportBids, identityOf, importBids, reindexBid,
  restoreEntries, saveBid, writeStore,
} from "@/lib/vault";

const KEY = "vickrey.bids.v1";
/* Distinct commitments: the store's identity is the commitment, so two fixtures that
   shared one would be "the same bid" and the second would replace the first. */
const bid = (level: number) => ({
  level, claimSecret: 11n, seed: 22n, claimCommitment: 1000n + BigInt(level), upAnchor: 44n, downAnchor: 55n,
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

describe("a store that accepts a write and keeps nothing", () => {
  /*
    `setItem` is not a signal. It throws on quota in some browsers and returns silently in
    others, and a partitioned store or a site-data block can accept the call and discard
    the value. The old `write` swallowed all of it, so the panel showed a claim secret it
    had never stored — and the bid went to the chain anyway, leaving escrow nobody can
    release. The write is now read back, and the failure reaches the caller.
  */
  afterEach(() => vi.restoreAllMocks());

  it("refuses to return a secret it did not manage to store", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {});
    expect(() => saveBid(8n, bid(1), 0)).toThrow(VaultWriteError);
  });

  it("says plainly that nothing was signed, because nothing was", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {});
    /* The bid path calls this before the wallet, so this message is always true — and a
       bidder reading "failed" after a wallet dialog would otherwise assume the reverse. */
    expect(() => saveBid(8n, bid(1), 0)).toThrow(/no funds moved/);
  });

  it("reports a throwing store the same way", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => saveBid(8n, bid(1), 0)).toThrow(VaultWriteError);
  });

  it("stores normally when the browser cooperates", () => {
    expect(() => saveBid(8n, bid(1), 0)).not.toThrow();
    expect(allBids()).toHaveLength(1);
  });
});

describe("restoring a backup", () => {
  it("merges rather than replacing, so a one-bid backup cannot wipe the rest", () => {
    /*
      The bid panel now hands out a single-bid file. Importing it used to write the parsed
      array wholesale, which would have destroyed every other secret in the browser —
      restoring one bid as a way to lose three.
    */
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 1);
    const oneBid = JSON.stringify([JSON.parse(exportBids())[1]]);
    window.localStorage.removeItem(KEY);
    saveBid(9n, bid(3), 0);

    importBids(oneBid);
    expect(allBids().map((b) => `${b.auctionId}:${b.index}`).sort())
      .toEqual(["8:1", "9:0"]);
  });

  it("lets the imported copy win a collision on the same bid", () => {
    saveBid(8n, bid(1), 0);
    const backup = exportBids().replace('"level": 1', '"level": 7');
    importBids(backup);
    expect(allBids()).toHaveLength(1);
    expect(allBids()[0]!.level).toBe(7);
  });

  it("still rejects something that is not a list of bids", () => {
    expect(() => importBids('{"nope":true}')).toThrow(/expected a list/);
  });
});

describe("a write cannot shrink the set without proof", () => {
  /*
    The reconciler that deleted six mainnet claim secrets was fixed, and a tab still
    running the old bundle kept deleting for hours afterwards, because the store trusted
    whatever it was handed. The invariant now lives in the store: no caller, present or
    future, can silently reduce the set. Removal must be named, per bid, with proof.
  */
  it("restores anything a bare write tried to drop", () => {
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 1);
    const [a] = allBids();
    writeStore([a!]);                       // a caller that "forgot" the second bid
    expect(allBids().map((b) => b.level).sort()).toEqual([1, 2]);
  });

  it("removes exactly what is named, when it is named", () => {
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 1);
    const [a, b] = allBids();
    writeStore([a!], { remove: [identityOf(b!)] });
    expect(allBids().map((b) => b.level)).toEqual([1]);
  });

  it("cannot be emptied by a write of []", () => {
    saveBid(8n, bid(1), 0);
    saveBid(9n, bid(2), 0);
    writeStore([]);
    expect(allBids()).toHaveLength(2);
  });

  it("dropBid carries its own proof and still works", () => {
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 1);
    dropBid(8n, 1);
    expect(allBids().map((b) => b.level)).toEqual([1]);
  });
});

describe("identity is the commitment, not the index", () => {
  it("a reindex is an edit, never a delete", () => {
    saveBid(8n, bid(1), 0);
    reindexBid(8n, 0, 5);
    expect(allBids()).toHaveLength(1);
    expect(allBids()[0]!.index).toBe(5);
  });

  it("a second attempt at the same index keeps the first — it may have landed", () => {
    saveBid(8n, bid(1), 0);
    saveBid(8n, bid(2), 0);
    expect(allBids()).toHaveLength(2);
  });

  it("restoreEntries adds only what is missing", () => {
    saveBid(8n, bid(1), 0);
    const lost = { auctionId: "8", index: 1, level: 2, claimSecret: "1", seed: "2",
      claimCommitment: "1002", upAnchor: "4", downAnchor: "5" };
    expect(restoreEntries([allBids()[0]!, lost])).toBe(1);
    expect(allBids()).toHaveLength(2);
  });
});
