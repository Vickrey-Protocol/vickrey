//! The dispute.
//!
//! A dispute succeeds only for a bid the settlement left out, only by opening a reveal
//! for it that was posted on chain in time and reproduces the bid's own anchors, and only
//! if leaving it out changed the result. The bond goes to the bid, not the caller.
//!
//! The first half of this file is every dispute that must be refused. The second half is
//! the one that must work: a bid the auctioneer had, and left out.

use auction::interface::{
    ISealedBidAuctionDispatcherTrait, ISealedBidAuctionSafeDispatcher,
    ISealedBidAuctionSafeDispatcherTrait,
};
use auction::types::{AuctionKind, NO_WINNER, Status};
use auction::{ladder, reveal};
use snforge_std::{
    start_cheat_block_timestamp_global, start_cheat_caller_address, stop_cheat_caller_address,
};
use super::common::{
    ABANDON_AT, BOND, CAP, DEADLINE, Kit, LEVELS, Posted, SETTLE_AT, WINDOW, auctioneer, balance,
    collect, dispute_with, eph_r, finalize, payout, place, place_raw, post, proof_above,
    proof_exactly, proof_forfeit, reveal_key, seal, sealed_reveal, seller, settle, setup,
    setup_with_auctioneer,
};

/// The standard shape: `a` wins at 12, `c` is runner-up at 2, and `v` at 11 is left out,
/// so the price falls from 11 to 2.
fn excluded(env: super::common::Env) -> (Kit, Kit, Kit) {
    let a = place(env, 'A', 'SA', 12);
    let v = place(env, 'V', 'SV', 11);
    let c = place(env, 'C', 'SC', 2);
    seal(env);
    (a, v, c)
}

fn settle_excluding(env: super::common::Env, a: Kit, c: Kit) {
    settle(
        env, 2, a.index, array![proof_above(env, a, 2), proof_forfeit(), proof_exactly(env, c, 2)],
    );
}

// ---- refused --------------------------------------------------------------------

/// A bid that never revealed on chain was never the auctioneer's to settle. It has no
/// reveal to open, so it has no dispute.
#[test]
#[should_panic(expected: 'REVEAL_NOT_POSTED')]
fn self_forfeit_without_a_posted_reveal_cannot_dispute() {
    let env = setup(AuctionKind::Vickrey);
    let (a, v, c) = excluded(env);
    // `v` posts nothing.
    settle_excluding(env, a, c);
    dispute_with(env, v, sealed_reveal(env, v));
}

/// A reveal that arrives after the window is a reveal the auctioneer could not have
/// settled with. The contract refuses to record it at all.
#[test]
#[should_panic(expected: 'REVEAL_WINDOW_CLOSED')]
fn a_reveal_posted_after_the_window_cannot_back_a_dispute() {
    let env = setup(AuctionKind::Vickrey);
    let (_a, v, _c) = excluded(env);
    start_cheat_block_timestamp_global(SETTLE_AT);
    post(env, v);
}

/// A reveal that does not open to the bid's anchors is not a reveal of that bid.
#[test]
#[should_panic(expected: 'REVEAL_DOES_NOT_OPEN')]
fn a_garbage_reveal_cannot_back_a_dispute() {
    let env = setup(AuctionKind::Vickrey);
    let (a, v, c) = excluded(env);
    let r = eph_r(env, v);
    let junk = Posted {
        eph_x: reveal::ephemeral_x(r).unwrap(), c_seed: 'NOT_A_SEED', c_level: 'NOR_A_LEVEL',
    };
    env.auction.post_reveal(env.id, v.index, junk.eph_x, junk.c_seed, junk.c_level);
    settle_excluding(env, a, c);
    dispute_with(env, v, junk);
}

/// The pads bind a reveal to one bid. Copying a valid reveal onto another index opens to
/// noise there.
#[test]
#[should_panic(expected: 'REVEAL_DOES_NOT_OPEN')]
fn a_reveal_for_another_bid_index_does_not_open() {
    let env = setup(AuctionKind::Vickrey);
    let (a, v, c) = excluded(env);
    let valid_for_c = sealed_reveal(env, c);
    // Post c's ciphertext against v's index, then try to open it there.
    env
        .auction
        .post_reveal(env.id, v.index, valid_for_c.eph_x, valid_for_c.c_seed, valid_for_c.c_level);
    settle_excluding(env, a, c);
    env.auction.dispute(env.id, v.index, eph_r(env, c), valid_for_c.c_seed, valid_for_c.c_level);
}

