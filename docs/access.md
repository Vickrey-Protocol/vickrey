# Letting a judge actually try it

30% of the score is a working mainnet product for a real user. A judge who has to
spend 12 STRK before they can press a button will not press the button, so this is a
scoring problem rather than a caveat to write down.

## Where the 12 STRK comes from

Each private pool operation costs a flat fee — **6 STRK on mainnet**, read live from
`get_fee_amount`. A stranger who wants to bid needs two of them: one to shield STRK
into the pool, one to place the bid. A third if they want their refund back.

## What the pool source actually says

Read from `packages/privacy/src/privacy.cairo` @ `36eac4ea`:

```cairo
fn collect_fee(ref self: ContractState) {
    let fee_amount = self.fee_amount.read();
    if fee_amount.is_non_zero() {
        checked_transfer_from(
            token_address: STRK_TOKEN_ADDRESS,
            sender: get_caller_address(),      // <- the submitter, not the bidder
            recipient: self.fee_collector.read(),
            amount: fee_amount.into(),
        );
    }
}
```

Three things follow, and together they make sponsorship possible:

1. **The fee is charged to whoever calls `apply_actions`**, in public STRK, by
   `transfer_from`. It is not taken out of the bidder's shielded balance.
2. **`apply_actions` has no caller restriction.** Anyone can submit a proven
   transaction.
3. **The proof binds the actions, not the submitter.** `validate_proof` checks the
   program variant, the anchor block, and that the proven message hash matches the
   submitted actions. The bidder's own authorization is the account signature verified
   *inside* the proof, so a third party submitting is a courier, not an impersonator.

And the wallet exposes the seam: `strk20PrepareInvoke(actions, false)` returns a
`STRK20_CALL_AND_PROOF` **without submitting it**.

## Option A — sponsor the bid outright

The bidder's wallet proves; we submit and pay.

```
bidder's wallet   strk20PrepareInvoke(actions, false)  ->  { call, proof }
    │                                                        │
    └── POST to our relayer ─────────────────────────────────┘
                                    │
        our relayer account: execute(call, proofDetails)
        pays the 6 STRK pool fee and the gas
```

**Cost to us: 6 STRK + ~0.3 gas per sponsored bid. Cost to the bidder: nothing.**

The bidder still needs shielded balance to cover the collateral, and shielding is
itself a fee-charging operation — sponsorable the same way, though a deposit also
carries FPI screening of the depositor.

**Status: architecturally sound, not yet demonstrated.** Every step is verified from
the pool source and the wallet ABI, but no wallet has produced a `CALL_AND_PROOF` for
us yet. This is the same gap as the wallet test.

## Option B — bid on the public rail, no pool at all

The auction contract is **pool-agnostic by design**: `place_bid` takes plain ERC-20
from whatever calls it, and the anonymizer is only one such caller. So anyone with an
ordinary Starknet wallet can bid directly.

What that keeps:

- The bid amount is still **cryptographically sealed** — two hash anchors, exactly as
  through the pool. The whole thermometer mechanism is untouched.
- Settlement is still proved, losers still never published, the winner's own bid still
  never opened.

What it gives up: the bidder's **address** is visible, because they call the contract
themselves. The amount is not.

**Cost to the bidder: gas only, about 0.25 STRK.** No privacy wallet, no shielding, no
pool fee, no registration. A judge can bid in under a minute with any wallet.

This is the honest trade to put on the page: *your identity is public here, your bid is
not — use the private rail if you want both.*

## Option C — Sepolia sandbox beside a mainnet result

Free to try, but it is not the mainnet product the criterion asks for, and it splits
the story across two chains in a three-minute video. Worth keeping as the place people
experiment, not as the answer to this problem.

## What I would do

**Both A and B, with B as the default.**

- The landing page offers two ways to bid: **public rail** (free, identity visible,
  bid sealed) and **private rail** (fully private, sponsored while the budget lasts).
- Sponsor a **capped number** of private-rail bids — a counter on the relayer, and the
  page says how many are left. Ten sponsored bids is 60 STRK.
- Run at least one full private-rail auction ourselves regardless, because of the
  submission rule below.

| | Cost to us | Cost to a judge | Identity | Amount |
|---|---|---|---|---|
| Public rail | 0 | ~0.25 STRK gas | public | **sealed** |
| Sponsored private rail | ~6.3 STRK/bid | 0 | **private** | **sealed** |
| Unsponsored private rail | 0 | 12–18 STRK | **private** | **sealed** |

## The constraint that forces a private-rail run either way

From the sprint's `CONTRIBUTING.md`:

> at least three mainnet transaction hashes. Each is checked against the chain: it must
> exist, have succeeded, and **have touched the STRK20 pool**. If you listed anything in
> `contracts`, the transaction must also carry an event from one of them.

Public-rail bids do **not** touch the pool, so they cannot be our three transactions. We
need at least three real pool transactions that route through our anonymizer — a bid
through the pool does exactly that: pool → anonymizer → `place_bid` → `BidPlaced`.

**That is 18 STRK in pool fees we cannot avoid**, on top of deployment.
