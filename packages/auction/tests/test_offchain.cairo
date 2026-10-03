//! Off-chain lots: nothing is escrowed for the item, so the winner's payment is held in
//! a delivery escrow. Confirm pays the seller; silence until the deadline pays the
//! seller; reject before the deadline locks the price and the seller's bond for good.

use auction::interface::{
    ISealedBidAuctionDispatcherTrait, ISealedBidAuctionSafeDispatcher,
    ISealedBidAuctionSafeDispatcherTrait,
};
use auction::types::{DeliveryOutcome, NO_WINNER, Status};
use core::poseidon::poseidon_hash_span;
use snforge_std::{
    start_cheat_block_timestamp_global, start_cheat_caller_address, stop_cheat_caller_address,
};
use super::common::{
    ABANDON_AT, BOND, CAP, DELIVERY, LEVELS, RESERVE, SELLER_BOND, SETTLE_AT, TICK, WINDOW, balance,
    bank, collect, config_for, deploy_auction, deploy_token, dispute_with, finalize, list,
    offchain_extras, offchain_terms, payout, place, post, proof_above, proof_exactly, proof_forfeit,
    seal, seller, seller_paid, settle, setup_offchain,
};

const FINAL_AT: u64 = SETTLE_AT + WINDOW + 1;

fn buyer() -> starknet::ContractAddress {
    'BUYER'.try_into().unwrap()
}

/// Bids, settles at 7, finalizes, and has the winner collect naming `buyer()`.
fn won(env: super::common::Env) -> u128 {
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);
    env.auction.collect(env.id, a.index, 'A', payout(), buyer());
    RESERVE + 7 * TICK
}

fn as_buyer(env: super::common::Env) {
    start_cheat_caller_address(env.auction.contract_address, buyer());
}

#[test]
fn offchain_create_escrows_no_lot_and_pulls_the_seller_bond() {
    let env = setup_offchain();
    assert!(balance(env.pay, env.auction.contract_address) == BOND + SELLER_BOND);
    let config = env.auction.get_config(env.id);
    assert!(config.lot_amount == 0);
}

/// The text is what bidders read, and the contract computes the hash from it, so the
/// published terms and `terms_hash` cannot disagree.
#[test]
fn terms_hash_is_computed_from_the_text() {
    let env = setup_offchain();
    let mut buf: Array<felt252> = array![];
    offchain_terms().serialize(ref buf);
    let expected = poseidon_hash_span(buf.span());
    let stored = env.auction.get_config(env.id).terms_hash;
    assert!(stored == expected, "the stored hash is the hash of the text");
    assert!(stored != 'ONE_RARE_THING', "the seller-supplied value is ignored");
}

#[test]
#[should_panic(expected: 'OFFCHAIN_LOT_NEEDS_TERMS')]
fn an_offchain_lot_needs_terms() {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);
    let auction = deploy_auction();
    list(
        auction,
        pay,
        config_for(pay.contract_address, 0.try_into().unwrap(), 0, LEVELS),
        offchain_extras(),
        "",
    );
}

#[test]
fn offchain_finalize_holds_the_price() {
    let env = setup_offchain();
    let price = won(env);
    let d = env.auction.get_delivery(env.id);
    assert!(d.outcome == DeliveryOutcome::Pending);
    assert!(d.price == price);
    assert!(d.buyer == buyer(), "the winner named the buyer at collect");
    assert!(d.deadline == FINAL_AT + DELIVERY);
    // Only the auctioneer's bond is owed so far; the price waits.
    assert!(env.auction.seller_owed(env.id) == BOND);
}

#[test]
fn buyer_confirm_pays_price_and_bond_to_the_seller() {
    let env = setup_offchain();
    let price = won(env);
    as_buyer(env);
    env.auction.confirm_delivery(env.id);
    assert!(env.auction.get_delivery(env.id).outcome == DeliveryOutcome::Confirmed);
    assert!(seller_paid(env) == price + BOND + SELLER_BOND);
}

#[test]
fn silence_until_the_deadline_pays_the_seller() {
    let env = setup_offchain();
    let price = won(env);
    start_cheat_block_timestamp_global(FINAL_AT + DELIVERY);
    // Anyone may release once the window has passed.
    env.auction.release_proceeds(env.id);
    assert!(env.auction.get_delivery(env.id).outcome == DeliveryOutcome::Released);
    assert!(seller_paid(env) == price + BOND + SELLER_BOND);
}

#[test]
#[should_panic(expected: 'DELIVERY_WINDOW_OPEN')]
fn release_before_the_deadline_is_refused() {
    let env = setup_offchain();
    won(env);
    env.auction.release_proceeds(env.id);
}

