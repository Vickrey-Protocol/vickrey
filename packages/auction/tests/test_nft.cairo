//! ERC-721 lots: escrowed at listing with a plain `transfer_from`, checked with
//! `owner_of`, delivered to the winner with `safe_transfer_from`, and returned to the
//! seller by pull.

use auction::erc721::IERC721DispatcherTrait;
use auction::interface::ISealedBidAuctionDispatcherTrait;
use auction::mocks::IMockERC721AdminDispatcherTrait;
use auction::types::{AuctionExtras, LotKind, NO_WINNER, Status};
use snforge_std::start_cheat_block_timestamp_global;
use super::common::{
    ABANDON_AT, BOND, CAP, LEVELS, NFT_ID, RESERVE, TICK, approve_as, balance, bank, collect,
    config_for, deploy_auction, deploy_nft, deploy_token, dispute_with, erc20_extras, finalize,
    fund, list, nft, nft_admin, payout, place, post, proof_above, proof_exactly, proof_forfeit,
    seal, seller, seller_paid, settle, setup_nft,
};

fn owner(env: super::common::Env) -> starknet::ContractAddress {
    nft(env.lot.contract_address).owner_of(NFT_ID)
}

#[test]
fn erc721_lot_is_escrowed_at_create() {
    let env = setup_nft();
    assert!(owner(env) == env.auction.contract_address, "the auction holds the NFT");
    let extras = env.auction.get_extras(env.id);
    assert!(extras.lot_kind == LotKind::Erc721);
    assert!(extras.lot_token_id == NFT_ID);
}

#[test]
#[should_panic(expected: 'UNAUTHORIZED')]
fn erc721_create_without_approval_reverts() {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);
    let collection = deploy_nft();
    let auction = deploy_auction();
    nft_admin(collection).mint(seller(), NFT_ID);
    // No approval.
    let extras = AuctionExtras {
        lot_kind: LotKind::Erc721, lot_token_id: NFT_ID, ..erc20_extras(),
    };
    list(auction, pay, config_for(pay.contract_address, collection, 1, LEVELS), extras, "");
}

/// ERC-20 and ERC-721 share the `transfer_from` selector and calldata layout, so a
/// collection that is really an ERC-20 would "transfer" `token_id` units. The `owner_of`
/// check after the pull is what stops it: an ERC-20 has none.
#[test]
#[should_panic]
fn an_erc20_passed_as_erc721_is_rejected() {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);
    let fake = deploy_token(bank(), 1_000_000_u256);
    let auction = deploy_auction();
    fund(fake, seller(), 100);
    approve_as(fake, seller(), auction.contract_address, 100);
    let extras = AuctionExtras { lot_kind: LotKind::Erc721, lot_token_id: 77, ..erc20_extras() };
    list(
        auction,
        pay,
        config_for(pay.contract_address, fake.contract_address, 1, LEVELS),
        extras,
        "",
    );
}

#[test]
fn erc721_lot_goes_to_the_winner_on_collect() {
    let env = setup_nft();
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 7);
    seal(env);
    settle(env, 7, a.index, array![proof_above(env, a, 7), proof_exactly(env, b, 7)]);
    finalize(env);

    let price = RESERVE + 7 * TICK;
    // One call: the surplus and the NFT.
    assert!(collect(env, a.index, 'A') == CAP - price);
    assert!(owner(env) == payout(), "the winner holds the NFT");
    assert!(env.auction.get_state(env.id).lot_claimed);
    assert!(seller_paid(env) == price + BOND);
}

#[test]
fn erc721_lot_is_reclaimable_after_dispute() {
    let env = setup_nft();
    let a = place(env, 'A', 'SA', 12);
    let v = place(env, 'V', 'SV', 11);
    seal(env);
    let p = post(env, v);
    settle(env, 0, a.index, array![proof_above(env, a, 0), proof_forfeit()]);
    dispute_with(env, v, p);

    assert!(owner(env) == env.auction.contract_address, "nothing moved inside the dispute");
    env.auction.reclaim_lot(env.id);
    assert!(owner(env) == seller(), "the seller has it back");
}

#[test]
fn erc721_lot_is_reclaimable_after_abandon() {
    let env = setup_nft();
    place(env, 'A', 'SA', 12);
    seal(env);
    start_cheat_block_timestamp_global(ABANDON_AT);
    env.auction.abandon(env.id);
    env.auction.reclaim_lot(env.id);
    assert!(owner(env) == seller());
}

