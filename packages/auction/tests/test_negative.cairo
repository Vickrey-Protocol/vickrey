//! Negative tests, written before the happy paths.
//!
//! Each one is an attack this design has to refuse. If any of these starts passing,
//! a security property has been lost.

use auction::interface::ISealedBidAuctionDispatcherTrait;
use auction::ladder;
use auction::types::{AuctionKind, DispositionProof, NO_WINNER, ProofKind, Status};
use snforge_std::{start_cheat_block_timestamp_global, start_cheat_caller_address};
use auction::erc20::IERC20DispatcherTrait;
use core::num::traits::Zero;
use super::common::{
    BOND, CAP, DEADLINE, LOT, LEVELS, WINDOW, finalize, payout, place, pool, proof_above, proof_below,
    balance, proof_exactly, proof_forfeit, seal, seller, settle, setup, setup_with,
    setup_with_auctioneer,
};

// ---- bidding window ------------------------------------------------------------

#[test]
#[should_panic(expected: 'BIDDING_CLOSED')]
fn bid_after_deadline_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    start_cheat_block_timestamp_global(DEADLINE);
    place(env, 'A', 'SA', 5);
}

#[test]
#[should_panic(expected: 'BIDDING_STILL_OPEN')]
fn seal_before_deadline_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    env.auction.seal(env.id);
}

#[test]
#[should_panic(expected: 'AUCTION_NOT_SEALED')]
fn settle_before_seal_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
}

#[test]
#[should_panic(expected: 'AUCTION_NOT_OPEN')]
fn bidding_after_seal_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    seal(env);
    place(env, 'B', 'SB', 6);
}

/// Copying another bid's anchors would create a bid nobody can disposition, stalling
/// settlement. It is refused at the door.
#[test]
#[should_panic(expected: 'DUPLICATE_BID_ANCHORS')]
fn replaying_another_bids_anchors_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    let bid = env.auction.get_bid(env.id, a.index);

    let collateral = env.auction.collateral(env.id);
    super::common::fund(env.pay, pool(), collateral);
    super::common::approve_as(env.pay, pool(), env.auction.contract_address, collateral);
    start_cheat_caller_address(env.auction.contract_address, pool());
    env.auction.place_bid(env.id, ladder::claim_commitment_of('M'), bid.up_anchor, bid.down_anchor);
}

// ---- who may settle ------------------------------------------------------------

#[test]
#[should_panic(expected: 'CALLER_NOT_AUCTIONEER')]
fn only_the_auctioneer_may_settle() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    seal(env);
    start_cheat_caller_address(env.auction.contract_address, seller());
    env.auction.settle(env.id, 0, a.index, array![proof_above(env, a, 0)].span());
}

/// Property 3, the blunt version: a settlement that simply leaves a bid out.
#[test]
#[should_panic(expected: 'PROOF_COUNT_MISMATCH')]
fn a_settlement_that_omits_a_bid_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    place(env, 'B', 'SB', 7);
    seal(env);
    // Two bids arrived; the auctioneer offers proofs for one.
    settle(env, 7, a.index, array![proof_above(env, a, 7)]);
}

// ---- forging the clearing price ------------------------------------------------

/// Overstating the price means claiming the runner-up bid higher than they did.
/// That is a preimage forgery on the ascending chain.
#[test]
#[should_panic(expected: 'PROOF_AT_OR_ABOVE_FAILED')]
fn the_auctioneer_cannot_overstate_the_clearing_price() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);

    // True second price is level 7. The auctioneer wants 9.
    let forged = DispositionProof {
        kind: ProofKind::Exactly,
        witness_up: ladder::up_seed('SB'),
        witness_down: ladder::witness_at_or_below(env.id, b.commitment, 'SB', 7, 9),
    };
    settle(env, 9, a.index, array![proof_above(env, a, 9), forged]);
}

/// Understating it means claiming the runner-up bid lower than they did — a forgery
/// on the descending chain. This is the "drop a rival's high bid" attack in its
/// subtlest form.
#[test]
#[should_panic(expected: 'PROOF_AT_OR_BELOW_FAILED')]
fn the_auctioneer_cannot_understate_the_clearing_price() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    place(env, 'B', 'SB', 7);
    seal(env);

    // Push the runner-up down to level 3 so the winner pays less.
    let forged = DispositionProof {
        kind: ProofKind::AtOrBelow, witness_up: 0, witness_down: ladder::down_seed('SB'),
    };
    settle(env, 3, a.index, array![proof_above(env, a, 3), forged]);
}

