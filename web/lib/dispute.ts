/**
 * Who may be offered "Void the settlement".
 *
 * The contract's `dispute` checks only that a bid's up-chain reaches one level above the
 * clearing price. It never asks how the bid was settled, so on the deployed contracts
 * the Vickrey winner — who nearly always sits strictly above the price they pay — can
 * void their own win, and the screen used to offer them the button to do it. It offered
 * it to every stored bid above the line, whatever the auctioneer had recorded for it.
 *
 * The only bid a dispute exists for is one the auctioneer left out: marked `Forfeit`,
 * yet above the price the settlement claims. Everything else is either the winner or a
 * bid the settlement already accounted for, and offering a dispute to either is offering
 * a way to break a correct outcome.
 *
 * The disposition comes from the chain, never from this browser. A bid whose state could
 * not be read is not eligible — the caller says so separately rather than guessing.
 */
import { Disposition, NO_WINNER, Status } from "@vickrey/client";
import type { AuctionView, BidState } from "@/lib/chain";
import type { StoredBid } from "@/lib/vault";

export function canDispute(
  auction: Pick<AuctionView, "status" | "clearingLevel" | "winnerIndex">,
  bid: Pick<StoredBid, "index" | "level">,
  state: Pick<BidState, "disposition"> | null | undefined,
): boolean {
  if (auction.status !== Status.Settled) return false;
  if (bid.index === auction.winnerIndex) return false;
  /* Leaving the bid out must have changed the result: it beat the clearing price, or the
     settlement claimed no bid could be settled at all. v2's contract asks the same; it
     also asks that the bid's reveal was posted in time, which the panel checks. */
  if (bid.level <= auction.clearingLevel && auction.winnerIndex !== NO_WINNER) return false;
  return state?.disposition === Disposition.Forfeit;
}

/**
 * Bids that would qualify on level and index but whose disposition is not known yet.
 * Shown as "could not read", never as a dispute: the chain decides, not this browser.
 */
export function unreadCandidates(
  auction: Pick<AuctionView, "status" | "clearingLevel" | "winnerIndex">,
  bids: Pick<StoredBid, "index" | "level">[],
  states: Record<number, BidState | null | undefined>,
): number[] {
  if (auction.status !== Status.Settled) return [];
  return bids
    .filter((b) => b.index !== auction.winnerIndex
      && (b.level > auction.clearingLevel || auction.winnerIndex === NO_WINNER))
    .filter((b) => states[b.index] === null)
    .map((b) => b.index);
}
