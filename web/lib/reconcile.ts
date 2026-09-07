/**
 * What to do with a stored bid whose index no longer matches the chain.
 *
 * This is a pure function because the decision is the dangerous part, and until now it
 * lived inline in a React effect where it could not be tested. It destroyed six mainnet
 * claim secrets there.
 *
 * The search that produces `foundIndex` walks bid indices `0..chainCount-1`. So a `null`
 * from it carries two different meanings, and the whole defect was treating them as one:
 *
 *   - the range covered the stored index and the commitment was not in it — a real
 *     negative, the bid is not on chain;
 *   - the range stopped short of the stored index — no answer at all.
 *
 * The second is the ordinary state immediately after bidding. The stored index comes from
 * a polled `bidCount`, and the poll that set it is the same poll bounding the search, so
 * the new bid sits at exactly the index the search stops before. Dropping on that deleted
 * the secret for a bid that had just landed, on the dashboard the bidder opened to see it.
 *
 * Rule 11: absence of an answer is not a negative answer.
 */
export type ReconcileVerdict =
  | { do: "keep" }
  | { do: "reindex"; to: number }
  | { do: "drop" };

export interface ReconcileInput {
  /** The index the vault currently records — a guess taken from a poll. */
  storedIndex: number;
  /** `bid_count` read from the chain now, which is the bound the search actually used. */
  chainCount: number;
  /** Where the commitment was found in `0..chainCount-1`, or null if it was not there. */
  foundIndex: number | null;
}

export function reconcile(
  { storedIndex, chainCount, foundIndex }: ReconcileInput,
): ReconcileVerdict {
  if (foundIndex !== null) {
    return foundIndex === storedIndex ? { do: "keep" } : { do: "reindex", to: foundIndex };
  }
  /*
    Only a search that reached the stored index is evidence against the bid. Below that
    bound the answer is "not yet", and a bid that genuinely never landed simply keeps its
    entry until somebody else bids and the count passes it — at which point the same test
    becomes conclusive and it is cleaned up then. A stale row is cosmetic; a deleted seed
    forfeits the escrow behind it permanently.
  */
  return chainCount > storedIndex ? { do: "drop" } : { do: "keep" };
}