/// Only the winner may sit above the clearing level unpinned. Otherwise a second bid
/// above it would leave the second price undetermined.
#[test]
#[should_panic(expected: 'ONLY_WINNER_MAY_BE_ABOVE')]
fn a_non_winner_cannot_be_left_unpinned_above_the_price() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let rival = place(env, 'B', 'SB', 11);
    seal(env);
    settle(env, 5, a.index, array![proof_above(env, a, 5), proof_above(env, rival, 5)]);
}

#[test]
#[should_panic(expected: 'WINNER_CANNOT_FORFEIT')]
fn the_winner_cannot_be_forfeited() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_forfeit(), proof_exactly(env, b, 7)]);
}

/// Vickrey's price is the runner-up's bid, so the runner-up must be pinned exactly.
/// Leaving them merely "at or below" would let the auctioneer pick any price.
#[test]
#[should_panic(expected: 'VICKREY_NEEDS_RUNNER_UP')]
fn vickrey_settlement_needs_the_runner_up_pinned() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_below(env, b, 7)]);
}

/// If every rival is forfeited the lone survivor clears at the reserve, not at a
/// price the auctioneer names.
#[test]
#[should_panic(expected: 'LONE_BID_CLEARS_AT_RESERVE')]
fn a_lone_surviving_bid_cannot_clear_above_the_reserve() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 6, a.index, array![proof_above(env, a, 6), proof_forfeit()]);
}

#[test]
#[should_panic(expected: 'FIRST_PRICE_WINNER_NOT_EXACT')]
fn first_price_winner_must_pin_their_own_bid() {
    let env = setup(AuctionKind::FirstPrice);
    let a = place(env, 'A', 'SA', 12);
    seal(env);
    // "At or above 5" would let the winner pay 5 for a bid of 12.
    settle(env, 5, a.index, array![proof_above(env, a, 5)]);
}

#[test]
#[should_panic(expected: 'NO_WINNER_NEEDS_ALL_FORFEIT')]
fn declaring_no_winner_requires_every_bid_to_have_forfeited() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 0);
    seal(env);
    // A bid that dispositioned cleanly cannot be waved away as "no winner".
    settle(env, 0, NO_WINNER, array![proof_below(env, a, 0)]);
}

#[test]
#[should_panic(expected: 'LEVEL_OUT_OF_RANGE')]
fn a_clearing_level_off_the_ladder_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    seal(env);
    settle(env, LEVELS, a.index, array![proof_above(env, a, 0)]);
}

// ---- dispute window ------------------------------------------------------------

#[test]
#[should_panic(expected: 'DISPUTE_WINDOW_OPEN')]
fn finalize_before_the_dispute_window_closes_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    env.auction.finalize(env.id);
}

#[test]
#[should_panic(expected: 'DISPUTE_WINDOW_CLOSED')]
fn disputing_after_the_window_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0), proof_forfeit()]);
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env
        .auction
        .dispute(env.id, b.index, ladder::witness_at_or_above(env.id, b.commitment, 'SB', 7, 1));
}

#[test]
#[should_panic(expected: 'PROOF_AT_OR_ABOVE_FAILED')]
fn a_dispute_needs_a_bid_strictly_above_the_clearing_price() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    // b sits exactly at the clearing level, so there is nothing to dispute.
    env.auction.dispute(env.id, b.index, ladder::up_seed('SB'));
}

// ---- claims --------------------------------------------------------------------

#[test]
#[should_panic(expected: 'AUCTION_NOT_FINAL')]
fn refunds_are_not_payable_before_finalize() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    env.auction.claim_refund(env.id, a.index, 'A', payout());
}

#[test]
#[should_panic(expected: 'CLAIM_SECRET_MISMATCH')]
fn a_refund_needs_the_right_claim_secret() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);
    env.auction.claim_refund(env.id, b.index, 'WRONG', payout());
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_refund_cannot_be_taken_twice() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);
    env.auction.claim_refund(env.id, b.index, 'B', payout());
    env.auction.claim_refund(env.id, b.index, 'B', payout());
}

#[test]
#[should_panic(expected: 'BID_FORFEITED_USE_REDEEM')]
fn a_forfeited_bid_cannot_use_the_ordinary_refund_path() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    let c = place(env, 'C', 'SC', 3);
    seal(env);
    settle(
        env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7), proof_forfeit()],
    );
    finalize(env);
    env.auction.claim_refund(env.id, c.index, 'C', payout());
}

