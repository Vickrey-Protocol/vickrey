//! Settlement cost at the scale the plan targets. Answers PHASE0.md Q3/Q8 with a
//! measured number instead of a guess. `snforge` reports gas per test; the figures
//! quoted in the README come from this file.

use auction::interface::ISealedBidAuctionDispatcherTrait;
use auction::types::{AuctionKind, DispositionProof};
use super::common::{TICK, place, proof_above, proof_below, proof_exactly, seal, settle, setup_with};

const P: u16 = 256;

/// Ten bidders on a 256-level ladder: one `AtOrAbove`, one `Exactly`, eight
/// `AtOrBelow`. This is the worst realistic shape for the demo auction.
#[test]
fn settle_ten_bids_on_a_256_level_ladder() {
    let env = setup_with(AuctionKind::Vickrey, P, TICK);

    let winner = place(env, 'A', 'SA', 200);
    let runner = place(env, 'B', 'SB', 150);
    let c0 = place(env, 'C0', 'S0', 10);
    let c1 = place(env, 'C1', 'S1', 20);
    let c2 = place(env, 'C2', 'S2', 30);
    let c3 = place(env, 'C3', 'S3', 40);
    let c4 = place(env, 'C4', 'S4', 50);
    let c5 = place(env, 'C5', 'S5', 60);
    let c6 = place(env, 'C6', 'S6', 70);
    let c7 = place(env, 'C7', 'S7', 80);
    seal(env);

    let proofs: Array<DispositionProof> = array![
        proof_above(env, winner, 150), proof_exactly(env, runner, 150), proof_below(env, c0, 150),
        proof_below(env, c1, 150), proof_below(env, c2, 150), proof_below(env, c3, 150),
        proof_below(env, c4, 150), proof_below(env, c5, 150), proof_below(env, c6, 150),
        proof_below(env, c7, 150),
    ];
    settle(env, 150, winner.index, proofs);

    assert!(env.auction.get_state(env.id).clearing_level == 150);
}

/// Everything the two benchmarks above do *except* `settle`. Subtract this to read
/// the settlement cost on its own.
#[test]
fn baseline_ten_bids_without_settling() {
    let env = setup_with(AuctionKind::Vickrey, P, TICK);
    place(env, 'A', 'SA', 200);
    place(env, 'B', 'SB', 150);
    place(env, 'C0', 'S0', 10);
    place(env, 'C1', 'S1', 20);
    place(env, 'C2', 'S2', 30);
    place(env, 'C3', 'S3', 40);
    place(env, 'C4', 'S4', 50);
    place(env, 'C5', 'S5', 60);
    place(env, 'C6', 'S6', 70);
    place(env, 'C7', 'S7', 80);
    seal(env);
    assert!(env.auction.get_state(env.id).bid_count == 10);
}

/// The most expensive clearing level: every loser proof costs `P-1-clearing` hashes,
/// so a clearing price at the bottom of the ladder is the worst case.
#[test]
fn settle_ten_bids_at_the_worst_case_clearing_level() {
    let env = setup_with(AuctionKind::Vickrey, P, TICK);

    let winner = place(env, 'A', 'SA', 255);
    let runner = place(env, 'B', 'SB', 0);
    let mut kits = array![];
    let mut i: u8 = 0;
    while i < 8 {
        kits.append(place(env, ('L' + i.into()), ('K' + i.into()), 0));
        i += 1;
    }
    seal(env);

    let mut proofs: Array<DispositionProof> = array![
        proof_above(env, winner, 0), proof_exactly(env, runner, 0),
    ];
    let mut j: u32 = 0;
    while j < kits.len() {
        proofs.append(proof_below(env, *kits.at(j), 0));
        j += 1;
    }
    settle(env, 0, winner.index, proofs);

    assert!(env.auction.get_state(env.id).clearing_level == 0);
}

// ---- at the bid cap ---------------------------------------------------------------
//
// `ladder::MAX_SETTLE_WORK` caps bids × levels at 32768 so `settle` always fits under
// Starknet's 1.11B L2 gas per transaction. These run the worst case at the two corners
// of that budget — the biggest ladder, and the most bids — each against a baseline that
// does everything except settle. Subtract to read settle alone.

fn fill(env: super::common::Env, n: u32, level: u16) -> Array<super::common::Kit> {
    let mut kits = array![];
    let mut i: u32 = 0;
    while i < n {
        kits.append(place(env, 'S' + i.into(), 'K' + i.into(), level));
        i += 1;
    }
    kits
}

/// Winner at the top, everyone else at level 0, clearing at 0: every loser proof walks
/// the whole down-chain. The worst case for a given ladder.
fn worst_case_settle(levels: u16, n: u32, run_settle: bool) {
    let env = setup_with(AuctionKind::Vickrey, levels, TICK);
    let winner = place(env, 'W', 'SW', levels - 1);
    let rest = fill(env, n - 1, 0);
    seal(env);
    // Proofs are built in both runs, so the difference is the contract's own work.
    let mut proofs: Array<DispositionProof> = array![proof_above(env, winner, 0)];
    proofs.append(proof_exactly(env, *rest.at(0), 0));
    let mut j: u32 = 1;
    while j < rest.len() {
        proofs.append(proof_below(env, *rest.at(j), 0));
        j += 1;
    }
    if run_settle {
        settle(env, 0, winner.index, proofs);
    }
}

#[test]
fn settle_at_the_cap_1024_levels_32_bids() {
    worst_case_settle(1024, 32, true);
}

#[test]
fn baseline_at_the_cap_1024_levels_32_bids() {
    worst_case_settle(1024, 32, false);
}

#[test]
fn settle_at_the_cap_128_levels_256_bids() {
    worst_case_settle(128, 256, true);
}

#[test]
fn baseline_at_the_cap_128_levels_256_bids() {
    worst_case_settle(128, 256, false);
}
