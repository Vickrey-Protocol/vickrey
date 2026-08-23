use crate::privacy_objects::OpenNoteDeposit;

/// Which leg of the auction this pool transaction is driving.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum AuctionOperation {
    /// Escrow collateral and record a bid. Returns an empty span: the funds move on
    /// to the auction contract and there is nothing for the pool to credit yet.
    PlaceBid,
    /// Collect a settled bid's refund (a loser's collateral, or the winner's
    /// surplus) into a private note.
    ClaimRefund,
    /// Collect a forfeited bid's escrow, presenting the loser-side proof late.
    RedeemForfeit,
    /// Collect the lot into a private note.
    ClaimLot,
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
    ) -> Span<OpenNoteDeposit>;

    fn privacy_contract(self: @T) -> starknet::ContractAddress;
    fn auction_contract(self: @T) -> starknet::ContractAddress;
}
