# Trust statement

> **What is assured:** the winner and the clearing price are established by
> hash-preimage proofs verified on-chain over a bid set the contract froze before any
> bid could be opened, so the auctioneer cannot misplace any bid it settles, or
> misreport the price those bids set, without failing a proof. **What is not:** after
> sealing, the auctioneer learns every bid amount — it can never publish them or spend
> anyone's funds, but it knows them; it can settle without a bid by recording it as
> forfeited, and on the current contracts the dispute window does not reliably
> penalise that; and the number of bids, their timing, and the uniform escrow amount
> are public on-chain.

Both sentences, verbatim and unshortened, belong in the README, on the site and in the
demo video description.

---

## The longer version

### What the contract enforces

| Claim | Mechanism | Where to check it |
|---|---|---|
| The bid set is fixed before anyone can open it | `seal` stamps `get_block_number()` — never a caller-supplied value — and freezes `bid_count` and `bid_root`; `settle` must supply exactly `bid_count` proofs | `auction.cairo`, `seal` / `settle` |
| The clearing price cannot be overstated | Requires a depth-`ℓ*` preimage of the runner-up's ascending anchor | `the_auctioneer_cannot_overstate_the_clearing_price` |
| The clearing price cannot be understated | Requires a depth-`(P−1−ℓ*)` preimage of the descending anchor | `the_auctioneer_cannot_understate_the_clearing_price` |
| No bid can be silently dropped | Proof count must equal the sealed bid count | `a_settlement_that_omits_a_bid_is_rejected` |
| A bid left out is visible | `settle` must give every bid a disposition, so one left out is recorded on chain as `Forfeit` | `a_settlement_that_omits_a_bid_is_rejected` |
| Losing bids are never published | Only predicate witnesses are ever revealed | `winner_pays_the_second_price_and_nothing_else_is_revealed` |
| Nobody's cooperation is needed to settle | Forfeit disposition; the escrow is redeemable if the bid was at or below the clearing price | `a_silent_bidder_does_not_block_settlement` |

### What it does not enforce

- **The auctioneer learns the amounts after sealing.** This is the Tier B caveat. The
  ordering is enforced by information flow — bidders transmit seeds only after
  observing the `Sealed` event — not by the contract. A bidder whose client sends the
  seed early has given the auctioneer the book early, and nothing on-chain would show
  it.
- **A bidder who publishes deliberately inconsistent anchors** creates a band of
  levels in which they can prove neither side, letting a *colluding* auctioneer place
  them anywhere in that band. It costs the bidder their own position and needs the
  auctioneer's cooperation, so it is outside the threat model — but it is real.
- **A forfeited bid gets its escrow back only if it was at or below the clearing
  price.** Above it, the escrow stays in the contract. The dispute window's length is
  set per auction at listing and is public.
- **Timing and count are public**, and so is the escrow amount. The escrow is uniform
  across bidders so it carries no information about any bid, but a bidder who is the
  only person to interact with the pool in a quiet hour is correlatable with their own
  deposit. Shield well before bidding.
- **Nothing here is audited.** See README "Status".
