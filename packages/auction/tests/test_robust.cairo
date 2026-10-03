//! Part 5: a claim secret that unlocks everything once, a seller paid by pull, tokens
//! that charge a fee refused at the door, and a bid count every settlement can afford.

use auction::interface::{
    ISealedBidAuctionDispatcherTrait, ISealedBidAuctionSafeDispatcher,
    ISealedBidAuctionSafeDispatcherTrait,
};
use auction::mocks::IHostileDispatcherTrait;
use auction::types::{AuctionKind, NO_BID, Status};
use snforge_std::start_cheat_block_timestamp_global;
use super::common::{
    BOND, CAP, LOT, RESERVE, TICK, approve_as, auctioneer, balance, bank, collect, config_for,
    deploy_auction, deploy_hostile, deploy_token, dispute_with, erc20_extras, finalize, fund,
    hostile, list, payout, place, post, proof_above, proof_exactly, proof_forfeit, seal, seller,
    settle, setup, setup_hostile_lot, setup_hostile_pay, setup_with,
};

// ---- one secret, one use ------------------------------------------------------------

/// The claim secret travels in calldata, so it is public once used. `collect` takes the
/// winner's surplus and lot together, so after it the secret unlocks nothing.
#[test]
fn the_winners_collect_takes_lot_and_surplus_together() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);

    let price = RESERVE + 7 * TICK;
    assert!(collect(env, a.index, 'A') == CAP - price);
    assert!(balance(env.lot, payout()) == LOT, "the lot came in the same call");

    // Anyone who read 'A' off the chain now finds nothing left to take.
    let thief: starknet::ContractAddress = 'THIEF'.try_into().unwrap();
    let safe = ISealedBidAuctionSafeDispatcher { contract_address: env.auction.contract_address };
    #[feature("safe_dispatcher")]
    let again = safe.collect(env.id, a.index, 'A', thief, thief);
    match again {
        Result::Ok(_) => panic!("a used secret must unlock nothing"),
        Result::Err(data) => assert!(*data.at(0) == 'ALREADY_CLAIMED'),
    }
    assert!(balance(env.pay, thief) == 0 && balance(env.lot, thief) == 0);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_loser_cannot_collect_twice() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);
    collect(env, b.index, 'B');
    collect(env, b.index, 'B');
}

// ---- the seller is paid by pull --------------------------------------------------

/// The seller is paid by pull. A payment token that refuses the seller — a blocklist —
/// holds up only the seller's own withdrawal, never `finalize` or any bidder.
#[test]
fn a_blocklisted_seller_cannot_freeze_finalize() {
    let env = setup_hostile_pay();
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    hostile(env.pay).block(seller());

    finalize(env);
    assert!(env.auction.get_state(env.id).status == Status::Finalized);
    assert!(collect(env, b.index, 'B') == CAP, "the loser is paid");
    collect(env, a.index, 'A');

    // Only the seller's own withdrawal waits on the token.
    let safe = ISealedBidAuctionSafeDispatcher { contract_address: env.auction.contract_address };
    #[feature("safe_dispatcher")]
    let blocked = safe.withdraw_seller(env.id);
    assert!(blocked.is_err());
}

#[test]
fn a_reverting_erc20_lot_cannot_block_a_dispute() {
    let env = setup_hostile_lot();
    let a = place(env, 'A', 'SA', 12);
    let v = place(env, 'V', 'SV', 11);
    seal(env);
    let p = post(env, v);
    settle(env, 0, a.index, array![proof_above(env, a, 0), proof_forfeit()]);
    hostile(env.lot).set_frozen(true);
    dispute_with(env, v, p);
    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    assert!(collect(env, v.index, 'V') == CAP + BOND);
}

#[test]
#[should_panic(expected: 'NOTHING_OWED_TO_SELLER')]
fn withdraw_seller_pays_once() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);
    env.auction.withdraw_seller(env.id);
    env.auction.withdraw_seller(env.id);
}

/// Anyone may trigger the payout; it only ever goes to the seller.
#[test]
fn withdraw_seller_always_pays_the_seller() {
    let env = setup(AuctionKind::Vickrey);
    let a = place(env, 'A', 'SA', 12);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);
    snforge_std::start_cheat_caller_address(
        env.auction.contract_address, 'ANYONE'.try_into().unwrap(),
    );
    env.auction.withdraw_seller(env.id);
    assert!(balance(env.pay, seller()) == RESERVE + BOND);
}

// ---- fee-on-transfer tokens --------------------------------------------------------

#[test]
#[should_panic(expected: 'TRANSFER_SHORTFALL')]
fn a_fee_on_transfer_token_is_refused_at_listing() {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_hostile();
    let lot = deploy_token(bank(), 1_000_u256);
    let auction = deploy_auction();
    fund(lot, seller(), LOT);
    approve_as(lot, seller(), auction.contract_address, LOT);
    hostile(pay).set_fee(1);
    list(
        auction,
        pay,
        config_for(pay.contract_address, lot.contract_address, LOT, 16),
        erc20_extras(),
        "",
    );
}

#[test]
#[should_panic(expected: 'TRANSFER_SHORTFALL')]
fn a_fee_on_transfer_token_is_refused_at_bidding() {
    let env = setup_hostile_pay();
    hostile(env.pay).set_fee(1);
    place(env, 'A', 'SA', 5);
}

// ---- the bid cap -------------------------------------------------------------------

/// `bids × levels` is capped so `settle` always fits in one transaction. On a 1024-level
/// ladder that is 32 bids; the 33rd is refused rather than making settlement impossible.
#[test]
#[should_panic(expected: 'BID_LIMIT_REACHED')]
fn bids_stop_at_the_settle_budget() {
    let env = setup_with(AuctionKind::Vickrey, 1024, TICK);
    let mut i: u32 = 0;
    while i < 33 {
        place(env, 'S' + i.into(), 'K' + i.into(), 0);
        i += 1;
    }
}

#[test]
fn bids_up_to_the_budget_are_accepted() {
    let env = setup_with(AuctionKind::Vickrey, 1024, TICK);
    let mut i: u32 = 0;
    while i < 32 {
        place(env, 'S' + i.into(), 'K' + i.into(), 0);
        i += 1;
    }
    assert!(env.auction.get_state(env.id).bid_count == 32);
}

// ---- lookup by anchor --------------------------------------------------------------

/// A client can confirm its own bid from either anchor in one read.
#[test]
fn bid_index_of_finds_a_bid_by_either_anchor() {
    let env = setup(AuctionKind::Vickrey);
    place(env, 'A', 'SA', 5);
    let b = place(env, 'B', 'SB', 9);
    let stored = env.auction.get_bid(env.id, b.index);
    assert!(env.auction.bid_index_of(env.id, stored.up_anchor) == b.index);
    assert!(env.auction.bid_index_of(env.id, stored.down_anchor) == b.index);
    assert!(env.auction.bid_index_of(env.id, 'NOT_AN_ANCHOR') == NO_BID);
    let _ = auctioneer();
}
