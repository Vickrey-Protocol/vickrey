# Fallback submission ladder

Written on Monday 24 August, before it is needed, so the decision is not made at 2am on
the 30th by whoever is still awake.

---

## First, a correction to the obvious plan

The natural fallback — *"three qualifying transactions and a working public rail, with
the shielded rail documented as unshipped"* — **cannot be built as stated**, and it is
worth being precise about why before relying on it.

A qualifying transaction must touch the pool **and** carry an event from a contract we
listed. The only thing that satisfies both is `pool → AuctionAnonymizer.privacy_invoke →
SealedBidAuction`. **That path is the shielded rail.** So "three qualifying transactions
with the shielded rail unshipped" is asking for the rail's output while declaring the
rail absent.

The public rail cannot substitute at any price: public-rail bids never touch the pool, so
however many of them we run, the count of qualifying transactions stays zero.

**The shielded rail is not the ambitious half of this entry. It is the scoreable half.**

## But the scoreable half is much smaller than the product

The good news falls out of the same analysis. `Routed` is emitted at the top of
`privacy_invoke`, before the operation is dispatched, so **every** operation qualifies —
`PlaceBid`, `ClaimRefund`, `RedeemForfeit`, `ClaimLot`.

Three pool-routed **`place_bid` calls into a single open auction** are three qualifying
transactions. They require:

- `create_auction` to work
- `place_bid` to work
- `privacy_invoke` to work

They do **not** require settle, dispute, finalize, or any claim path. They do not require
the dashboard, the create form, or the demo video.

So an architectural failure in settlement — the most likely place for one, since it is
the most intricate code — **does not cost us the scoring gate**. That is the fact the
ladder below is built on, and it is why Rule 1 in [mainnet.md](mainnet.md) puts the pool
leg first.

---

## The ladder

Each tier is a complete, honest entry. Drop only to the tier the failure forces.

### Tier A — target

Five-bidder judged auction, both rails, full lifecycle through claim, dashboard, video.
Everything in [sepolia-done.md](sepolia-done.md) verified.

### Tier B — settlement or the dashboard fails architecturally

**Keep:** three pool-routed `place_bid` transactions into one real auction. Public rail
working end to end. The instrument, the public record, the trust statement, all live.

**Drop:** the settled-auction narrative. The video ends at *"three sealed bids on chain,
and nothing on chain says what any of them is"* — which is still the product's actual
claim, just without the second-price reveal.

**Say:** README status section states plainly that settlement is implemented and tested
but not exercised on mainnet, with the Sepolia transaction hashes that do exercise it.

**Cost:** the strongest beat of the demo. Not the scoring gate.

### Tier C — the auction lifecycle is broken past `place_bid`

**Keep:** three pool transactions of whatever operation *does* work. Any successful
`privacy_invoke` qualifies, so even three refund claims against a Sepolia-seeded auction
count.

**Drop:** the judged auction as a narrative. The demo shows the contracts and the pool
integration rather than a competition.

**Say:** exactly which paths are live on mainnet and which are Sepolia-only.

### Tier D — the pool leg itself fails on mainnet

This is the only tier that loses the scoring gate, so **do not accept it without
exhausting the alternatives first**, in this order:

1. **Try the other wallet.** Ready X is the other named STRK20 wallet. If Xverse cannot
   drive `privacy_invoke`, Ready may — different implementations of the same standard
   fail differently. Installing it and shielding is under an hour, and it is the single
   highest-value hour available at that point.
2. **Check the failure is ours.** `npm run verify:pool` passes against the live mainnet
   pool today. If it still passes and the wallet still fails, the problem is in the
   wallet's proving path, not our encoding — which is worth stating in the README and is
   not a defect in this entry.
3. **Re-read the revert.** Shape versus state, the same distinction that made
   `NOT_REGISTERED` look like a failure when it was not. A pool-state error is not a
   broken integration.

**If all three are exhausted:** submit anyway. The entry has deployed contracts, a live
demo, a working public rail, a video, and an anonymizer whose encoding is verified
against the live mainnet pool read-only. It cannot win on the mainnet-transaction
criterion and should say so in the README rather than let a judge discover it. An entry
that states its own gap is worth more than one that hides it, and considerably more than
no entry.

---

## The pre-emptive action, which is cheap and belongs now

**Verify both wallets on `/wallet-check`, not just Xverse.** If Ready X passes on Sepolia
and Xverse does not, we learn that on the 24th for free rather than on the 28th under
pressure. It is ten minutes and it removes Tier D's worst branch.

## What is never traded away

Whatever tier we land on:

- **R1 — no bid amount is ever rendered.** A degraded entry that leaks a bid is not a
  degraded entry, it is a different and worse product.
- **The trust statement, in full**, unshortened, wherever it appears.
- **The README says what is true.** Every tier below A involves saying plainly what did
  not ship. That is the entry's credibility and it is worth more than the feature.
