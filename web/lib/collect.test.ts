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
import { collectOp, unredeemable } from "@/components/Panels";
import type { BidState } from "@/lib/chain";

const bid = (disposition: Disposition): BidState =>
  ({ index: 0, claimCommitment: 1n, escrow: 10n, disposition, claimed: false });

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

describe("a forfeit above the clearing price is not offered a redeem", () => {
  /* `redeem_forfeit` needs an at-or-below proof. Above the price there is none, so the
     button reverted every time, under a note that promised the escrow back. */
  it("is unredeemable above the clearing price on a finalized auction", () => {
    expect(unredeemable(bid(Disposition.Forfeit), Status.Finalized, 6, 4)).toBe(true);
  });

  it("is redeemable at or below it", () => {
    expect(unredeemable(bid(Disposition.Forfeit), Status.Finalized, 4, 4)).toBe(false);
    expect(unredeemable(bid(Disposition.Forfeit), Status.Finalized, 1, 4)).toBe(false);
  });

  it("does not apply to a cancelled auction, which refunds every forfeit", () => {
    expect(unredeemable(bid(Disposition.Forfeit), Status.Cancelled, 6, 4)).toBe(false);
  });

  it("does not apply to a bid that was not forfeited", () => {
    expect(unredeemable(bid(Disposition.AtOrAbove), Status.Finalized, 6, 4)).toBe(false);
  });
});