#[test]
#[should_panic(expected: 'PROOF_AT_OR_BELOW_FAILED')]
fn redeeming_a_forfeit_still_requires_a_real_proof() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    let c = place(env, 'C', 'SC', 9);
    seal(env);
    // c is above the clearing level, so it has no honest loser-side proof to give.
    settle(
        env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7), proof_forfeit()],
    );
    finalize(env);
    env.auction.redeem_forfeit(env.id, c.index, 'C', ladder::down_seed('SC'), payout());
}

#[test]
#[should_panic(expected: 'CLAIM_SECRET_MISMATCH')]
fn the_lot_goes_only_to_the_winning_bids_secret() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);
    env.auction.claim_lot(env.id, 'B', payout());
}

// ---- listing validation --------------------------------------------------------

#[test]
#[should_panic(expected: 'BAD_NUM_LEVELS')]
fn a_one_level_ladder_is_rejected() {
    super::common::setup_with(AuctionKind::Vickrey, 1, 0);
}

#[test]
#[should_panic(expected: 'BAD_DEADLINE')]
fn a_deadline_in_the_past_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    start_cheat_block_timestamp_global(DEADLINE + 1);
    let mut config = env.auction.get_config(env.id);
    config.bid_deadline = DEADLINE;
    start_cheat_caller_address(env.auction.contract_address, seller());
    env.auction.create_auction(config);
}

// ---- liveness: the auctioneer who never comes back -----------------------------

/// A sealed auction has exactly one way out — `settle`, and only the auctioneer may
/// call it. If that address never acts, every bidder's collateral, the lot and the
/// bond are locked in the contract permanently: `claim_refund` needs Finalized or
/// Cancelled, `dispute` and `finalize` both need Settled, and nothing reaches those
/// states without the auctioneer.
///
/// This is not a theft vector — nobody can take the money. It is worse in one way:
/// there is no recovery at all, for anyone, ever.
#[test]
fn an_auctioneer_who_never_settles_can_be_timed_out() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    let b = place(env, 'B', 'SB', 3);
    let escrow = env.auction.collateral(env.id);
    seal(env);

    // The auctioneer is gone. Long past the point where settling was plausible.
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.abandon(env.id);

    // Everyone gets their collateral back plus a share of the forfeited bond, and the
    // seller gets the lot. The bond no longer goes home — see
    // `abandon_forfeits_the_bond_to_the_bidders`.
    let share = BOND / 2;
    let got_a = env.auction.claim_refund(env.id, a.index, 'A', payout());
    let got_b = env.auction.claim_refund(env.id, b.index, 'B', payout());
    assert!(got_a == escrow + share, "A's escrow did not come back");
    assert!(got_b == escrow + share, "B's escrow did not come back");
    assert!(env.lot.balance_of(seller()) == LOT.into(), "the lot did not go home");
}

#[test]
#[should_panic(expected: 'SETTLE_GRACE_OPEN')]
fn abandon_before_the_grace_expires_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    seal(env);
    // The auctioneer is still well within the window they were given to settle.
    env.auction.abandon(env.id);
}

#[test]
#[should_panic(expected: 'AUCTION_NOT_SEALED')]
fn abandon_does_not_apply_to_a_settled_auction() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.abandon(env.id);
}

#[test]
#[should_panic(expected: 'ZERO_AUCTIONEER')]
fn an_auction_with_no_auctioneer_is_rejected_at_listing() {
    setup_with_auctioneer(AuctionKind::Vickrey, Zero::zero());
}

/// The grace boundary, pinned exactly.
///
/// It counts from **`sealed_at_time`** — the block timestamp `seal` stamped — and not
/// from the bid deadline, the settle attempt, or the listing. Those differ whenever
/// sealing is late, which it often is: `seal` is permissionless and fires whenever
/// somebody gets round to it.
#[test]
#[should_panic(expected: 'SETTLE_GRACE_OPEN')]
fn abandon_one_second_before_the_grace_expires_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    seal(env); // stamps sealed_at_time = DEADLINE
    start_cheat_block_timestamp_global(DEADLINE + WINDOW - 1);
    env.auction.abandon(env.id);
}

#[test]
fn abandon_at_exactly_the_grace_boundary_is_allowed() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    seal(env);
    start_cheat_block_timestamp_global(DEADLINE + WINDOW);
    env.auction.abandon(env.id);
}

