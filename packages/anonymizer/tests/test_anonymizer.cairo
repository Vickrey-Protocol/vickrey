//! End-to-end through a stand-in pool: bid, settle, and take everything back out as
//! open notes. Proves the sandwich shape the real pool enforces.

use anonymizer::interface::{
    AuctionOperation, IAuctionAnonymizerDispatcher, IAuctionAnonymizerDispatcherTrait,
};
use anonymizer::mocks::{IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use auction::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use auction::interface::{ISealedBidAuctionDispatcher, ISealedBidAuctionDispatcherTrait};
use auction::ladder;
use auction::types::{AuctionConfig, AuctionKind, DispositionProof, ProofKind};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

const RESERVE: u128 = 100;
const TICK: u128 = 10;
const LEVELS: u16 = 16;
const CAP: u128 = 250;
const DEADLINE: u64 = 1000;
const WINDOW: u64 = 100;
const LOT: u128 = 1;

fn seller() -> ContractAddress {
    'SELLER'.try_into().unwrap()
}
fn auctioneer() -> ContractAddress {
    'AUCTIONEER'.try_into().unwrap()
}
fn bank() -> ContractAddress {
    'BANK'.try_into().unwrap()
}
fn outsider() -> ContractAddress {
    'OUTSIDER'.try_into().unwrap()
}

#[derive(Copy, Drop)]
struct Rig {
    auction: ISealedBidAuctionDispatcher,
    helper: IAuctionAnonymizerDispatcher,
    pool: IMockPrivacyPoolDispatcher,
    pay: IERC20Dispatcher,
    lot: IERC20Dispatcher,
    id: u64,
}

fn deploy_token(recipient: ContractAddress, supply: u256) -> IERC20Dispatcher {
    let class = declare("MockERC20").unwrap().contract_class();
    let mut cd: Array<felt252> = array![];
    Serde::serialize(@recipient, ref cd);
    Serde::serialize(@supply, ref cd);
    let (addr, _) = class.deploy(@cd).unwrap();
    IERC20Dispatcher { contract_address: addr }
}

fn send(token: IERC20Dispatcher, from: ContractAddress, to: ContractAddress, amount: u128) {
    start_cheat_caller_address(token.contract_address, from);
    token.transfer(to, amount.into());
    stop_cheat_caller_address(token.contract_address);
}

fn setup() -> Rig {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);
    let lot = deploy_token(bank(), 1_000_u256);

    let (auction_addr, _) = declare("SealedBidAuction")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let (pool_addr, _) = declare("MockPrivacyPool")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let (helper_addr, _) = declare("AuctionAnonymizer")
        .unwrap()
        .contract_class()
        .deploy(@array![pool_addr.into(), auction_addr.into()])
        .unwrap();

    let auction = ISealedBidAuctionDispatcher { contract_address: auction_addr };

    send(lot, bank(), seller(), LOT);
    start_cheat_caller_address(lot.contract_address, seller());
    lot.approve(auction_addr, LOT.into());
    stop_cheat_caller_address(lot.contract_address);

    let config = AuctionConfig {
        seller: seller(),
        auctioneer: auctioneer(),
        payment_token: pay.contract_address,
        lot_token: lot.contract_address,
        lot_amount: LOT,
        kind: AuctionKind::Vickrey,
        reserve_price: RESERVE,
        tick: TICK,
        num_levels: LEVELS,
        bid_deadline: DEADLINE,
        dispute_window: WINDOW,
        auctioneer_bond: 0,
        terms_hash: 'LOT',
    };
    start_cheat_caller_address(auction_addr, seller());
    let id = auction.create_auction(config);
    stop_cheat_caller_address(auction_addr);

    Rig {
        auction,
        helper: IAuctionAnonymizerDispatcher { contract_address: helper_addr },
        pool: IMockPrivacyPoolDispatcher { contract_address: pool_addr },
        pay,
        lot,
        id,
    }
}

/// Drives one bid the way a wallet would: fund the pool, let it run the sandwich.
fn bid(rig: Rig, secret: felt252, seed: felt252, level: u16) -> felt252 {
    let commitment = ladder::claim_commitment_of(secret);
    let up = ladder::up_anchor(rig.id, commitment, seed, level);
    let down = ladder::down_anchor(rig.id, commitment, seed, level, LEVELS);
    send(rig.pay, bank(), rig.pool.contract_address, CAP);
    start_cheat_caller_address(rig.pool.contract_address, bank());
    rig
        .pool
        .drive_bid(
            rig.helper.contract_address,
            rig.pay.contract_address,
            CAP,
            rig.id,
            commitment,
            up,
            down,
        );
    stop_cheat_caller_address(rig.pool.contract_address);
    commitment
}

#[test]
fn a_bid_placed_through_the_pool_credits_no_note_and_parks_the_collateral() {
    let rig = setup();
    bid(rig, 'A', 'SA', 12);

    assert!(rig.auction.get_state(rig.id).bid_count == 1);
    assert!(rig.pay.balance_of(rig.auction.contract_address) == CAP.into(), "collateral parked");
    assert!(rig.pay.balance_of(rig.helper.contract_address) == 0, "helper holds nothing after");
}

