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

/// The reveal encryption, for `client/test/reveal.test.ts`. Asserted here as well as
/// printed, so a change on the Cairo side fails this file before it can strand a client.
#[test]
fn reveal_vectors() {
    let sk: felt252 = 'AUCTIONEER_SK';
    let seed: felt252 = 'BID_SEED';
    let auction_id: u64 = 42;
    let bid_index: u32 = 3;
    let level: u16 = 9;
    let (kx, ky) = super::common::reveal_key();
    let r = auction::reveal::ephemeral_scalar(seed, auction_id, bid_index);
    let (eph_x, c_seed, c_level) = auction::reveal::encrypt(
        r, kx, ky, auction_id, bid_index, seed, level,
    );
    let k = auction::reveal::shared_key(r, kx, ky).unwrap();
    println!("key_x {}", kx);
    println!("key_y {}", ky);
    println!("r {}", r);
    println!("eph_x {}", eph_x);
    println!("k {}", k);
    println!("c_seed {}", c_seed);
    println!("c_level {}", c_level);
    println!("record {}", auction::reveal::record(eph_x, c_seed, c_level));
    let (s, l) = auction::reveal::open_as_auctioneer(
        sk, eph_x, auction_id, bid_index, c_seed, c_level,
    )
        .unwrap();
    assert!(s == seed && l == level.into(), "the auctioneer opens what was sealed");

    // Pinned. The same numbers are in `client/test/reveal.test.ts`.
    assert!(r == 1096758706370399936340077541185969099233227558469687129007935104948560983167);
    assert!(eph_x == 1730920132285456082242979380521797916492723854716072199299279519883021950147);
    assert!(k == 1234767036340032115673756496322496542623562067134743824257253330510632466289);
    assert!(c_seed == 1913448946204768278282019681581804167590657384628665040943092916084201524734);
    assert!(c_level == 746589006867101285454884351858382899742679408783976786781839442902682449079);
}

/// The terms hash the client computes in `web/lib/v2.ts` must equal the contract's.
#[test]
fn terms_hash_vector() {
    let text: ByteArray = "What it is: A signed first edition\nHow it's delivered: Tracked post";
    let mut buf: Array<felt252> = array![];
    text.serialize(ref buf);
    let h = core::poseidon::poseidon_hash_span(buf.span());
    println!("terms_hash {}", h);
    // Pinned. The same number is in `web/lib/v2.test.ts`.
    assert!(h == 2787443723799347230240266750640810916947376215087829394704248588849502721177);
}
