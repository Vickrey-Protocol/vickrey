//! Vickrey: the winner pays the second-highest bid, and no bid is ever published.

use auction::interface::ISealedBidAuctionDispatcherTrait;
use auction::ladder;
use auction::types::{AuctionKind, Disposition, NO_WINNER, Status};
use super::common::{
    BOND, CAP, DEADLINE, LOT, RESERVE, TICK, balance, finalize, payout, place, proof_above,
    proof_below, proof_exactly, proof_forfeit, seal, seller, settle, setup,
};

/// The headline. Five bidders, and afterwards the chain knows exactly one number.
#[test]
fn winner_pays_the_second_price_and_nothing_else_is_revealed() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12); // winner
    let b = place(env, 'B', 'SB', 9); // runner-up, sets the price
    let c = place(env, 'C', 'SC', 4);
    let d = place(env, 'D', 'SD', 7);
    let e = place(env, 'E', 'SE', 0);
    seal(env);

    let sealed = env.auction.get_state(env.id);
    assert!(sealed.status == Status::Sealed);
    assert!(sealed.bid_count == 5);
    assert!(sealed.bid_root != 0, "the bid set must be committed before settlement");

    settle(
        env,
        9,
        a.index,
        array![
            proof_above(env, a, 9), proof_exactly(env, b, 9), proof_below(env, c, 9),
            proof_below(env, d, 9), proof_below(env, e, 9),
        ],
    );

    let state = env.auction.get_state(env.id);
    assert!(state.clearing_level == 9);
    assert!(state.winner_index == a.index);
    // The clearing price is the only amount the chain learns.
    assert!(env.auction.price_of_level(env.id, state.clearing_level) == RESERVE + 9 * TICK);

    // Every losing bid is still nothing but two hashes.
    let stored_c = env.auction.get_bid(env.id, c.index);
    assert!(stored_c.disposition == Disposition::AtOrBelow);
    assert!(stored_c.up_anchor == ladder::up_anchor(env.id, c.commitment, 'SC', 4));

    finalize(env);

    let price = RESERVE + 9 * TICK; // 190
    assert!(balance(env.pay, seller()) == price + BOND, "seller gets price plus bond back");

    // The winner's surplus refunds privately, so the winning bid stays hidden too.
    let surplus = env.auction.claim_refund(env.id, a.index, 'A', payout());
    assert!(surplus == CAP - price, "winner is refunded collateral minus the second price");

    // Losers are made whole.
    assert!(env.auction.claim_refund(env.id, c.index, 'C', payout()) == CAP);
    assert!(env.auction.claim_refund(env.id, d.index, 'D', payout()) == CAP);
    assert!(env.auction.claim_refund(env.id, e.index, 'E', payout()) == CAP);
    assert!(env.auction.claim_refund(env.id, b.index, 'B', payout()) == CAP);

    // The lot leaves as a private note, addressed to a secret rather than an address.
    assert!(env.auction.claim_lot(env.id, 'A', payout()) == LOT);
    assert!(balance(env.lot, payout()) == LOT);
}

#[test]
fn a_lone_bidder_clears_at_the_reserve() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 11);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);

    assert!(balance(env.pay, seller()) == RESERVE + BOND);
    assert!(env.auction.claim_refund(env.id, a.index, 'A', payout()) == CAP - RESERVE);
}

#[test]
fn a_tie_at_the_top_clears_at_that_level() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 8);
    let b = place(env, 'B', 'SB', 8);
    seal(env);
    // Both are at 8, so the second price is 8 and the tie-break is by arrival index.
    settle(env, 8, a.index, array![proof_exactly(env, a, 8), proof_exactly(env, b, 8)]);
    finalize(env);

    let price = RESERVE + 8 * TICK;
    assert!(balance(env.pay, seller()) == price + BOND);
    assert!(env.auction.claim_refund(env.id, a.index, 'A', payout()) == CAP - price);
}