#[test]
fn refund_surplus_and_lot_all_come_back_as_open_notes() {
    let rig = setup();
    let a_commit = ladder::claim_commitment_of('A');
    bid(rig, 'A', 'SA', 12);
    bid(rig, 'B', 'SB', 9);

    start_cheat_block_timestamp_global(DEADLINE);
    rig.auction.seal(rig.id);

    let b_commit = ladder::claim_commitment_of('B');
    let proofs: Array<DispositionProof> = array![
        DispositionProof {
            kind: ProofKind::AtOrAbove,
            witness_up: ladder::witness_at_or_above(rig.id, a_commit, 'SA', 12, 9),
            witness_down: 0,
        },
        DispositionProof {
            kind: ProofKind::Exactly,
            witness_up: ladder::witness_at_or_above(rig.id, b_commit, 'SB', 9, 9),
            witness_down: ladder::witness_at_or_below(rig.id, b_commit, 'SB', 9, 9),
        },
    ];
    start_cheat_caller_address(rig.auction.contract_address, auctioneer());
    rig.auction.settle(rig.id, 9, 0, proofs.span());
    stop_cheat_caller_address(rig.auction.contract_address);

    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    rig.auction.finalize(rig.id);

    let price = RESERVE + 9 * TICK;
    let pool_before = rig.pay.balance_of(rig.pool.contract_address);

    // The loser's collateral comes home as a note.
    let deposits = rig
        .pool
        .drive_claim(
            rig.helper.contract_address, AuctionOperation::ClaimRefund, rig.id, 1, 'B', 0, 'NOTE_A',
        );
    assert!(deposits.len() == 1, "one note credited");
    assert!((*deposits.at(0)).amount == CAP);
    assert!((*deposits.at(0)).note_id == 'NOTE_A');
    assert!((*deposits.at(0)).token == rig.pay.contract_address);
    assert!(rig.pay.balance_of(rig.pool.contract_address) == pool_before + CAP.into());

    // The winner's surplus does too, so the winning bid stays unpublished.
    let surplus = rig
        .pool
        .drive_claim(
            rig.helper.contract_address, AuctionOperation::ClaimRefund, rig.id, 0, 'A', 0, 'NOTE_B',
        );
    assert!((*surplus.at(0)).amount == CAP - price);

    // And so does the lot.
    let lot_note = rig
        .pool
        .drive_claim(
            rig.helper.contract_address, AuctionOperation::ClaimLot, rig.id, 0, 'A', 0, 'NOTE_C',
        );
    assert!((*lot_note.at(0)).amount == LOT);
    assert!((*lot_note.at(0)).token == rig.lot.contract_address);
    assert!(rig.lot.balance_of(rig.pool.contract_address) == LOT.into());
    assert!(rig.lot.balance_of(rig.helper.contract_address) == 0);
}

#[test]
fn a_forfeited_bid_is_redeemable_through_the_pool() {
    let rig = setup();
    let a_commit = ladder::claim_commitment_of('A');
    bid(rig, 'A', 'SA', 12);
    let b_commit = ladder::claim_commitment_of('B');
    bid(rig, 'B', 'SB', 5);
    let g_commit = ladder::claim_commitment_of('G');
    bid(rig, 'G', 'SG', 3); // goes silent after sealing

    start_cheat_block_timestamp_global(DEADLINE);
    rig.auction.seal(rig.id);

    let proofs: Array<DispositionProof> = array![
        DispositionProof {
            kind: ProofKind::AtOrAbove,
            witness_up: ladder::witness_at_or_above(rig.id, a_commit, 'SA', 12, 5),
            witness_down: 0,
        },
        DispositionProof {
            kind: ProofKind::Exactly,
            witness_up: ladder::witness_at_or_above(rig.id, b_commit, 'SB', 5, 5),
            witness_down: ladder::witness_at_or_below(rig.id, b_commit, 'SB', 5, 5),
        },
        DispositionProof { kind: ProofKind::Forfeit, witness_up: 0, witness_down: 0 },
    ];
    start_cheat_caller_address(rig.auction.contract_address, auctioneer());
    rig.auction.settle(rig.id, 5, 0, proofs.span());
    stop_cheat_caller_address(rig.auction.contract_address);
    start_cheat_block_timestamp_global(DEADLINE + WINDOW + 1);
    rig.auction.finalize(rig.id);

    let witness = ladder::witness_at_or_below(rig.id, g_commit, 'SG', 3, 5);
    let deposits = rig
        .pool
        .drive_claim(
            rig.helper.contract_address,
            AuctionOperation::RedeemForfeit,
            rig.id,
            2,
            'G',
            witness,
            'NOTE_A',
        );
    assert!((*deposits.at(0)).amount == CAP, "the silent bidder gets it all back later");
}

/// The helper handles funds mid-transaction, so it is pinned to the pool rather than
/// left permissionless.
#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn only_the_pool_may_invoke_the_helper() {
    let rig = setup();
    start_cheat_caller_address(rig.helper.contract_address, outsider());
    rig.helper.privacy_invoke(AuctionOperation::ClaimRefund, rig.id, 0, 0, 0, 0, 'A', 0, 'NOTE_A');
}
