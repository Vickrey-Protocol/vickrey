//! End-to-end through a stand-in pool: bid, settle, and take everything back out as
//! open notes. Proves the sandwich shape the real pool enforces.
//!
//! v2's one leg out is `Collect`: a loser's refund, or the winner's surplus and lot
//! together — two notes in one pool transaction when they are different tokens, because
//! the claim secret is in calldata and two transactions would publish the key to the
//! second. An NFT or off-chain lot cannot enter the pool, so it goes to the public
//! address the winner names while the surplus still comes back privately.

use anonymizer::auction_anonymizer::AuctionAnonymizer;
use anonymizer::interface::{
    AuctionOperation, IAuctionAnonymizerDispatcher, IAuctionAnonymizerDispatcherTrait,
};
use anonymizer::mocks::{IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use auction::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use auction::erc721::{IERC721Dispatcher, IERC721DispatcherTrait};
use auction::interface::{ISealedBidAuctionDispatcher, ISealedBidAuctionDispatcherTrait};
use auction::mocks::{IMockERC721AdminDispatcher, IMockERC721AdminDispatcherTrait};
use auction::types::{
    AuctionConfig, AuctionExtras, AuctionKind, DispositionProof, LotKind, ProofKind, Status,
};
use auction::{ladder, reveal};
use core::ec::{EcPointTrait, stark_curve};
use core::num::traits::Zero;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_block_timestamp_global, start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

const RESERVE: u128 = 100;
const TICK: u128 = 10;
const LEVELS: u16 = 16;
const CAP: u128 = 250;
const DEADLINE: u64 = 1000;
const REVEAL: u64 = 50;
const WINDOW: u64 = 100;
const LOT: u128 = 1;
const NFT_ID: u256 = 9;
const SK: felt252 = 'AUCTIONEER_SK';

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
fn winner_wallet() -> ContractAddress {
    'FRESH_ADDRESS'.try_into().unwrap()
}

#[derive(Copy, Drop, PartialEq)]
enum Lot {
    /// An ERC-20 lot in its own token: two notes for the winner.
    OwnToken,
    /// An ERC-20 lot in the payment token: one note holding surplus and lot together.
    PaymentToken,
    Nft,
    OffChain,
}

#[derive(Copy, Drop)]
struct Rig {
    auction: ISealedBidAuctionDispatcher,
    helper: IAuctionAnonymizerDispatcher,
    pool: IMockPrivacyPoolDispatcher,
    pay: IERC20Dispatcher,
    lot: ContractAddress,
    id: u64,
}

fn deploy_token(recipient: ContractAddress, supply: u256) -> IERC20Dispatcher {
    let class = declare("MockERC20").unwrap().contract_class();
    let mut cd: Array<felt252> = array![];
    Serde::serialize(@recipient, ref cd);
    Serde::serialize(@supply, ref cd);
    let name: ByteArray = "Mock Token";
    let symbol: ByteArray = "MOCK";
    Serde::serialize(@name, ref cd);
    Serde::serialize(@symbol, ref cd);
    Serde::serialize(@18_u8, ref cd);
    let (addr, _) = class.deploy(@cd).unwrap();
    IERC20Dispatcher { contract_address: addr }
}

fn send(token: IERC20Dispatcher, from: ContractAddress, to: ContractAddress, amount: u128) {
    start_cheat_caller_address(token.contract_address, from);
    token.transfer(to, amount.into());
    stop_cheat_caller_address(token.contract_address);
}

fn approve(token: ContractAddress, owner: ContractAddress, spender: ContractAddress, amount: u128) {
    start_cheat_caller_address(token, owner);
    IERC20Dispatcher { contract_address: token }.approve(spender, amount.into());
    stop_cheat_caller_address(token);
}

fn reveal_key() -> (felt252, felt252) {
    let g: core::ec::EcPoint = EcPointTrait::new(stark_curve::GEN_X, stark_curve::GEN_Y).unwrap();
    let pk: core::ec::NonZeroEcPoint = g.mul(SK).try_into().unwrap();
    pk.coordinates()
}

fn setup() -> Rig {
    setup_lot(Lot::OwnToken)
}

fn setup_lot(lot_kind: Lot) -> Rig {
    start_cheat_block_timestamp_global(1);
    let pay = deploy_token(bank(), 1_000_000_u256);

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

    let (key_x, key_y) = reveal_key();
    let mut extras = AuctionExtras {
        lot_kind: LotKind::Erc20,
        lot_token_id: 0,
        reveal_key_x: key_x,
        reveal_key_y: key_y,
        reveal_window: REVEAL,
        delivery_window: 0,
        seller_bond: 0,
    };
    let mut terms: ByteArray = "";
    let mut lot_amount = LOT;
    let lot: ContractAddress = match lot_kind {
        Lot::OwnToken => {
            let t = deploy_token(bank(), 1_000_u256);
            send(t, bank(), seller(), LOT);
            approve(t.contract_address, seller(), auction_addr, LOT);
            t.contract_address
        },
        Lot::PaymentToken => {
            send(pay, bank(), seller(), LOT);
            pay.contract_address
        },
        Lot::Nft => {
            let (c, _) = declare("MockERC721").unwrap().contract_class().deploy(@array![]).unwrap();
            IMockERC721AdminDispatcher { contract_address: c }.mint(seller(), NFT_ID);
            start_cheat_caller_address(c, seller());
            IMockERC721AdminDispatcher { contract_address: c }.approve(auction_addr, NFT_ID);
            stop_cheat_caller_address(c);
            extras.lot_kind = LotKind::Erc721;
            extras.lot_token_id = NFT_ID;
            c
        },
        Lot::OffChain => {
            extras.lot_kind = LotKind::OffChain;
            extras.delivery_window = 500;
            extras.seller_bond = TICK;
            terms = "A framed print, collected in person.";
            lot_amount = 0;
            Zero::zero()
        },
    };

    // Bond (and the seller bond, and a payment-token lot) from the seller.
    let needed = TICK + extras.seller_bond + if lot_kind == Lot::PaymentToken {
        LOT
    } else {
        0
    };
    send(pay, bank(), seller(), TICK + extras.seller_bond);
    approve(pay.contract_address, seller(), auction_addr, needed);

    let config = AuctionConfig {
        seller: seller(),
        auctioneer: auctioneer(),
        payment_token: pay.contract_address,
        lot_token: lot,
        lot_amount,
        kind: AuctionKind::Vickrey,
        reserve_price: RESERVE,
        tick: TICK,
        num_levels: LEVELS,
        bid_deadline: DEADLINE,
        dispute_window: WINDOW,
        auctioneer_bond: TICK, // the floor: one price step at stake
        terms_hash: 'LOT',
    };
    start_cheat_caller_address(auction_addr, seller());
    let id = auction.create_auction(config, extras, terms);
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

/// Two bids — A at 12 wins, B at 9 sets the price — sealed, settled and finalized.
fn finished(rig: Rig) {
    let a = bid(rig, 'A', 'SA', 12);
    let b = bid(rig, 'B', 'SB', 9);
    start_cheat_block_timestamp_global(DEADLINE);
    rig.auction.seal(rig.id);
    let proofs: Array<DispositionProof> = array![
        DispositionProof {
            kind: ProofKind::AtOrAbove,
            witness_up: ladder::witness_at_or_above(rig.id, a, 'SA', 12, 9),
            witness_down: 0,
        },
        DispositionProof {
            kind: ProofKind::Exactly,
            witness_up: ladder::witness_at_or_above(rig.id, b, 'SB', 9, 9),
            witness_down: ladder::witness_at_or_below(rig.id, b, 'SB', 9, 9),
        },
    ];
    start_cheat_block_timestamp_global(DEADLINE + REVEAL);
    start_cheat_caller_address(rig.auction.contract_address, auctioneer());
    rig.auction.settle(rig.id, 9, 0, proofs.span());
    stop_cheat_caller_address(rig.auction.contract_address);
    start_cheat_block_timestamp_global(DEADLINE + REVEAL + WINDOW + 1);
    rig.auction.finalize(rig.id);
}

fn collect(
    rig: Rig, index: u32, secret: felt252, note: felt252, lot_note: felt252,
) -> Span<anonymizer::privacy_objects::OpenNoteDeposit> {
    rig
        .pool
        .drive_claim(
            rig.helper.contract_address,
            AuctionOperation::Collect,
            rig.id,
            index,
            secret,
            0,
            note,
            lot_note,
            winner_wallet(),
        )
}

const PRICE: u128 = RESERVE + 9 * TICK;

#[test]
fn a_bid_placed_through_the_pool_credits_no_note_and_parks_the_collateral() {
    let rig = setup();
    bid(rig, 'A', 'SA', 12);

    assert!(rig.auction.get_state(rig.id).bid_count == 1);
    assert!(
        rig.pay.balance_of(rig.auction.contract_address) == (CAP + TICK).into(),
        "collateral parked",
    );
    assert!(rig.pay.balance_of(rig.helper.contract_address) == 0, "helper holds nothing after");
}

#[test]
fn a_losers_refund_comes_back_as_one_note() {
    let rig = setup();
    finished(rig);
    let pool_before = rig.pay.balance_of(rig.pool.contract_address);
    let deposits = collect(rig, 1, 'B', 'NOTE_A', 'UNUSED');
    assert!(deposits.len() == 1, "one note credited");
    assert!((*deposits.at(0)).amount == CAP);
    assert!((*deposits.at(0)).note_id == 'NOTE_A');
    assert!((*deposits.at(0)).token == rig.pay.contract_address);
    assert!(rig.pay.balance_of(rig.pool.contract_address) == pool_before + CAP.into());
}

/// **The winner, privately, in one transaction.** Surplus and lot come out of the same
/// leg as two notes, so the claim secret is never on chain while either is uncollected,
/// and no address is linked to the win.
#[test]
fn the_winner_collects_surplus_and_lot_as_two_notes_in_one_leg() {
    let rig = setup_lot(Lot::OwnToken);
    finished(rig);
    let deposits = collect(rig, 0, 'A', 'NOTE_SURPLUS', 'NOTE_LOT');
    assert!(deposits.len() == 2, "two notes, one transaction");
    assert!((*deposits.at(0)).note_id == 'NOTE_SURPLUS');
    assert!((*deposits.at(0)).token == rig.pay.contract_address);
    assert!((*deposits.at(0)).amount == CAP - PRICE);
    assert!((*deposits.at(1)).note_id == 'NOTE_LOT');
    assert!((*deposits.at(1)).token == rig.lot);
    assert!((*deposits.at(1)).amount == LOT);
    let lot = IERC20Dispatcher { contract_address: rig.lot };
    assert!(lot.balance_of(rig.pool.contract_address) == LOT.into(), "the pool holds the lot");
    assert!(lot.balance_of(winner_wallet()) == 0, "nothing reached a public address");
    assert!(rig.pay.balance_of(winner_wallet()) == 0);
    assert!(lot.balance_of(rig.helper.contract_address) == 0, "helper holds nothing after");
    assert!(rig.pay.balance_of(rig.helper.contract_address) == 0);
}

/// A lot in the payment token arrives mixed with the surplus; both go to one note.
#[test]
fn a_payment_token_lot_and_the_surplus_share_one_note() {
    let rig = setup_lot(Lot::PaymentToken);
    finished(rig);
    let deposits = collect(rig, 0, 'A', 'NOTE_SURPLUS', 'NOTE_LOT');
    assert!(deposits.len() == 1);
    assert!((*deposits.at(0)).note_id == 'NOTE_SURPLUS');
    assert!((*deposits.at(0)).amount == CAP - PRICE + LOT);
}

/// The pool cannot hold an NFT. It goes to the address the winner named; the surplus
/// still comes back as a note.
#[test]
fn an_nft_lot_goes_to_the_named_address_and_the_surplus_to_a_note() {
    let rig = setup_lot(Lot::Nft);
    finished(rig);
    let deposits = collect(rig, 0, 'A', 'NOTE_SURPLUS', 'NOTE_LOT');
    assert!(deposits.len() == 1, "no note can carry an NFT");
    assert!((*deposits.at(0)).token == rig.pay.contract_address);
    assert!((*deposits.at(0)).amount == CAP - PRICE);
    assert!(
        IERC721Dispatcher { contract_address: rig.lot }.owner_of(NFT_ID) == winner_wallet(),
        "the NFT is at the named address",
    );
}

/// An off-chain winner names the buyer address through the same leg.
#[test]
fn an_offchain_winner_names_the_buyer_through_the_pool() {
    let rig = setup_lot(Lot::OffChain);
    finished(rig);
    let deposits = collect(rig, 0, 'A', 'NOTE_SURPLUS', 'NOTE_LOT');
    assert!(deposits.len() == 1);
    assert!(rig.auction.get_delivery(rig.id).buyer == winner_wallet());
}

#[test]
fn a_forfeited_bid_is_redeemable_through_the_pool() {
    let rig = setup();
    let a_commit = bid(rig, 'A', 'SA', 12);
    let b_commit = bid(rig, 'B', 'SB', 5);
    let g_commit = bid(rig, 'G', 'SG', 3); // goes silent after sealing

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
    start_cheat_block_timestamp_global(DEADLINE + REVEAL);
    start_cheat_caller_address(rig.auction.contract_address, auctioneer());
    rig.auction.settle(rig.id, 5, 0, proofs.span());
    stop_cheat_caller_address(rig.auction.contract_address);
    start_cheat_block_timestamp_global(DEADLINE + REVEAL + WINDOW + 1);
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
            0,
            Zero::zero(),
        );
    assert!((*deposits.at(0)).amount == CAP, "a silent bid below the price gets it all back");
}

/// The bid the auctioneer left out takes the bond, and takes it privately: the dispute
/// credits it to the bid, and the bid's own `Collect` brings escrow and bond back as one
/// note. No address is ever paid.
#[test]
fn an_excluded_bidder_collects_escrow_plus_bond_through_the_pool() {
    let rig = setup();
    let a = bid(rig, 'A', 'SA', 12);
    bid(rig, 'V', 'SV', 11);
    start_cheat_block_timestamp_global(DEADLINE);
    rig.auction.seal(rig.id);

    let (kx, ky) = reveal_key();
    let r = reveal::ephemeral_scalar('SV', rig.id, 1);
    let (eph_x, c_seed, c_level) = reveal::encrypt(r, kx, ky, rig.id, 1, 'SV', 11);
    rig.auction.post_reveal(rig.id, 1, eph_x, c_seed, c_level);

    let proofs: Array<DispositionProof> = array![
        DispositionProof {
            kind: ProofKind::AtOrAbove,
            witness_up: ladder::witness_at_or_above(rig.id, a, 'SA', 12, 0),
            witness_down: 0,
        },
        DispositionProof { kind: ProofKind::Forfeit, witness_up: 0, witness_down: 0 },
    ];
    start_cheat_block_timestamp_global(DEADLINE + REVEAL);
    start_cheat_caller_address(rig.auction.contract_address, auctioneer());
    rig.auction.settle(rig.id, 0, 0, proofs.span());
    stop_cheat_caller_address(rig.auction.contract_address);

    rig.auction.dispute(rig.id, 1, r, c_seed, c_level);
    assert!(rig.auction.get_state(rig.id).status == Status::Cancelled);

    let deposits = collect(rig, 1, 'V', 'NOTE_V', 'UNUSED');
    assert!(deposits.len() == 1);
    assert!((*deposits.at(0)).amount == CAP + TICK, "escrow plus the bond, as one note");
}

/// The helper handles funds mid-transaction, so it is pinned to the pool rather than
/// left permissionless.
#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn only_the_pool_may_invoke_the_helper() {
    let rig = setup();
    start_cheat_caller_address(rig.helper.contract_address, outsider());
    rig
        .helper
        .privacy_invoke(
            AuctionOperation::Collect, rig.id, 0, 0, 0, 0, 'A', 0, 'NOTE_A', 0, Zero::zero(),
        );
}

/// The event is what makes a pool transaction legible as *ours*.
///
/// Asserting the **exact** event also pins its shape: adding a member — `note_id`
/// above all, which would let an observer tie a private note to an auction action —
/// stops this file compiling rather than quietly widening what the contract publishes.
#[test]
fn placing_a_bid_through_the_pool_emits_routed() {
    let rig = setup();
    let mut spy = spy_events();

    bid(rig, 'A', 'SA', 12);

    spy
        .assert_emitted(
            @array![
                (
                    rig.helper.contract_address,
                    AuctionAnonymizer::Event::Routed(
                        AuctionAnonymizer::Routed {
                            auction_id: rig.id, operation: AuctionOperation::PlaceBid,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn the_collect_leg_emits_its_own_operation() {
    let rig = setup();
    finished(rig);
    let mut spy = spy_events();
    collect(rig, 1, 'B', 'NOTE_A', 'UNUSED');
    spy
        .assert_emitted(
            @array![
                (
                    rig.helper.contract_address,
                    AuctionAnonymizer::Event::Routed(
                        AuctionAnonymizer::Routed {
                            auction_id: rig.id, operation: AuctionOperation::Collect,
                        },
                    ),
                ),
            ],
        );
}
