/**
 * The bug that deleted six mainnet claim secrets.
 *
 * A stored bid's index is a guess taken from a polled `bidCount`. The dashboard's
 * reconciler checked that guess against the chain by searching bid indices `0..count-1`
 * for the commitment — bounding the search with the *same polled count*. Just after a
 * bid, that poll is short by exactly the bid that was placed, so the search stopped one
 * index before the bid it was looking for, returned "not found", and the reconciler
 * deleted the secret.
 *
 * The bidder saw it happen by opening the dashboard to look at the bid they had made.
 */
import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/reconcile";

describe("the stale-count race", () => {
  it("keeps a bid the search could not have reached", () => {
    /*
      Three bids existed when the poll ran, so the new bid was stored at index 3 and the
      chain now holds four. Read back with the stale count of 3, the search covers 0..2 —
      it never looks at index 3. That `null` is not evidence.
    */
    expect(reconcile({ storedIndex: 3, chainCount: 3, foundIndex: null }))
      .toEqual({ do: "keep" });
  });

  it("keeps it even when the chain reports no bids at all", () => {
    /* A zero bound searches nothing, so it cannot answer anything. */
    expect(reconcile({ storedIndex: 0, chainCount: 0, foundIndex: null }))
      .toEqual({ do: "keep" });
  });

  it("drops only when the search actually covered the stored index", () => {
    /* Four bids on chain, none carrying this commitment: a real negative. */
    expect(reconcile({ storedIndex: 3, chainCount: 4, foundIndex: null }))
      .toEqual({ do: "drop" });
  });
});

describe("correcting an index the chain moved", () => {
  it("reindexes to where the commitment actually is", () => {
    /* Someone bid between the poll and the send, so our guess of 3 landed at 5. */
    expect(reconcile({ storedIndex: 3, chainCount: 6, foundIndex: 5 }))
      .toEqual({ do: "reindex", to: 5 });
  });

  it("leaves a bid already at the right index alone", () => {
    expect(reconcile({ storedIndex: 5, chainCount: 6, foundIndex: 5 }))
      .toEqual({ do: "keep" });
  });

  it("never drops a bid it found, whatever the bound says", () => {
    const found = reconcile({ storedIndex: 9, chainCount: 2, foundIndex: 1 });
    expect(found.do).not.toBe("drop");
  });
});