#[test]
fn erc721_lot_is_reclaimable_after_no_winner() {
    let env = setup_nft();
    seal(env);
    settle(env, 0, NO_WINNER, array![]);
    finalize(env);
    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    env.auction.reclaim_lot(env.id);
    assert!(owner(env) == seller());
}

#[test]
#[should_panic(expected: 'LOT_NOT_RECLAIMABLE')]
fn a_sold_nft_cannot_be_reclaimed() {
    let env = setup_nft();
    let a = place(env, 'A', 'SA', 12);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);
    env.auction.reclaim_lot(env.id);
}

fn disputed_with_frozen_lot() -> super::common::Env {
    let env = setup_nft();
    let a = place(env, 'A', 'SA', 12);
    let v = place(env, 'V', 'SV', 11);
    seal(env);
    let p = post(env, v);
    settle(env, 0, a.index, array![proof_above(env, a, 0), proof_forfeit()]);
    nft_admin(env.lot.contract_address).set_frozen(true);
    dispute_with(env, v, p);
    env
}

/// The lot returns to the seller by a separate pull, so a lot contract that reverts —
/// paused, or controlled by the seller — cannot hold up a dispute or any bidder's collect.
#[test]
fn a_reverting_lot_token_cannot_block_a_dispute() {
    let env = disputed_with_frozen_lot();
    assert!(env.auction.get_state(env.id).status == Status::Cancelled);
    assert!(collect(env, 1, 'V') == CAP + BOND, "the bidder is paid regardless");
    assert!(collect(env, 0, 'A') == CAP);
    // Once the collection works again, the seller takes the lot back.
    nft_admin(env.lot.contract_address).set_frozen(false);
    env.auction.reclaim_lot(env.id);
    assert!(owner(env) == seller());
}

/// While the collection refuses transfers, only the seller's own reclaim waits on it.
#[test]
#[should_panic(expected: 'TOKEN_FROZEN')]
fn reclaiming_a_frozen_lot_waits_for_the_collection() {
    let env = disputed_with_frozen_lot();
    env.auction.reclaim_lot(env.id);
}

/// A contract that cannot hold NFTs refuses the safe transfer, and the whole collect
/// reverts — on chain nothing changes, so the winner retries with an account
/// (`erc721_lot_goes_to_the_winner_on_collect`).
#[test]
#[should_panic(expected: 'ENTRYPOINT_NOT_FOUND')]
fn collect_to_a_non_receiver_contract_reverts() {
    let env = setup_nft();
    let a = place(env, 'A', 'SA', 12);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);
    // A deployed contract with no receiver interface: the payment token itself.
    env.auction.collect(env.id, a.index, 'A', payout(), env.pay.contract_address);
}

#[test]
#[should_panic(expected: 'ZERO_RECIPIENT')]
fn the_winner_must_name_somewhere_for_the_lot() {
    let env = setup_nft();
    let a = place(env, 'A', 'SA', 12);
    seal(env);
    settle(env, 0, a.index, array![proof_above(env, a, 0)]);
    finalize(env);
    env.auction.collect(env.id, a.index, 'A', payout(), 0.try_into().unwrap());
}

/// Conservation, for an NFT lot: the payment token ends at zero and the NFT ends with
/// the winner, checked at every stage.
#[test]
fn an_nft_lifecycle_conserves_value() {
    let env = setup_nft();
    let auction = env.auction.contract_address;
    assert!(owner(env) == auction);
    assert!(balance(env.pay, auction) == BOND);
    let a = place(env, 'A', 'SA', 12);
    let b = place(env, 'B', 'SB', 9);
    assert!(balance(env.pay, auction) == BOND + CAP * 2);
    seal(env);
    settle(env, 9, a.index, array![proof_above(env, a, 9), proof_exactly(env, b, 9)]);
    finalize(env);
    assert!(balance(env.pay, auction) == BOND + CAP * 2, "finalize moves nothing");
    let price = RESERVE + 9 * TICK;
    assert!(collect(env, b.index, 'B') == CAP);
    assert!(collect(env, a.index, 'A') == CAP - price);
    env.auction.withdraw_seller(env.id);
    assert!(balance(env.pay, auction) == 0, "no payment token left");
    assert!(owner(env) == payout(), "the NFT is with the winner");
}
