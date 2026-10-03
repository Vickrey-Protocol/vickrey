//! Encrypted reveals, posted on chain after the seal.
//!
//! A bidder sends the auctioneer its `(seed, level)` by encrypting them to the
//! auctioneer's per-auction STARK-curve key and posting the ciphertext with
//! `post_reveal`. That makes delivery a fact on chain: a reveal posted inside the window
//! that opens to the bid's own anchors is proof the auctioneer had everything it needed
//! to settle that bid. `dispute` asks for exactly that proof.
//!
//! ```text
//!   r        = H(EPH_TAG, seed, auction_id, bid_index) mod n     (client convention)
//!   eph_x    = (r·G).x
//!   k        = (r·PK).x            == (sk·R).x for either R = ±(r·G)
//!   c_seed   = seed  + H(PAD_TAG, k, auction_id, bid_index, 0)
//!   c_level  = level + H(PAD_TAG, k, auction_id, bid_index, 1)
//! ```
//!
//! Only `eph_x` is posted. The auctioneer recovers a point from it and gets the same `k`
//! whichever of the two y-coordinates it picks, because `sk·(-R) = -(sk·R)` and a point
//! and its negation share an x-coordinate.
//!
//! The pads bind the ciphertext to one bid of one auction, so a reveal cannot be replayed
//! onto another bid. Opening a reveal publishes its plaintext; only a disputer ever does.

use core::ec::{EcPoint, EcPointTrait, NonZeroEcPoint, stark_curve};
use core::poseidon::poseidon_hash_span;

pub const EPH_TAG: felt252 = 'VICKREY_REVEAL_EPH:V1';
pub const PAD_TAG: felt252 = 'VICKREY_REVEAL_PAD:V1';
pub const RECORD_TAG: felt252 = 'VICKREY_REVEAL:V1';

/// Whether `(x, y)` is a non-zero point on the STARK curve.
pub fn valid_key(x: felt252, y: felt252) -> bool {
    EcPointTrait::new_nz(x, y).is_some()
}

fn generator() -> EcPoint {
    EcPointTrait::new(stark_curve::GEN_X, stark_curve::GEN_Y).unwrap()
}

fn x_of(p: EcPoint) -> Option<felt252> {
    let nz: Option<NonZeroEcPoint> = p.try_into();
    match nz {
        Some(q) => Some(q.x()),
        None => None,
    }
}

/// The client's derivation of the ephemeral scalar. The contract never needs it — any
/// `r` works — but tests and the vectors use it, and it means a bidder has no extra
/// secret to keep: the seed already implies `r`.
pub fn ephemeral_scalar(seed: felt252, auction_id: u64, bid_index: u32) -> felt252 {
    let h: u256 = poseidon_hash_span([EPH_TAG, seed, auction_id.into(), bid_index.into()].span())
        .into();
    let n: u256 = stark_curve::ORDER.into();
    let r = h % n;
    // A zero scalar has no point. Astronomically unlikely; mapped to 1 so the function is
    // total and the TypeScript side can mirror it exactly.
    if r == 0 {
        1
    } else {
        r.try_into().unwrap()
    }
}

/// `(r·G).x`, the only part of the ephemeral key that is posted.
pub fn ephemeral_x(r: felt252) -> Option<felt252> {
    x_of(generator().mul(r))
}

/// `(r·PK).x`, the shared key.
pub fn shared_key(r: felt252, key_x: felt252, key_y: felt252) -> Option<felt252> {
    match EcPointTrait::new(key_x, key_y) {
        Some(pk) => x_of(pk.mul(r)),
        None => None,
    }
}

pub fn pad(k: felt252, auction_id: u64, bid_index: u32, i: felt252) -> felt252 {
    poseidon_hash_span([PAD_TAG, k, auction_id.into(), bid_index.into(), i].span())
}

/// What the contract stores per posted reveal.
pub fn record(eph_x: felt252, c_seed: felt252, c_level: felt252) -> felt252 {
    poseidon_hash_span([RECORD_TAG, eph_x, c_seed, c_level].span())
}

/// Encrypts `(seed, level)` for one bid. Returns `(eph_x, c_seed, c_level)`.
pub fn encrypt(
    r: felt252,
    key_x: felt252,
    key_y: felt252,
    auction_id: u64,
    bid_index: u32,
    seed: felt252,
    level: u16,
) -> (felt252, felt252, felt252) {
    let eph_x = ephemeral_x(r).unwrap();
    let k = shared_key(r, key_x, key_y).unwrap();
    (
        eph_x,
        seed + pad(k, auction_id, bid_index, 0),
        level.into() + pad(k, auction_id, bid_index, 1),
    )
}

/// Opens a reveal with the sender's `r`. Returns `(seed, level)` as felts; the caller
/// decides whether the level is on the ladder.
pub fn open(
    r: felt252,
    key_x: felt252,
    key_y: felt252,
    auction_id: u64,
    bid_index: u32,
    c_seed: felt252,
    c_level: felt252,
) -> Option<(felt252, felt252)> {
    let k = shared_key(r, key_x, key_y)?;
    Some((c_seed - pad(k, auction_id, bid_index, 0), c_level - pad(k, auction_id, bid_index, 1)))
}

/// What the auctioneer does with its secret key: the same plaintext, without `r`.
pub fn open_as_auctioneer(
    sk: felt252, eph_x: felt252, auction_id: u64, bid_index: u32, c_seed: felt252, c_level: felt252,
) -> Option<(felt252, felt252)> {
    let r_point: EcPoint = EcPointTrait::new_from_x(eph_x)?;
    let k = x_of(r_point.mul(sk))?;
    Some((c_seed - pad(k, auction_id, bid_index, 0), c_level - pad(k, auction_id, bid_index, 1)))
}
