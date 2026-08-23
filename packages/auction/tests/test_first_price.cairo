//! First-price: the winner pays their own bid, which therefore becomes public. The
//! losing bids still do not.

use auction::interface::ISealedBidAuctionDispatcherTrait;
use auction::types::{AuctionKind, Disposition};
use super::common::{
    BOND, CAP, LOT, RESERVE, TICK, balance, finalize, payout, place, proof_below, proof_exactly,
    seal, seller, settle, setup,
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
    assert!(balance(env.pay, seller()) == price + BOND);

    // The winner overpaid the ladder cap into escrow and gets the rest back.
    assert!(env.auction.claim_refund(env.id, a.index, 'A', payout()) == CAP - price);
    assert!(env.auction.claim_refund(env.id, b.index, 'B', payout()) == CAP);
    assert!(env.auction.claim_refund(env.id, c.index, 'C', payout()) == CAP);
    assert!(env.auction.claim_lot(env.id, 'A', payout()) == LOT);

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

    assert!(balance(env.pay, seller()) == RESERVE + BOND);
    assert!(env.auction.claim_refund(env.id, a.index, 'A', payout()) == CAP - RESERVE);
}
