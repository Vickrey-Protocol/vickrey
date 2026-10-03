//! The client reads `AuctionConfig`, `AuctionState` and `Bid` positionally, and one
//! decoder has to read both the v1 and the v2 contracts while v1 escrow is still
//! claimable. These pin all three to the exact v1 serialization: if any test here
//! fails, a client somewhere is reading the wrong field.

use auction::types::{AuctionConfig, AuctionKind, AuctionState, Bid, Disposition, LotKind, Status};

#[test]
fn auction_config_serializes_exactly_as_v1() {
    let c = AuctionConfig {
        seller: 0x10.try_into().unwrap(),
        auctioneer: 0x11.try_into().unwrap(),
        payment_token: 0x12.try_into().unwrap(),
        lot_token: 0x13.try_into().unwrap(),
        lot_amount: 0x14,
        kind: AuctionKind::Vickrey,
        reserve_price: 0x16,
        tick: 0x17,
        num_levels: 0x18,
        bid_deadline: 0x19,
        dispute_window: 0x1a,
        auctioneer_bond: 0x1b,
        terms_hash: 0x1c,
    };
    let mut out: Array<felt252> = array![];
    Serde::serialize(@c, ref out);
    let expected = array![
        0x10, 0x11, 0x12, 0x13, 0x14, 1, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
    ];
    assert!(out == expected, "AuctionConfig moved");
}

#[test]
fn auction_state_serializes_exactly_as_v1() {
    let s = AuctionState {
        status: Status::Settled,
        bid_count: 0x21,
        bid_root: 0x22,
        sealed_at_block: 0x23,
        sealed_at_time: 0x24,
        clearing_level: 0x25,
        winner_index: 0x26,
        settled_at: 0x27,
        dispute_deadline: 0x28,
        lot_claimed: true,
        proceeds_paid: false,
    };
    let mut out: Array<felt252> = array![];
    Serde::serialize(@s, ref out);
    let expected = array![3, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 1, 0];
    assert!(out == expected, "AuctionState moved");
}

#[test]
fn bid_serializes_exactly_as_v1() {
    let b = Bid {
        claim_commitment: 0x31,
        up_anchor: 0x32,
        down_anchor: 0x33,
        escrow: 0x34,
        disposition: Disposition::Forfeit,
        claimed: true,
    };
    let mut out: Array<felt252> = array![];
    Serde::serialize(@b, ref out);
    assert!(out == array![0x31, 0x32, 0x33, 0x34, 4, 1], "Bid moved");
}

/// Enum indices the client hardcodes. `AuctionKind`'s storage default moved to Vickrey
/// in v2; its wire index must not have.
#[test]
fn enum_indices_are_unchanged() {
    let mut out: Array<felt252> = array![];
    Serde::serialize(@AuctionKind::FirstPrice, ref out);
    Serde::serialize(@AuctionKind::Vickrey, ref out);
    Serde::serialize(@Status::Cancelled, ref out);
    Serde::serialize(@Disposition::Forfeit, ref out);
    Serde::serialize(@LotKind::Erc20, ref out);
    Serde::serialize(@LotKind::Erc721, ref out);
    Serde::serialize(@LotKind::OffChain, ref out);
    assert!(out == array![0, 1, 5, 4, 0, 1, 2]);
}
