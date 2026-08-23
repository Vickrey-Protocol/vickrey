/**
 * Presentation constants shared by the public routes and the dashboard.
 *
 * These live here rather than in a component because the landing page, the public
 * auction page and the dashboard all render the same status vocabulary and the same
 * trust statement, and three copies would drift. R2 in particular is a promise about
 * exact wording — it cannot be paraphrased by whichever route happens to render it.
 */
import { Status } from "@vickrey/client";

/** R2: both sentences, verbatim. Never shortened, never a tooltip. */
export const TRUST_ASSURED =
  "the winner and the clearing price are established by hash-preimage proofs verified on-chain over a bid set the contract froze before any bid could be opened, so the auctioneer cannot alter the outcome, exclude a bid, or misreport the price without failing a proof or being slashed in the dispute window.";
export const TRUST_NOT =
  "after sealing, the auctioneer learns every bid amount — it can never publish them, prove a false outcome, or spend anyone's funds, but it knows them; and the number of bids, their timing, and the uniform escrow amount are public on-chain.";

export const STATUS: Record<Status, { label: string; cls: string }> = {
  [Status.None]:      { label: "unknown",   cls: "cancelled" },
  [Status.Open]:      { label: "bidding",   cls: "open" },
  [Status.Sealed]:    { label: "sealed",    cls: "sealed" },
  [Status.Settled]:   { label: "settled",   cls: "settled" },
  [Status.Finalized]: { label: "resolved",  cls: "resolved" },
  [Status.Cancelled]: { label: "cancelled", cls: "cancelled" },
};
