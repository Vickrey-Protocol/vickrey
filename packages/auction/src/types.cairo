use starknet::ContractAddress;

/// Sentinel for "this auction has no winner" (zero bids, or every bid forfeited).
pub const NO_WINNER: u32 = 0xffffffff;

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum AuctionKind {
    /// Highest bidder wins and pays their own bid. The winner's bid necessarily
    /// becomes public; the losers' never do.
    #[default]
    FirstPrice,
    /// Highest bidder wins and pays the second-highest bid. Nobody's bid is ever
    /// published, including the winner's.
    Vickrey,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum Status {
    /// Does not exist.
    #[default]
    None,
    /// Accepting bids.
    Open,
    /// Bidding closed, bid set frozen. The auctioneer may now be sent seeds.
    Sealed,
    /// Outcome proved and recorded. Nothing has moved yet; the dispute window is open.
    Settled,
    /// Dispute window closed clean. Funds move.
    Finalized,
    /// A dispute succeeded, or the auction ended with nothing to award. Everything unwinds.
    Cancelled,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum Disposition {
    /// Not yet settled.
    #[default]
    Unset,
    /// Proved `level >= clearing_level`. Only the winner may hold this.
    AtOrAbove,
    /// Proved `level == clearing_level` exactly (both chains).
    Exactly,
    /// Proved `level <= clearing_level`.
    AtOrBelow,
    /// No valid proof was supplied. Excluded from the ranking; escrow retained and
    /// redeemable by its owner. See PHASE0.md, property 6.
    Forfeit,
}

/// Which claim a settlement proof makes about one bid. Serialized as its variant
/// index, so calldata is `[kind, witness_up, witness_down]` per bid.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum ProofKind {
    AtOrAbove,
    Exactly,
    AtOrBelow,
    Forfeit,
}

#[derive(Copy, Drop, Serde, Debug)]
pub struct DispositionProof {
    pub kind: ProofKind,
    /// Depth-`clearing_level` preimage of `up_anchor`. Unused for AtOrBelow/Forfeit.
    pub witness_up: felt252,
    /// Depth-`(P-1-clearing_level)` preimage of `down_anchor`. Unused for AtOrAbove/Forfeit.
    pub witness_down: felt252,
}

/// Everything fixed at listing. Public by design.
#[derive(Copy, Drop, Serde, Debug, starknet::Store)]
pub struct AuctionConfig {
    /// Receives the proceeds, posts the lot and the bond, gets both back if the
    /// auction is cancelled.
    pub seller: ContractAddress,
    /// The only address allowed to call `settle`. May equal `seller`.
    pub auctioneer: ContractAddress,
    /// Token bids are denominated and escrowed in.
    pub payment_token: ContractAddress,
    /// Token the lot is paid in, escrowed by the seller at listing.
    pub lot_token: ContractAddress,
    pub lot_amount: u128,
    pub kind: AuctionKind,
    /// Price at ladder level 0. Bidding at all means bidding at least this much, so
    /// the reserve needs no separate enforcement.
    pub reserve_price: u128,
    /// Price increment per ladder level.
    pub tick: u128,
    /// Ladder size `P`, in `2..=MAX_LEVELS`.
    pub num_levels: u16,
    pub bid_deadline: u64,
    /// Seconds after `settle` during which a forfeited bidder can void the outcome.
    ///
    /// Deliberately left unconstrained rather than given a floor. Any floor low
    /// enough for a live demo would be far too low for real value, and the value is
    /// public at listing, so a bidder can read it and decline. See
    /// `ladder::DEMO_DISPUTE_WINDOW` and `ladder::SUGGESTED_DISPUTE_WINDOW` for the
    /// two ends of that range, and README "The dispute window" for the reasoning.
    pub dispute_window: u64,
    /// Slashed to a successful disputer, returned to the seller otherwise.
    pub auctioneer_bond: u128,
    /// Hash of the off-chain lot description. The contract never interprets it.
    pub terms_hash: felt252,
}

#[derive(Copy, Drop, Serde, Debug, starknet::Store)]
pub struct AuctionState {
    pub status: Status,
    pub bid_count: u32,
    /// Running commitment over the arrived bid set. Frozen by `seal`.
    pub bid_root: felt252,
    /// Stamped from the block itself at `seal`, never from a caller-supplied value.
    pub sealed_at_block: u64,
    pub sealed_at_time: u64,
    pub clearing_level: u16,
    pub winner_index: u32,
    pub settled_at: u64,
    pub dispute_deadline: u64,
    pub lot_claimed: bool,
    pub proceeds_paid: bool,
}

#[derive(Copy, Drop, Serde, Debug, starknet::Store)]
pub struct Bid {
    /// `poseidon([CLAIM_TAG, claim_secret])`. The bid's only identity.
    pub claim_commitment: felt252,
    pub up_anchor: felt252,
    pub down_anchor: felt252,
    /// Escrowed collateral, later overwritten with the amount still owed to the bid.
    pub escrow: u128,
    pub disposition: Disposition,
    pub claimed: bool,
}
