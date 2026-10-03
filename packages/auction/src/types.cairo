use starknet::ContractAddress;

/// Sentinel for "this auction has no winner" (zero bids, or every bid forfeited).
pub const NO_WINNER: u32 = 0xffffffff;

/// Serialized as the variant index (FirstPrice 0, Vickrey 1), unchanged from v1.
/// `#[default]` — what an unwritten storage slot reads as — moved to Vickrey, the kind
/// this product is built around. Every listing writes its kind, so this changes no
/// stored auction; it only stops an empty read from looking like a first-price one.
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum AuctionKind {
    /// Highest bidder wins and pays their own bid. The winner's bid necessarily
    /// becomes public; the losers' never do.
    FirstPrice,
    /// Highest bidder wins and pays the second-highest bid. Nobody's bid is ever
    /// published, including the winner's.
    #[default]
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
    /// No valid proof was supplied. Excluded from the ranking. On a finalized auction the
    /// escrow is redeemable only by proving the bid was at or below the clearing level;
    /// above it, the escrow stays in the contract.
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
    /// Receives the proceeds, posts the lot and the bond. If the auction is cancelled the
    /// lot comes back; the bond comes back too unless the auction was abandoned or a
    /// dispute succeeded.
    pub seller: ContractAddress,
    /// The only address allowed to call `settle`. May equal `seller`.
    pub auctioneer: ContractAddress,
    /// Token bids are denominated and escrowed in.
    pub payment_token: ContractAddress,
    /// The lot's contract: an ERC-20 token or an ERC-721 collection. Zero for an
    /// off-chain lot. Which one is `AuctionExtras::lot_kind`.
    pub lot_token: ContractAddress,
    /// ERC-20: the amount. ERC-721: always 1. Off-chain: 0.
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
    /// Seconds after `settle` during which a bid left out of the settlement can void it.
    /// Also the auctioneer's time to settle once the reveal window closes.
    ///
    /// Deliberately left unconstrained rather than given a floor. Any floor low
    /// enough for a live demo would be far too low for real value, and the value is
    /// public at listing, so a bidder can read it and decline. See
    /// `ladder::DEMO_DISPUTE_WINDOW` and `ladder::SUGGESTED_DISPUTE_WINDOW` for the
    /// two ends of that range, and README "The dispute window" for the reasoning.
    pub dispute_window: u64,
    /// Credited to the bid that wins a dispute; paid to the bidders if the auction is
    /// abandoned; owed back to the seller otherwise.
    pub auctioneer_bond: u128,
    /// Poseidon over the serialized terms text, computed by the contract when terms are
    /// given at listing, so the published text and this hash cannot disagree. Without
    /// terms it is whatever the seller supplied, and the contract never interprets it.
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
    /// Escrowed collateral, later overwritten with the amount still owed to the bid. A
    /// successful dispute adds the auctioneer's bond here.
    pub escrow: u128,
    pub disposition: Disposition,
    pub claimed: bool,
}

/// What is being sold. Stored beside the config rather than in it, so `AuctionConfig`
/// keeps the exact v1 serialization the client reads positionally.
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum LotKind {
    /// `lot_amount` of the ERC-20 at `lot_token`, escrowed at listing.
    #[default]
    Erc20,
    /// Token `lot_token_id` of the ERC-721 collection at `lot_token`, escrowed at listing.
    Erc721,
    /// Nothing on chain. Described by the terms text; delivered by the seller off chain,
    /// with the winner's payment held until delivery is confirmed or the window lapses.
    OffChain,
}

/// Everything v2 fixes at listing beyond `AuctionConfig`. Public by design.
#[derive(Copy, Drop, Serde, Debug, starknet::Store)]
pub struct AuctionExtras {
    pub lot_kind: LotKind,
    /// ERC-721 only. Zero otherwise.
    pub lot_token_id: u256,
    /// The auctioneer's per-auction STARK-curve public key. Bidders encrypt their reveal
    /// to it on chain. Fresh for every auction, and deleted by the auctioneer once the
    /// auction is final.
    pub reveal_key_x: felt252,
    pub reveal_key_y: felt252,
    /// Seconds after `seal` during which reveals may be posted. `settle` waits for it.
    pub reveal_window: u64,
    /// Off-chain lots: seconds after `finalize` the buyer has to confirm or reject.
    pub delivery_window: u64,
    /// Off-chain lots: posted by the seller at listing, in the payment token. Destroyed
    /// with the price if the buyer rejects delivery. Zero for on-chain lots.
    pub seller_bond: u128,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum DeliveryOutcome {
    /// Not an off-chain lot with a winner, or not finalized yet.
    #[default]
    None,
    /// Price and seller bond held, waiting on the buyer or the deadline.
    Pending,
    /// The buyer confirmed. Price and bond are owed to the seller.
    Confirmed,
    /// The buyer rejected before the deadline. Price and bond stay locked for good.
    Rejected,
    /// The deadline passed without a rejection. Price and bond are owed to the seller.
    Released,
}

/// The off-chain lot's delivery escrow.
#[derive(Copy, Drop, Serde, Debug, starknet::Store)]
pub struct Delivery {
    /// The address the winner named at `collect`. Only it may confirm or reject. Zero
    /// until the winner collects.
    pub buyer: ContractAddress,
    pub deadline: u64,
    pub outcome: DeliveryOutcome,
    /// The clearing price, held.
    pub price: u128,
}

/// Returned by `bid_index_of` when no bid carries the anchor.
pub const NO_BID: u32 = 0xffffffff;