#[test]
fn an_auction_nobody_bid_in_returns_the_lot() {
    let env = setup(AuctionKind::Vickrey);
    seal(env);
    settle(env, 0, NO_WINNER, array![]);
    finalize(env);

    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    assert!(balance(env.lot, seller()) == LOT);
    assert!(balance(env.pay, seller()) == BOND);
}

/// A bidder who never sends their seed cannot stall the auction. Settlement completes
/// without them and their money waits.
#[test]
fn a_silent_bidder_does_not_block_settlement() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 9);
    let ghost = place(env, 'G', 'SG', 3); // goes offline after sealing
    seal(env);

    settle(
        env, 9, a.index, array![proof_above(env, a, 9), proof_exactly(env, b, 9), proof_forfeit()],
    );
    finalize(env);

    assert!(env.auction.get_state(env.id).status == Status::Finalized);
    assert!(env.auction.get_bid(env.id, ghost.index).disposition == Disposition::Forfeit);

    // It comes back whenever they do, by serving the loser-side proof themselves.
    let witness = ladder::witness_at_or_below(env.id, ghost.commitment, 'SG', 3, 9);
    assert!(env.auction.redeem_forfeit(env.id, ghost.index, 'G', witness, payout()) == CAP);
}

/// The attack the plan is built around: the auctioneer drops a rival's high bid to
/// depress the price. It settles, and then it does not survive the window.
#[test]
fn excluding_a_high_bid_is_caught_in_the_dispute_window() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12); // the auctioneer's friend
    let victim = place(env, 'V', 'SV', 11); // the bid it wants gone
    let c = place(env, 'C', 'SC', 2);
    seal(env);

    // Forfeit the victim and the price collapses from 11 to 2.
    settle(
        env, 2, a.index, array![proof_above(env, a, 2), proof_forfeit(), proof_exactly(env, c, 2)],
    );
    assert!(env.auction.get_state(env.id).status == Status::Settled);

    // The victim proves they were strictly above the clearing level. That is all it takes.
    let witness = ladder::witness_at_or_above(env.id, victim.commitment, 'SV', 11, 3);
    env.auction.dispute(env.id, victim.index, witness);

    let state = env.auction.get_state(env.id);
    assert!(state.status == Status::Cancelled, "a proved exclusion voids the settlement");
    assert!(balance(env.pay, payout()) == 0, "nothing was paid out");
    assert!(balance(env.lot, seller()) == LOT, "the lot went home");

    // Everyone, forfeits included, is made whole.
    assert!(env.auction.claim_refund(env.id, a.index, 'A', payout()) == CAP);
    assert!(env.auction.claim_refund(env.id, victim.index, 'V', payout()) == CAP);
    assert!(env.auction.claim_refund(env.id, c.index, 'C', payout()) == CAP);
}

#[test]
fn the_bond_is_slashed_to_whoever_proves_the_exclusion() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let victim = place(env, 'V', 'SV', 11);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0), proof_forfeit()]);

    let before = balance(env.pay, payout());
    snforge_std::start_cheat_caller_address(env.auction.contract_address, payout());
    env
        .auction
        .dispute(
            env.id,
            victim.index,
            ladder::witness_at_or_above(env.id, victim.commitment, 'SV', 11, 1),
        );
    snforge_std::stop_cheat_caller_address(env.auction.contract_address);

    assert!(balance(env.pay, payout()) == before + BOND, "the bond pays the disputer");
}

#[test]
fn sealing_stamps_the_block_and_freezes_the_set() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    let before = env.auction.get_state(env.id).bid_root;
    place(env, 'B', 'SB', 6);
    let after = env.auction.get_state(env.id).bid_root;
    assert!(before != after, "every arrival must move the root");

    seal(env);
    let state = env.auction.get_state(env.id);
    assert!(state.sealed_at_time == DEADLINE);
    assert!(state.bid_root == after, "the root freezes at the seal");
}
