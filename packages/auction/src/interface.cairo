use starknet::ContractAddress;
use crate::types::{AuctionConfig, AuctionExtras, AuctionState, Bid, Delivery, DispositionProof};

#[starknet::interface]
pub trait ISealedBidAuction<T> {
    // ---- lifecycle -------------------------------------------------------------

    /// Lists an auction. Pulls the lot, the auctioneer bond and (off-chain lots) the
    /// seller bond from the caller, who is recorded as the seller. When `terms` is not
    /// empty it is published in `LotTerms` and its hash replaces `config.terms_hash`.
    fn create_auction(
        ref self: T, config: AuctionConfig, extras: AuctionExtras, terms: ByteArray,
    ) -> u64;

    /// Records an arriving bid and pulls its collateral. Called by the anonymizer on
    /// behalf of a bidder whose address never appears here, or by a bidder directly.
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

    /// Posts a bid's reveal, encrypted to the auctioneer's key (see `reveal.cairo`).
    /// Permissionless: its validity is checked only if it is ever opened in a dispute.
    /// Accepted from `seal` until the reveal window closes.
    fn post_reveal(
        ref self: T,
        auction_id: u64,
        bid_index: u32,
        eph_x: felt252,
        c_seed: felt252,
        c_level: felt252,
    );

    /// Proves and records the outcome. Moves no funds. Not before the reveal window
    /// has closed.
    fn settle(
        ref self: T,
        auction_id: u64,
        clearing_level: u16,
        winner_index: u32,
        proofs: Span<DispositionProof>,
    );

    /// Voids a settlement that left out a bid the auctioneer could have settled.
    ///
    /// Succeeds only for a bid recorded as forfeited, by opening a reveal for it that was
    /// posted inside the window and reproduces both of its anchors, and only if that bid
    /// changes the outcome: above the clearing level, or any valid bid at all when the
    /// settlement named no winner. The auctioneer's bond is credited to that bid.
    fn dispute(
        ref self: T, auction_id: u64, bid_index: u32, r: felt252, c_seed: felt252, c_level: felt252,
    );

    /// Closes a clean dispute window. Credits the seller with the price and the bond,
    /// except for an off-chain lot, whose price waits on delivery.
    fn finalize(ref self: T, auction_id: u64);

    /// Cancels a sealed auction whose auctioneer never settled it.
    ///
    /// Permissionless, once the reveal window and then `dispute_window` have elapsed
    /// since sealing. Without it an auctioneer who walks away locks every bidder's
    /// collateral, the lot and the bond in the contract permanently.
    fn abandon(ref self: T, auction_id: u64);

    // ---- claims ----------------------------------------------------------------

    /// Collects everything a bid is owed, in one call: its escrow (and abandon's bond
    /// share), and for the winner the lot as well.
    ///
    /// One call because the claim secret is in calldata. Once any claim lands the secret
    /// is public, so nothing it unlocks may be left behind. The lot goes to
    /// `lot_recipient`; for an off-chain lot that address becomes the buyer, the only one
    /// allowed to confirm or reject delivery. Returns the payment-token amount sent.
    fn collect(
        ref self: T,
        auction_id: u64,
        bid_index: u32,
        claim_secret: felt252,
        recipient: ContractAddress,
        lot_recipient: ContractAddress,
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

    // ---- the seller's side -------------------------------------------------------

    /// Pays the seller everything owed in the payment token: proceeds, bonds that came
    /// back. Anyone may call it; it only ever pays the seller. Separate from the steps
    /// that create the debt, so a token that refuses the seller cannot block them.
    fn withdraw_seller(ref self: T, auction_id: u64) -> u128;

    /// Returns an unsold lot to the seller. Anyone may call it. Separate from `dispute`,
    /// `abandon` and `finalize` for the same reason: a lot token that reverts must not be
    /// able to stop a dispute.
    fn reclaim_lot(ref self: T, auction_id: u64);

    // ---- off-chain lots ----------------------------------------------------------

    /// The buyer confirms delivery. The held price and the seller bond go to the seller.
    fn confirm_delivery(ref self: T, auction_id: u64);

    /// The buyer rejects delivery, before the deadline. The held price and the seller
    /// bond stay in the contract permanently. Nobody receives them.
    fn reject_delivery(ref self: T, auction_id: u64);

    /// After the deadline with no rejection, anyone releases the price and the bond to
    /// the seller.
    fn release_proceeds(ref self: T, auction_id: u64);

    // ---- views -----------------------------------------------------------------

    fn get_config(self: @T, auction_id: u64) -> AuctionConfig;
    fn get_state(self: @T, auction_id: u64) -> AuctionState;
    fn get_bid(self: @T, auction_id: u64, index: u32) -> Bid;
    fn get_extras(self: @T, auction_id: u64) -> AuctionExtras;
    fn get_delivery(self: @T, auction_id: u64) -> Delivery;
    /// The index of the bid carrying this anchor (up or down), or `NO_BID`.
    fn bid_index_of(self: @T, auction_id: u64, anchor: felt252) -> u32;
    fn reveal_posted(
        self: @T,
        auction_id: u64,
        bid_index: u32,
        eph_x: felt252,
        c_seed: felt252,
        c_level: felt252,
    ) -> bool;
    fn seller_owed(self: @T, auction_id: u64) -> u128;
    fn lot_reclaimable(self: @T, auction_id: u64) -> bool;
    /// The uniform amount every bidder escrows: the price at the top of the ladder.
    fn collateral(self: @T, auction_id: u64) -> u128;
    fn price_of_level(self: @T, auction_id: u64, level: u16) -> u128;
    fn auction_count(self: @T) -> u64;
}