/// A bid whose two anchors were built from different levels cannot be pinned to one, so
/// no reveal reproduces both. It cannot dispute either.
#[test]
#[should_panic(expected: 'REVEAL_DOES_NOT_OPEN')]
fn inconsistent_anchors_cannot_dispute_even_with_a_reveal() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let c = place(env, 'C', 'SC', 2);
    // Up-chain says 15, down-chain says 0.
    let commitment = ladder::claim_commitment_of('X');
    let up = ladder::up_anchor(env.id, commitment, 'SX', 15);
    let down = ladder::down_anchor(env.id, commitment, 'SX', 0, LEVELS);
    let index = place_raw(env, commitment, up, down);
    let x = Kit { secret: 'X', seed: 'SX', level: 15, commitment, index };
    seal(env);
    let posted = post(env, x);
    settle(
        env, 2, a.index, array![proof_above(env, a, 2), proof_exactly(env, c, 2), proof_forfeit()],
    );
    dispute_with(env, x, posted);
}

/// The Vickrey winner sits above the price it pays, nearly always. That is the outcome
/// being correct, not a reason to void it.
#[test]
#[should_panic(expected: 'ONLY_FORFEIT_MAY_DISPUTE')]
fn the_winner_cannot_dispute_their_own_bid() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    let posted = post(env, a);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    dispute_with(env, a, posted);
}

#[test]
#[should_panic(expected: 'ONLY_FORFEIT_MAY_DISPUTE')]
fn an_at_or_below_bid_cannot_dispute() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    let c = place(env, 'C', 'SC', 3);
    seal(env);
    let posted = post(env, c);
    settle(
        env,
        7,
        a.index,
        array![
            proof_above(env, a, 7), proof_exactly(env, b, 7), super::common::proof_below(env, c, 7),
        ],
    );
    dispute_with(env, c, posted);
}

/// A forfeited bid below the price was left out, but leaving it out changed nothing.
/// It cannot void the auction — and it still gets its escrow back afterwards.
#[test]
fn a_valid_reveal_below_clearing_cannot_void_but_can_still_redeem() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    let low = place(env, 'L', 'SL', 2);
    seal(env);
    let posted = post(env, low);
    settle(
        env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7), proof_forfeit()],
    );

    let safe = ISealedBidAuctionSafeDispatcher { contract_address: env.auction.contract_address };
    #[feature("safe_dispatcher")]
    let refused = safe.dispute(env.id, low.index, eph_r(env, low), posted.c_seed, posted.c_level);
    match refused {
        Result::Ok(_) => panic!("a bid below the price must not void the auction"),
        Result::Err(data) => assert!(*data.at(0) == 'EXCLUSION_CHANGED_NOTHING'),
    }

    finalize(env);
    let witness = ladder::witness_at_or_below(env.id, low.commitment, 'SL', 2, 7);
    assert!(env.auction.redeem_forfeit(env.id, low.index, 'L', witness, payout()) == CAP);
}

/// The auctioneer can read every revealed seed, so it can open a reveal itself. The bond
/// still goes to the bid, never the caller: voiding its own settlement costs the
/// auctioneer the bond, the same as `abandon` does.
#[test]
fn an_auctioneer_disputing_itself_pays_the_bond_to_the_bid_not_the_caller() {
    let env = setup_with_auctioneer(AuctionKind::Vickrey, seller());
    let a = place(env, 'A', 'SA', 12);
    let v = place(env, 'V', 'SV', 11);
    seal(env);
    let posted = post(env, v);
    start_cheat_caller_address(env.auction.contract_address, seller());
    start_cheat_block_timestamp_global(SETTLE_AT);
    env.auction.settle(env.id, 0, a.index, array![proof_above(env, a, 0), proof_forfeit()].span());
    // The seller-auctioneer opens the reveal itself (it can derive r from the seed).
    dispute_with(env, v, posted);
    stop_cheat_caller_address(env.auction.contract_address);

    assert!(env.auction.seller_owed(env.id) == 0, "the bond does not come home");
    assert!(balance(env.pay, seller()) == 0, "the seller was paid nothing");
    assert!(collect(env, v.index, 'V') == CAP + BOND, "the excluded bidder holds the bond");
}

// ---- timing ---------------------------------------------------------------------

#[test]
#[should_panic(expected: 'REVEAL_WINDOW_OPEN')]
fn settle_before_the_reveal_deadline_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    seal(env);
    start_cheat_block_timestamp_global(SETTLE_AT - 1);
    start_cheat_caller_address(env.auction.contract_address, auctioneer());
    env.auction.settle(env.id, 0, a.index, array![proof_above(env, a, 0)].span());
}

/// The auctioneer's time to settle starts when the last reveal could have arrived: the
/// reveal window, then `dispute_window`.
#[test]
#[should_panic(expected: 'SETTLE_GRACE_OPEN')]
fn abandon_grace_counts_from_the_reveal_deadline() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    seal(env);
    start_cheat_block_timestamp_global(DEADLINE + WINDOW);
    env.auction.abandon(env.id);
}

