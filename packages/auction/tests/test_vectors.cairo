//! Prints the hashes the TypeScript client must reproduce exactly.
//!
//! The client builds anchors and witnesses off-chain; if its Poseidon domain tags or
//! field ordering drift from Cairo's, every bid it makes is unprovable. `snforge test
//! test_vectors -- --print` regenerates the fixture behind
//! `client/test/conformance.test.ts`.

use auction::ladder;

#[test]
fn print_conformance_vectors() {
    let secret: felt252 = 'CLAIM_SECRET';
    let seed: felt252 = 'BID_SEED';
    let auction_id: u64 = 42;
    let level: u16 = 9;
    let num_levels: u16 = 16;

    let c = ladder::claim_commitment_of(secret);
    println!("claim_commitment {}", c);
    println!("up_seed {}", ladder::up_seed(seed));
    println!("down_seed {}", ladder::down_seed(seed));
    println!("step1 {}", ladder::step(auction_id, c, 'X'));
    println!("up_anchor {}", ladder::up_anchor(auction_id, c, seed, level));
    println!("down_anchor {}", ladder::down_anchor(auction_id, c, seed, level, num_levels));
    println!("w_above_5 {}", ladder::witness_at_or_above(auction_id, c, seed, level, 5));
    println!("w_below_12 {}", ladder::witness_at_or_below(auction_id, c, seed, level, 12));
    println!("bid_root1 {}", ladder::extend_bid_root(0, 0, c, 111, 222));
    println!(
        "bid_root2 {}",
        ladder::extend_bid_root(ladder::extend_bid_root(0, 0, c, 111, 222), 1, c, 333, 444),
    );
}