/// A live auction is not abandonable. The vulnerable window is `seal` to `settle` and
/// nothing wider: while bidding is open there is no auctioneer obligation outstanding,
/// so there is nothing to time out.
#[test]
#[should_panic(expected: 'AUCTION_NOT_SEALED')]
fn an_open_auction_cannot_be_abandoned() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.abandon(env.id);
}

/// **The operator's escape hatch.** A finalized auction is permanently immune, whatever
/// its dispute window. Running the judged auction through to Finalized before anyone
/// looks at it is what puts it out of reach of a griefer, and it does not depend on
/// choosing a long window.
#[test]
#[should_panic(expected: 'AUCTION_NOT_SEALED')]
fn a_finalized_auction_can_never_be_abandoned() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);
    // Far past any grace period. Still refused.
    start_cheat_block_timestamp_global(DEADLINE + WINDOW * 100);
    env.auction.abandon(env.id);
}

/// Abandoning twice is not a way to drain the lot a second time.
#[test]
#[should_panic(expected: 'AUCTION_NOT_SEALED')]
fn abandon_is_not_repeatable() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    seal(env);
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.abandon(env.id);
    env.auction.abandon(env.id);
}

// ---- the auctioneer's bond ------------------------------------------------------

/// A bond below one price step is rejected at listing.
///
/// Zero used to be accepted, which left nothing at stake in a settlement bidders are
/// asked to trust. One tick is the smallest amount that makes moving the outcome by a
/// single level cost something.
#[test]
#[should_panic(expected: 'BOND_BELOW_ONE_TICK')]
fn a_bond_below_one_tick_is_rejected() {
    setup_with(AuctionKind::Vickrey, LEVELS, 0);
}

/// A bond above the uniform collateral is rejected at listing.
///
/// `abandon` pays the bond to the bidders, so an unbounded bond would let a bidder's
/// share exceed the collateral they staked — at which point the auction failing is worth
/// more to them than it succeeding.
#[test]
#[should_panic(expected: 'BOND_ABOVE_COLLATERAL')]
fn a_bond_above_the_collateral_cap_is_rejected() {
    setup_with(AuctionKind::Vickrey, LEVELS, CAP + 1);
}

/// **`abandon` forfeits the bond to the bidders.**
///
/// It used to be returned to the seller, which is where the defect lived.
#[test]
fn abandon_forfeits_the_bond_to_the_bidders() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    let b = place(env, 'B', 'SB', 2);
    seal(env);

    let seller_before = balance(env.pay, seller());
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.abandon(env.id);

    assert!(balance(env.pay, seller()) == seller_before, "the bond must not go home");

    // Each bidder receives their own escrow plus an equal share of the forfeited bond.
    let share = BOND / 2;
    assert!(
        env.auction.claim_refund(env.id, a.index, 'A', payout()) == CAP + share,
        "bidder A: escrow plus a share of the bond",
    );
    assert!(
        env.auction.claim_refund(env.id, b.index, 'B', payout()) == CAP + share,
        "bidder B: escrow plus a share of the bond",
    );
}

/// **The attack this closes.**
///
/// The bond is pulled from the seller at listing. It used to be returned to the seller on
/// abandon, so where one address was both seller and auctioneer, an auctioneer could
/// seal, collect the seeds, compute the outcome off-chain, and abandon if the clearing
/// price disappointed — lot back, bond back, re-list, cost of gas only.
///
/// That was strictly cheaper than excluding a bid, which needs a false settlement a
/// disputer can slash. Discarding needs no false proof, so nothing exists to dispute.
#[test]
fn an_auctioneer_who_is_the_seller_cannot_discard_an_outcome_for_free() {
    let env = setup_with_auctioneer(AuctionKind::Vickrey, seller());
    place(env, 'A', 'SA', 7);
    place(env, 'B', 'SB', 2);
    seal(env);

    let pay_before = balance(env.pay, seller());
    let lot_before = balance(env.lot, seller());
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.abandon(env.id);

    // The lot comes home — nothing was sold — but the bond does not.
    assert!(balance(env.lot, seller()) == lot_before + LOT, "lot returns");
    assert!(
        balance(env.pay, seller()) == pay_before,
        "discarding the outcome must now cost the bond",
    );
}

/// Nobody bid, so nobody was harmed and the bond goes home.
#[test]
fn abandoning_an_auction_with_no_bids_returns_the_bond() {
    let env = setup(AuctionKind::Vickrey);
    seal(env);
    let before = balance(env.pay, seller());
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    env.auction.abandon(env.id);
    assert!(balance(env.pay, seller()) == before + BOND, "no bidders, bond returns");
}
