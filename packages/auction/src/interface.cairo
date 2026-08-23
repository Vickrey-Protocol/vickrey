use starknet::ContractAddress;
use crate::types::{AuctionConfig, AuctionState, Bid, DispositionProof};

#[starknet::interface]
pub trait ISealedBidAuction<T> {
    // ---- lifecycle -------------------------------------------------------------

    /// Lists an auction. Pulls the lot and the auctioneer bond from the caller, who
    /// is recorded as the seller.
    fn create_auction(ref self: T, config: AuctionConfig) -> u64;

    /// Records an arriving bid and pulls its collateral. Called by the anonymizer on
    /// behalf of a bidder whose address never appears here.
    fn place_bid(
        ref self: T,
        auction_id: u64,
        claim_commitment: felt252,
        up_anchor: felt252,
        down_anchor: felt252,
    ) -> u32;

    /// Freezes the bid set. Permissionless, so the auctioneer cannot stall it. Stamps
    /// the block from the block itself.
    fn seal(ref self: T, auction_id: u64);

    /// Proves and records the outcome. Moves no funds.
    fn settle(
        ref self: T,
        auction_id: u64,
        clearing_level: u16,
        winner_index: u32,
        proofs: Span<DispositionProof>,
    );

    /// Voids a settlement by proving a bid sits strictly above the clearing level.
    /// Slashes the bond to the caller.
    fn dispute(ref self: T, auction_id: u64, bid_index: u32, witness_up: felt252);

    /// Closes a clean dispute window and releases proceeds, bond and refund rights.
    fn finalize(ref self: T, auction_id: u64);

    /// Cancels a sealed auction whose auctioneer never settled it.
    ///
    /// Permissionless, and only after `dispute_window` has elapsed since sealing. A
    /// sealed auction has exactly one other way out — `settle`, which only the
    /// auctioneer may call — so without this an auctioneer who walks away locks every
    /// bidder's collateral, the lot and the bond in the contract permanently.
    fn abandon(ref self: T, auction_id: u64);

    // ---- claims ----------------------------------------------------------------

    /// Collects whatever a bid is still owed. Authorized by the claim secret alone.
    fn claim_refund(
        ref self: T,
        auction_id: u64,
        bid_index: u32,
        claim_secret: felt252,
        recipient: ContractAddress,
    ) -> u128;

    /// Collects a forfeited bid's escrow by proving, late, that it was at or below
    /// the clearing level.
    fn redeem_forfeit(
        ref self: T,
        auction_id: u64,
        bid_index: u32,
        claim_secret: felt252,
        witness_down: felt252,
        recipient: ContractAddress,
    ) -> u128;

    /// Delivers the lot to whoever holds the winning bid's claim secret.
    fn claim_lot(
        ref self: T, auction_id: u64, claim_secret: felt252, recipient: ContractAddress,
    ) -> u128;

    // ---- views -----------------------------------------------------------------

    fn get_config(self: @T, auction_id: u64) -> AuctionConfig;
    fn get_state(self: @T, auction_id: u64) -> AuctionState;
    fn get_bid(self: @T, auction_id: u64, index: u32) -> Bid;
    /// The uniform amount every bidder escrows: the price at the top of the ladder.
    fn collateral(self: @T, auction_id: u64) -> u128;
    fn price_of_level(self: @T, auction_id: u64, level: u16) -> u128;
    fn auction_count(self: @T) -> u64;
}
