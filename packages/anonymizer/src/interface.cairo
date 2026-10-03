use starknet::ContractAddress;
use crate::privacy_objects::OpenNoteDeposit;

/// Which leg of the auction this pool transaction is driving.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum AuctionOperation {
    /// Escrow collateral and record a bid. Returns an empty span: the funds move on
    /// to the auction contract and there is nothing for the pool to credit yet.
    PlaceBid,
    /// Collect everything a bid is owed in one leg: a loser's refund, or the winner's
    /// surplus and lot together. Payment-token proceeds land in `note_id`; an ERC-20 lot
    /// in a different token lands in `lot_note_id`. An NFT or off-chain lot goes to
    /// `lot_recipient` instead, because the pool cannot hold it.
    Collect,
    /// Collect a forfeited bid's escrow, presenting the loser-side proof late.
    RedeemForfeit,
}

#[starknet::interface]
pub trait IAuctionAnonymizer<T> {
    /// Called by the privacy pool through the protocol's `INVOKE_SELECTOR`. The pool
    /// deserializes its calldata straight into these parameters, so the dapp's
    /// calldata order must match this signature exactly.
    ///
    /// Unused parameters for a given operation are ignored, following the escrow
    /// helper's convention.
    fn privacy_invoke(
        ref self: T,
        operation: AuctionOperation,
        auction_id: u64,
        bid_index: u32,
        claim_commitment: felt252,
        up_anchor: felt252,
        down_anchor: felt252,
        claim_secret: felt252,
        witness_down: felt252,
        note_id: felt252,
        lot_note_id: felt252,
        lot_recipient: ContractAddress,
    ) -> Span<OpenNoteDeposit>;

    fn privacy_contract(self: @T) -> starknet::ContractAddress;
    fn auction_contract(self: @T) -> starknet::ContractAddress;
}
