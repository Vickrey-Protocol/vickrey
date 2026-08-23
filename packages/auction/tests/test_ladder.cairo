//! The cryptographic core, tested on its own before any contract touches it.

use auction::ladder;

const AID: u64 = 7;
const P: u16 = 16;

fn commitment() -> felt252 {
    ladder::claim_commitment_of('SECRET')
}

#[test]
fn at_or_above_holds_at_and_below_the_committed_level() {
    let c = commitment();
    let level: u16 = 9;
    let up = ladder::up_anchor(AID, c, 'SEED', level);

    let mut t: u16 = 0;
    while t <= level {
        let w = ladder::witness_at_or_above(AID, c, 'SEED', level, t);
        assert!(ladder::verify_at_or_above(AID, c, up, t, w), "should prove level >= {}", t);
        t += 1;
    }
}

#[test]
fn at_or_above_cannot_be_forged_above_the_committed_level() {
    let c = commitment();
    let level: u16 = 9;
    let up = ladder::up_anchor(AID, c, 'SEED', level);

    // The best a prover can do without the seed is walk the chain the wrong way.
    // Every candidate witness fails for every t strictly above the committed level.
    let mut t: u16 = level + 1;
    while t < P {
        assert!(
            !ladder::verify_at_or_above(AID, c, up, t, ladder::up_seed('SEED')),
            "forged level >= {} from the seed",
            t,
        );
        assert!(
            !ladder::verify_at_or_above(AID, c, up, t, up), "forged level >= {} from the anchor", t,
        );
        t += 1;
    }
}

#[test]
fn at_or_below_holds_at_and_above_the_committed_level() {
    let c = commitment();
    let level: u16 = 9;
    let down = ladder::down_anchor(AID, c, 'SEED', level, P);

    let mut t: u16 = level;
    while t < P {
        let w = ladder::witness_at_or_below(AID, c, 'SEED', level, t);
        assert!(ladder::verify_at_or_below(AID, c, down, P, t, w), "should prove level <= {}", t);
        t += 1;
    }
}

#[test]
fn at_or_below_cannot_be_forged_under_the_committed_level() {
    let c = commitment();
    let level: u16 = 9;
    let down = ladder::down_anchor(AID, c, 'SEED', level, P);

    let mut t: u16 = 0;
    while t < level {
        assert!(
            !ladder::verify_at_or_below(AID, c, down, P, t, ladder::down_seed('SEED')),
            "forged level <= {} from the seed",
            t,
        );
        t += 1;
    }
}

#[test]
fn the_two_chains_pin_a_level_exactly() {
    let c = commitment();
    let level: u16 = 9;
    let up = ladder::up_anchor(AID, c, 'SEED', level);
    let down = ladder::down_anchor(AID, c, 'SEED', level, P);

    // Both proofs at t == level: the only t where both can hold.
    assert!(
        ladder::verify_at_or_above(
            AID, c, up, level, ladder::witness_at_or_above(AID, c, 'SEED', level, level),
        ),
    );
    assert!(
        ladder::verify_at_or_below(
            AID, c, down, P, level, ladder::witness_at_or_below(AID, c, 'SEED', level, level),
        ),
    );
}

#[test]
fn trivial_bounds_are_satisfiable_by_the_anchor_itself() {
    let c = commitment();
    let up = ladder::up_anchor(AID, c, 'SEED', 5);
    let down = ladder::down_anchor(AID, c, 'SEED', 5, P);
    // Every level is >= 0 and <= P-1. Presenting the anchor is a correct proof of both.
    assert!(ladder::verify_at_or_above(AID, c, up, 0, up));
    assert!(ladder::verify_at_or_below(AID, c, down, P, P - 1, down));
}

#[test]
fn a_chain_is_worthless_in_another_auction() {
    let c = commitment();
    let level: u16 = 9;
    let up = ladder::up_anchor(AID, c, 'SEED', level);
    let w = ladder::witness_at_or_above(AID, c, 'SEED', level, 5);

    assert!(ladder::verify_at_or_above(AID, c, up, 5, w));
    assert!(!ladder::verify_at_or_above(AID + 1, c, up, 5, w), "chain replayed across auctions");
}

#[test]
fn a_chain_is_worthless_under_another_claim_commitment() {
    let c = commitment();
    let other = ladder::claim_commitment_of('OTHER');
    let level: u16 = 9;
    let up = ladder::up_anchor(AID, c, 'SEED', level);
    let w = ladder::witness_at_or_above(AID, c, 'SEED', level, 5);

    assert!(!ladder::verify_at_or_above(AID, other, up, 5, w), "chain replayed across bids");
}

#[test]
fn out_of_range_upper_bound_is_rejected_not_wrapped() {
    let c = commitment();
    let down = ladder::down_anchor(AID, c, 'SEED', 5, P);
    assert!(!ladder::verify_at_or_below(AID, c, down, P, P, 0));
}

#[test]
fn bid_root_is_order_sensitive() {
    let a = ladder::extend_bid_root(0, 0, 'C1', 'U1', 'D1');
    let ab = ladder::extend_bid_root(a, 1, 'C2', 'U2', 'D2');
    let b = ladder::extend_bid_root(0, 0, 'C2', 'U2', 'D2');
    let ba = ladder::extend_bid_root(b, 1, 'C1', 'U1', 'D1');
    assert!(ab != ba, "bid root must not commute");
}