/// Reject destroys the price and the seller bond: they stay in the contract and no
/// path ever pays them out.
#[test]
fn reject_before_the_deadline_locks_price_and_bond_forever() {
    let env = setup_offchain();
    let price = won(env);
    let auction = env.auction.contract_address;
    as_buyer(env);
    env.auction.reject_delivery(env.id);
    stop_cheat_caller_address(auction);
    assert!(env.auction.get_delivery(env.id).outcome == DeliveryOutcome::Rejected);

    // The seller can take the auctioneer's bond, and nothing else.
    assert!(env.auction.seller_owed(env.id) == BOND);
    env.auction.withdraw_seller(env.id);
    collect(env, 1, 'B');
    assert!(balance(env.pay, auction) == price + SELLER_BOND, "exactly price and bond remain");

    // And every way out is shut.
    let safe = ISealedBidAuctionSafeDispatcher { contract_address: auction };
    start_cheat_block_timestamp_global(FINAL_AT + DELIVERY * 10);
    #[feature("safe_dispatcher")]
    let r1 = safe.release_proceeds(env.id);
    #[feature("safe_dispatcher")]
    let r2 = safe.withdraw_seller(env.id);
    start_cheat_caller_address(auction, buyer());
    #[feature("safe_dispatcher")]
    let r3 = safe.confirm_delivery(env.id);
    #[feature("safe_dispatcher")]
    let r4 = safe.reject_delivery(env.id);
    #[feature("safe_dispatcher")]
    let r5 = safe.collect(env.id, 0, 'A', payout(), buyer());
    #[feature("safe_dispatcher")]
    let r6 = safe.reclaim_lot(env.id);
    assert!(r1.is_err() && r2.is_err() && r3.is_err() && r4.is_err() && r5.is_err() && r6.is_err());
    assert!(balance(env.pay, auction) == price + SELLER_BOND, "still locked");
}

#[test]
#[should_panic(expected: 'DELIVERY_WINDOW_CLOSED')]
fn reject_after_the_deadline_is_refused() {
    let env = setup_offchain();
    won(env);
    start_cheat_block_timestamp_global(FINAL_AT + DELIVERY);
    as_buyer(env);
    env.auction.reject_delivery(env.id);
}

#[test]
#[should_panic(expected: 'DELIVERY_NOT_PENDING')]
fn confirm_after_reject_is_refused() {
    let env = setup_offchain();
    won(env);
    as_buyer(env);
    env.auction.reject_delivery(env.id);
    env.auction.confirm_delivery(env.id);
}

#[test]
#[should_panic(expected: 'DELIVERY_NOT_PENDING')]
fn a_second_reject_is_refused() {
    let env = setup_offchain();
    won(env);
    as_buyer(env);
    env.auction.reject_delivery(env.id);
    env.auction.reject_delivery(env.id);
}

/// The claim secret is public once the winner has collected — it was in that calldata.
/// So confirm and reject are tied to the buyer's address, not the secret. Anyone else
/// is refused, the winning bidder's secret notwithstanding.
#[test]
#[should_panic(expected: 'CALLER_NOT_BUYER')]
fn only_the_buyer_address_can_confirm_or_reject() {
    let env = setup_offchain();
    won(env);
    start_cheat_caller_address(
        env.auction.contract_address, 'SOMEONE_WITH_THE_SECRET'.try_into().unwrap(),
    );
    env.auction.reject_delivery(env.id);
}

/// Before the winner collects there is no buyer, so nobody can reject; the deadline
/// still runs and silence pays the seller.
#[test]
#[should_panic(expected: 'CALLER_NOT_BUYER')]
fn nobody_can_reject_before_the_winner_names_a_buyer() {
    let env = setup_offchain();
    let a = place(env, 'A', 'SA', 12);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);
    start_cheat_caller_address(env.auction.contract_address, 0.try_into().unwrap());
    env.auction.reject_delivery(env.id);
}

#[test]
fn the_surplus_is_paid_whatever_happens_to_delivery() {
    let env = setup_offchain();
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);
    let price = RESERVE + 7 * TICK;
    assert!(env.auction.collect(env.id, a.index, 'A', payout(), buyer()) == CAP - price);
    as_buyer(env);
    env.auction.reject_delivery(env.id);
    assert!(balance(env.pay, payout()) == CAP - price, "the surplus is not part of the escrow");
}

#[test]
fn no_winner_abandon_and_dispute_return_the_seller_bond() {
    // No winner.
    let env = setup_offchain();
    seal(env);
    settle(env, 0, NO_WINNER, array![]);
    finalize(env);
    assert!(env.auction.seller_owed(env.id) == BOND + SELLER_BOND);

    // Abandon: the auctioneer bond goes to the bidders, the seller bond goes home.
    let env = setup_offchain();
    place(env, 'A', 'SA', 5);
    seal(env);
    start_cheat_block_timestamp_global(ABANDON_AT);
    env.auction.abandon(env.id);
    assert!(env.auction.seller_owed(env.id) == SELLER_BOND);

    // Dispute: the same.
    let env = setup_offchain();
    let a = place(env, 'A', 'SA', 12);
    let v = place(env, 'V', 'SV', 11);
    seal(env);
    let p = post(env, v);
    settle(env, 0, a.index, array![proof_above(env, a, 0), proof_forfeit()]);
    dispute_with(env, v, p);
    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    assert!(env.auction.seller_owed(env.id) == SELLER_BOND);
}

/// Conservation: everything in either comes out or is locked by a rejection, and the
/// two together account for the whole balance.
#[test]
fn an_offchain_lifecycle_conserves_value() {
    let env = setup_offchain();
    let auction = env.auction.contract_address;
    let price = won(env); // collect(winner) already ran
    collect(env, 1, 'B');
    as_buyer(env);
    env.auction.confirm_delivery(env.id);
    stop_cheat_caller_address(auction);
    env.auction.withdraw_seller(env.id);
    assert!(balance(env.pay, auction) == 0, "nothing left behind");
    assert!(balance(env.pay, seller()) == price + BOND + SELLER_BOND);
}