#[test]
fn abandon_opens_exactly_at_reveal_deadline_plus_window() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    seal(env);
    start_cheat_block_timestamp_global(ABANDON_AT);
    env.auction.abandon(env.id);
    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
}

#[test]
#[should_panic(expected: 'AUCTION_NOT_SEALED')]
fn post_reveal_before_seal_is_rejected() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 5);
    post(env, a);
}

// ---- still works ----------------------------------------------------------------

/// A "no winner" settlement claims no bid could be settled. A bid that revealed in time
/// shows otherwise, whatever clearing level the settlement named.
#[test]
fn a_no_winner_settlement_at_the_top_level_is_disputable_by_a_revealed_bid() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 3);
    let b = place(env, 'B', 'SB', 9);
    seal(env);
    let posted = post(env, a);
    settle(env, LEVELS - 1, NO_WINNER, array![proof_forfeit(), proof_forfeit()]);

    dispute_with(env, a, posted);
    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    assert!(collect(env, a.index, 'A') == CAP + BOND);
    assert!(collect(env, b.index, 'B') == CAP);
}

/// The reveal can be posted by anyone — an app relay, a friend — and the dispute sent by
/// anyone. Neither needs the bidder's own address on chain.
#[test]
fn a_dispute_works_from_a_reveal_someone_else_posted() {
    let env = setup(AuctionKind::Vickrey);
    let (a, v, c) = excluded(env);
    let relay: starknet::ContractAddress = 'RELAY'.try_into().unwrap();
    start_cheat_caller_address(env.auction.contract_address, relay);
    let posted = post(env, v);
    stop_cheat_caller_address(env.auction.contract_address);

    settle_excluding(env, a, c);
    start_cheat_caller_address(env.auction.contract_address, relay);
    dispute_with(env, v, posted);
    stop_cheat_caller_address(env.auction.contract_address);

    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    assert!(balance(env.pay, relay) == 0, "the relay is paid nothing");
    assert!(collect(env, v.index, 'V') == CAP + BOND);
}

/// A garbage reveal posted by someone else does not stand in the way of the real one.
#[test]
fn garbage_posted_against_a_bid_does_not_block_its_real_reveal() {
    let env = setup(AuctionKind::Vickrey);
    let (a, v, c) = excluded(env);
    env.auction.post_reveal(env.id, v.index, 'JUNK', 'JUNK', 'JUNK');
    let posted = post(env, v);
    settle_excluding(env, a, c);
    dispute_with(env, v, posted);
    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
}

/// The auctioneer reads every reveal with its secret key alone, no `r` needed — which is
/// what makes a posted reveal proof that it had the bid.
#[test]
fn the_auctioneer_can_read_every_posted_reveal() {
    let env = setup(AuctionKind::Vickrey);
    let v = place(env, 'V', 'SV', 11);
    seal(env);
    let p = post(env, v);
    let (seed, level) = reveal::open_as_auctioneer(
        super::common::AUCTIONEER_SK, p.eph_x, env.id, v.index, p.c_seed, p.c_level,
    )
        .unwrap();
    assert!(seed == 'SV');
    assert!(level == 11);
    assert!(env.auction.reveal_posted(env.id, v.index, p.eph_x, p.c_seed, p.c_level));
    let _ = reveal_key();
}

// ---- the property, fuzzed ------------------------------------------------------

/// Dispute succeeds iff the bid was forfeited, its reveal was posted in time, and leaving
/// it out changed the outcome. Fuzzed over the left-out bid's level, the clearing level,
/// and whether it revealed.
#[test]
#[fuzzer(runs: 40)]
fn fuzz_dispute_succeeds_iff_forfeit_revealed_and_outcome_changed(
    victim_level: u16, clearing: u16, revealed: bool,
) {
    let env = setup(AuctionKind::Vickrey);
    let clearing = clearing % (LEVELS - 1); // 0..14
    let v_level = victim_level % LEVELS;
    let winner = place(env, 'W', 'SW', LEVELS - 1);
    let runner = place(env, 'R', 'SR', clearing);
    let v = place(env, 'V', 'SV', v_level);
    seal(env);
    let posted = if revealed {
        post(env, v)
    } else {
        sealed_reveal(env, v)
    };
    settle(
        env,
        clearing,
        winner.index,
        array![
            proof_above(env, winner, clearing), proof_exactly(env, runner, clearing),
            proof_forfeit(),
        ],
    );

    let expected = revealed && v_level > clearing;
    let safe = ISealedBidAuctionSafeDispatcher { contract_address: env.auction.contract_address };
    #[feature("safe_dispatcher")]
    let result = safe.dispute(env.id, v.index, eph_r(env, v), posted.c_seed, posted.c_level);
    assert!(result.is_ok() == expected, "dispute outcome disagrees with the rule");
    if expected {
        assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    } else {
        assert!(env.auction.get_state(env.id).status == Status::Settled);
    }
}
