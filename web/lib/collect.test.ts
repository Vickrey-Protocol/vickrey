/**
 * Which collect call a bid can actually make.
 *
 * The screen used to offer "Refund or surplus" and "Redeem forfeit" side by side, so one
 * of them always reverted — on the screen whose entire job is releasing the user's
 * escrow, where a revert reads as "the money is gone".
 *
 * The rules are the contract's, and they are asymmetric in a way that is easy to get
 * backwards: a *cancelled* auction refunds everyone including forfeited bids, because no
 * settlement ever established who forfeited. Encoding that here means a future edit has
 * to break a test rather than just a user's afternoon.
 */
import { describe, expect, it } from "vitest";
import { AuctionOperation, Disposition, Status } from "@vickrey/client";
import { collectOp } from "@/components/Panels";
import type { BidState } from "@/lib/chain";

const bid = (disposition: Disposition): BidState =>
  ({ index: 0, escrow: 10n, disposition, claimed: false });

describe("collect routes to the call that will succeed", () => {
  it("sends a forfeited bid on a finalized auction to redeem_forfeit", () => {
    expect(collectOp(bid(Disposition.Forfeit), Status.Finalized))
      .toBe(AuctionOperation.RedeemForfeit);
  });

  it("sends an ordinary loser to claim_refund", () => {
    expect(collectOp(bid(Disposition.AtOrBelow), Status.Finalized))
      .toBe(AuctionOperation.ClaimRefund);
  });

  it("sends the winner to claim_refund for their surplus", () => {
    expect(collectOp(bid(Disposition.Exactly), Status.Finalized))
      .toBe(AuctionOperation.ClaimRefund);
  });

  it("sends a forfeited bid on a CANCELLED auction to claim_refund, not redeem", () => {
    /* `claim_refund` only refuses a forfeit when the auction is Finalized; a cancelled
       one refunds everybody. `redeem_forfeit` requires Finalized outright, so routing a
       cancelled forfeit there would revert on the status check. */
    expect(collectOp(bid(Disposition.Forfeit), Status.Cancelled))
      .toBe(AuctionOperation.ClaimRefund);
  });
});
