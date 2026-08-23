//! Pins the wire format this helper shares with the pool.
//!
//! `OpenNoteDeposit` is declared locally rather than imported from the
//! `starknet-privacy` monorepo, so its serialization must be held still deliberately.
//! If this test starts failing, the pool will reject every return value this contract
//! makes — check `packages/anonymizer/src/privacy_objects.cairo` against upstream.

use anonymizer::interface::AuctionOperation;
use anonymizer::privacy_objects::OpenNoteDeposit;
use starknet::ContractAddress;

#[test]
fn open_note_deposit_serializes_as_note_id_token_amount() {
    let token: ContractAddress = 0x1234.try_into().unwrap();
    let deposit = OpenNoteDeposit { note_id: 0xAAA, token, amount: 777 };

    let mut out: Array<felt252> = array![];
    Serde::serialize(@deposit, ref out);

    assert!(out.len() == 3, "three felts: note_id, token, amount");
    assert!(*out.at(0) == 0xAAA);
    assert!(*out.at(1) == 0x1234);
    assert!(*out.at(2) == 777);
}

#[test]
fn a_span_of_deposits_serializes_length_first() {
    let token: ContractAddress = 0x1.try_into().unwrap();
    let deposits = [OpenNoteDeposit { note_id: 1, token, amount: 2 }].span();

    let mut out: Array<felt252> = array![];
    Serde::serialize(@deposits, ref out);

    assert!(out.len() == 4, "length prefix plus one three-felt struct");
    assert!(*out.at(0) == 1);
}

/// The dapp sends the operation as a bare variant index. If these move, every
/// existing calldata template in the web app silently targets the wrong leg.
#[test]
fn operation_variants_keep_their_indices() {
    let cases = array![
        (AuctionOperation::PlaceBid, 0), (AuctionOperation::ClaimRefund, 1),
        (AuctionOperation::RedeemForfeit, 2), (AuctionOperation::ClaimLot, 3),
    ];
    let mut i = 0;
    while i < cases.len() {
        let (op, expected) = *cases.at(i);
        let mut out: Array<felt252> = array![];
        Serde::serialize(@op, ref out);
        assert!(out.len() == 1);
        assert!(*out.at(0) == expected, "operation index moved");
        i += 1;
    }
}
