//! Thermometer (hash-chain) commitments over a public price ladder.
//!
//! A bid is a level `l` in `[0, P)` on a public ladder. Each bid publishes two
//! anchors derived from a secret seed the bidder never shares before sealing:
//!
//! ```text
//!   step(x) = poseidon([CHAIN_TAG, auction_id, claim_commitment, x])
//!
//!   up_anchor   = step^( l )       revealing w with step^t(w) == up_anchor
//!                                  proves  l >= t
//!   down_anchor = step^(P-1-l)     revealing w with step^(P-1-t)(w) == down_anchor
//!                                  proves  l <= t
//! ```
//!
//! Both directions are one-way: producing a witness for a bound the bidder did not
//! commit to is a Poseidon preimage break. Neither witness reveals `l`.
//!
//! `up_anchor` at `t = 0` and `down_anchor` at `t = P-1` are trivially satisfiable by
//! presenting the anchor itself. That is correct, not a hole: every level is `>= 0`
//! and `<= P-1`.

use core::poseidon::poseidon_hash_span;

/// Domain separation. Every tag is versioned so a hash minted for one purpose can
/// never be replayed in another.
pub const CHAIN_TAG: felt252 = 'VICKREY_CHAIN:V1';
pub const UP_SEED_TAG: felt252 = 'VICKREY_UP_SEED:V1';
pub const DOWN_SEED_TAG: felt252 = 'VICKREY_DOWN_SEED:V1';
pub const CLAIM_TAG: felt252 = 'VICKREY_CLAIM:V1';
pub const BID_ROOT_TAG: felt252 = 'VICKREY_BID_ROOT:V1';

/// Upper bound on ladder size, so the worst-case settlement gas is an explicit,
/// auditable number rather than an accident. See PHASE0.md Q3.
pub const MAX_LEVELS: u16 = 1024;

/// Three minutes: short enough that an auction can be listed, bid in, settled and
/// finalized inside a demo, long enough that a watching bidder can actually dispute.
/// Only appropriate when the amounts are nominal and the bidders are in the room.
pub const DEMO_DISPUTE_WINDOW: u64 = 180;

/// Twenty-four hours. What real value deserves: a bidder who was wrongly excluded has
/// to notice the `Settled` event and get a transaction in, and that cannot assume they
/// were watching. Neither value is enforced — see `AuctionConfig::dispute_window`.
pub const SUGGESTED_DISPUTE_WINDOW: u64 = 86400;

/// One step of a bid's hash chain. The chain is bound to the auction and to the
/// bid's claim commitment, so a chain minted for one bid is worthless in another.
pub fn step(auction_id: u64, claim_commitment: felt252, x: felt252) -> felt252 {
    poseidon_hash_span([CHAIN_TAG, auction_id.into(), claim_commitment, x].span())
}

/// `step` applied `n` times.
pub fn step_n(auction_id: u64, claim_commitment: felt252, x: felt252, n: u16) -> felt252 {
    let mut acc = x;
    let mut i: u16 = 0;
    while i < n {
        acc = step(auction_id, claim_commitment, acc);
        i += 1;
    }
    acc
}

/// The public handle a bid is filed under. No bidder address ever reaches the
/// contract; a refund is claimed by presenting the preimage. See PHASE0.md Q6.
pub fn claim_commitment_of(claim_secret: felt252) -> felt252 {
    poseidon_hash_span([CLAIM_TAG, claim_secret].span())
}

/// Root of the ascending chain, derived from the bid seed.
pub fn up_seed(seed: felt252) -> felt252 {
    poseidon_hash_span([UP_SEED_TAG, seed].span())
}

/// Root of the descending chain, derived from the same bid seed.
pub fn down_seed(seed: felt252) -> felt252 {
    poseidon_hash_span([DOWN_SEED_TAG, seed].span())
}

/// Builds the ascending anchor for a bid at `level`.
pub fn up_anchor(auction_id: u64, claim_commitment: felt252, seed: felt252, level: u16) -> felt252 {
    step_n(auction_id, claim_commitment, up_seed(seed), level)
}

/// Builds the descending anchor for a bid at `level` on a ladder of `num_levels`.
pub fn down_anchor(
    auction_id: u64, claim_commitment: felt252, seed: felt252, level: u16, num_levels: u16,
) -> felt252 {
    step_n(auction_id, claim_commitment, down_seed(seed), num_levels - 1 - level)
}

/// Witness proving `level >= t`. A bid can only vouch for bounds it actually meets.
pub fn witness_at_or_above(
    auction_id: u64, claim_commitment: felt252, seed: felt252, level: u16, t: u16,
) -> felt252 {
    assert(t <= level, 'BID_IS_BELOW_THAT_BOUND');
    step_n(auction_id, claim_commitment, up_seed(seed), level - t)
}

/// Witness proving `level <= t`. A bid can only vouch for bounds it actually meets.
pub fn witness_at_or_below(
    auction_id: u64, claim_commitment: felt252, seed: felt252, level: u16, t: u16,
) -> felt252 {
    assert(t >= level, 'BID_IS_ABOVE_THAT_BOUND');
    step_n(auction_id, claim_commitment, down_seed(seed), t - level)
}

/// Verifies `level >= t` against the published ascending anchor.
pub fn verify_at_or_above(
    auction_id: u64, claim_commitment: felt252, up_anchor: felt252, t: u16, witness: felt252,
) -> bool {
    step_n(auction_id, claim_commitment, witness, t) == up_anchor
}

/// Verifies `level <= t` against the published descending anchor.
pub fn verify_at_or_below(
    auction_id: u64,
    claim_commitment: felt252,
    down_anchor: felt252,
    num_levels: u16,
    t: u16,
    witness: felt252,
) -> bool {
    if t >= num_levels {
        return false;
    }
    step_n(auction_id, claim_commitment, witness, num_levels - 1 - t) == down_anchor
}

/// Running commitment over the bid set. Updated on every arrival and frozen by
/// `seal`, so the set the auctioneer settles against is fixed on-chain before it can
/// learn a single amount. This is property 3.
pub fn extend_bid_root(
    prev: felt252, index: u32, claim_commitment: felt252, up: felt252, down: felt252,
) -> felt252 {
    poseidon_hash_span([BID_ROOT_TAG, prev, index.into(), claim_commitment, up, down].span())
}
