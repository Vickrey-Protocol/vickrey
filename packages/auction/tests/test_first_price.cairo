//! First-price: the winner pays their own bid, which therefore becomes public. The
//! losing bids still do not.

use auction::interface::ISealedBidAuctionDispatcherTrait;
use auction::types::{AuctionKind, Disposition};
use super::common::{
    BOND, CAP, LOT, RESERVE, TICK, balance, collect, finalize, payout, place, proof_below,
    proof_exactly, seal, seller_paid, settle, setup,
};

#[test]
fn winner_pays_their_own_bid_and_the_losers_stay_hidden() {
    let env = setup(AuctionKind::FirstPrice);
    let a = place(env, 'A', 'SA', 13);
    let b = place(env, 'B', 'SB', 9);
    let c = place(env, 'C', 'SC', 2);
    seal(env);

    settle(
        env,
        13,
        a.index,
        array![proof_exactly(env, a, 13), proof_below(env, b, 13), proof_below(env, c, 13)],
    );
    finalize(env);

    let price = RESERVE + 13 * TICK;
    assert!(seller_paid(env) == price + BOND);

    // The winner overpaid the ladder cap into escrow and gets the rest back.
    assert!(collect(env, a.index, 'A') == CAP - price);
    assert!(collect(env, b.index, 'B') == CAP);
    assert!(collect(env, c.index, 'C') == CAP);
    assert!(balance(env.lot, payout()) == LOT);

    // Only "at or below the winning bid" was ever proved about the losers.
    assert!(env.auction.get_bid(env.id, b.index).disposition == Disposition::AtOrBelow);
    assert!(env.auction.get_bid(env.id, c.index).disposition == Disposition::AtOrBelow);
}

#[test]
fn a_first_price_winner_at_the_reserve_pays_the_reserve() {
    let env = setup(AuctionKind::FirstPrice);
    let a = place(env, 'A', 'SA', 0);
    seal(env);
    settle(env, 0, a.index, array![proof_exactly(env, a, 0)]);
    finalize(env);

    assert!(seller_paid(env) == RESERVE + BOND);
    assert!(collect(env, a.index, 'A') == CAP - RESERVE);
}
