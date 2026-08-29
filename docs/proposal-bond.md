# Proposal: the auctioneer's bond

**Not shipped.** The contracts are candidate-frozen and this is a contract change.
Written for a decision, with the cost of each option stated.

---

## What the contract does today

`create_auction` asserts nothing about `auctioneer_bond`. Zero is accepted and the
auction runs to completion — `an_auction_with_a_zero_bond_is_accepted` covers it.

The bond moves like this:

| Path | Pulled from | Paid to |
|---|---|---|
| listing | **seller** | contract |
| `dispute` succeeds | — | **the disputer** (slashed) |
| `finalize` | — | seller |
| **`abandon`** | — | **seller** (returned, not slashed) |

## The hole

The bond is the seller's money and comes back to the seller on abandon. When one address
is both seller and auctioneer — the ordinary case, and what every script in this repo
does — the sequence is:

1. Seal. The bid set is frozen and seeds arrive.
2. Compute the outcome off-chain. You now know the clearing price and nobody else does.
3. If it disappoints, wait out the grace and `abandon`.
4. Lot back, bond back, bidders refunded. Re-list.

**Cost: gas. At any bond size.** `an_auctioneer_who_is_the_seller_can_discard_an_outcome_for_free`
covers it.

This is strictly cheaper than the attack the bond *was* designed for. Excluding a bid
requires submitting a false settlement, which a disputer can slash. Discarding the whole
outcome requires no false proof at all — so there is nothing to dispute, and `dispute` is
unreachable because the auction never reached `Settled`.

**The docs overstate the property.** They say the auctioneer's bond is at risk if they
manipulate the outcome. True for exclusion. False for discarding.

Note this is a *bias* attack, not a theft: bidders are always made whole. What it buys is
free re-rolls until the price suits, which in a repeated auction is worth real money to
the seller and costs bidders their locked capital and their time.

---

## Options

### 1 — Document only. Cost: zero.

State that the bond answers for a dishonest settlement and not for walking away, and
recommend seller ≠ auctioneer where the outcome matters. With a distinct auctioneer the
bond is the seller's stake in *their* honesty, and abandoning returns it to the seller —
so an independent auctioneer gains nothing by discarding, and the seller who colludes
still bears the delay.

**Weak point:** it relies on an operational convention the contract does not enforce, and
the convenient default is the unsafe one.

### 2 — A floor on the bond. Cost: a redeclare. **Does not fix this.**

`assert(auctioneer_bond >= cap_price(config))` or similar. Worth having for the exclusion
attack, and it does nothing here — the bond returns on abandon whatever its size. Listing
it because it is the obvious first idea and it is not the fix.

### 3 — Abandon forfeits the bond to the bidders. Cost: a redeclare. **Recommended.**

On `abandon`, the bond is not returned. It joins the refundable pool and is paid out
pro-rata through `claim_refund` alongside each bidder's escrow.

- Removes the free re-roll: discarding an outcome now costs the bond, whoever the seller
  is, and the bond is exactly the parameter a bidder can read before deciding to take
  part.
- Pays the people who were actually harmed — bidders locked capital for a full cycle and
  got nothing.
- No new griefing vector: `abandon` stays permissionless, and the caller gains nothing by
  calling it, so there is no race to destroy a late auction for profit.

**Cost of the change:** touches `abandon` and `claim_refund`, so both need re-testing.
Mainnet redeclare is **35.18 STRK** spent, **48.69 held**, plus a Sepolia redeclare and
re-running gates §5 and §6a. Realistically half a day including verification.

### 4 — Abandon pays the bond to whoever calls it. Cost: a redeclare. **Rejected.**

Simplest to implement and creates a race: once the grace expires there is money in
calling `abandon` before the auctioneer settles. An auctioneer thirty seconds late loses
the auction to whoever is watching. It converts a safety valve into a bounty.

---

## Recommendation

**Option 3 is the right fix and option 1 is the right thing to do this week.**

The deciding factor is not the engineering. It is that 30% of the score is a working
mainnet product and we are at zero on it with roughly forty hours left. A contract change
now costs a Sepolia redeclare, re-running two freeze gates, and a mainnet redeclare —
against a flaw that biases outcomes, never steals, and requires the seller to also be the
auctioneer.

So: **correct the documentation now**, because the claim as written is stronger than the
contract, and that is a defect regardless of the deadline. Ship option 3 after the sprint,
or before it if the mainnet path completes early and the hours exist.

If you would rather ship option 3 now, say so — it is about half a day and I would want
it started before the mainnet declare, not after, so we declare once.
