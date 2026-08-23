# Phase 0 — Investigation Report

**Date:** 2026-08-23 (Day 0/1 of the sprint)
**Sources read:** `odinfree/strk20-skills` @ snapshot 2026-08-16 (the repo behind
`npx skills add welttowelt/strk20-skills`); `starkware-libs/starknet-privacy` @
`36eac4ea88cd8c59dde1493176e16501c6e90328` (main, 2026-08-20); and the Wallet API
0.10.3 type definitions as shipped in `@starknet-io/starknet-types-0103`, which
`starknet@10.4.0` vendors.

**Revised 2026-08-23 (second pass).** Both items originally left UNVERIFIED are now
resolved against source rather than inference — see Q5 and the addendum. One of them
turned up a real encoding bug.
**Status of every claim below:** read from those sources at those revisions. Nothing
here has yet been confirmed against a live pool. Items marked **UNVERIFIED** need a
mainnet or Sepolia check before they enter any public text.

---

## Verdict first

**Q2 fails as the plan posed it. Tier A as written is dead. We ship Tier B — but the
plan's assumption about *why* Tier A was needed turns out to be wrong, and Tier B
here is much stronger than the plan's description of it.**

The plan assumed the only way to verify a ranking without publishing bids is a custom
ZK circuit over note plaintexts. It is not. A hash-chain ("thermometer") commitment
gives a non-interactive, publicly verifiable proof of `bid ≥ t` and `bid ≤ t` using
nothing but Poseidon, verified in ordinary Cairo by our own contract, with no
dependency on the pool's proof system at all.

That means **properties 3, 4, 5 and 6 are all cryptographically enforced, not
procedurally asserted** — including the property-3 attack (auctioneer drops or
misprices a rival's bid), which becomes a hash-preimage forgery rather than something
we merely detect. This is a better outcome than the plan's Tier B and it does not
need Q2 to succeed.

The residual Tier B caveat is real and stays in the trust statement: **after sealing,
the auctioneer learns the losing bid amounts.** It never publishes them, and nothing
on-chain reveals them, but it knows them.

---

## Q1 — Escrow. Can a bid be genuinely locked funds?

**Yes, via an anonymizer contract, and the mechanism is the `privacy_invoke`
sandwich.**

The pool withdraws tokens to a helper contract, calls the helper's `privacy_invoke`
entry point through the protocol's `INVOKE_SELECTOR`, and the helper returns a
`Span<OpenNoteDeposit>` telling the pool which open notes to credit. **An empty span
is valid and means "credit nothing"** — which is exactly a deposit leg that parks
funds. The escrow example in the skills repo is precisely this shape: deposit stores
a commitment and returns `[].span()`; claim verifies a secret preimage, approves the
pool to pull, and returns one `OpenNoteDeposit`.

So: bid submission withdraws collateral from the pool into our auction contract, and
it stays there until settlement. That is real escrowed value, not a commitment.

**Refunds** come back the other way — the claimant creates an open note in the same
pool transaction and the helper returns an `OpenNoteDeposit` crediting it. **Refunds
therefore arrive as private notes**, which is what §5 of the plan wanted.

**The catch that reshapes the whole design:** the pool→helper leg is *a plain public
ERC-20 transfer*. The escrowed amount is visible on-chain. **If a bidder escrows
their bid, their bid is public.** This kills the obvious construction.

**Resolution — uniform cap collateral.** Every bidder escrows the same publicly known
amount: the auction's cap price. The escrow then reveals nothing beyond `bid ≤ cap`,
which is public by construction. The winner pays the clearing price out of their
escrow and the surplus refunds privately; losers refund in full, privately. This is
the only escrow scheme that satisfies property 1 and property 4 simultaneously, and
it is worth saying out loud in the README because it is a place a normal
implementation leaks everything.

Cost: capital efficiency. A bidder locks the cap, not their bid. Honest trade, stated.

## Q2 — Custom circuits. **FAILS.** ⚠️ This was the gate.

**No.** There is no route to authoring our own circuit over note plaintexts with note
commitments as public inputs.

Proving on STRK20 is not "write a circuit." A transaction is a batch of client
actions from a **fixed, phase-ordered set** (`SetViewingKey`, `OpenChannel`,
`OpenSubchannel`, `Deposit`, `UseNote`, `CreateEncNote`/`CreateOpenNote`, `Withdraw`,
`InvokeExternal`/`ComputeAndInvoke`). Those actions run in a **virtual Starknet
execution environment** anchored to a recent block snapshot, and Stwo proves *that
execution*. On submission the pool checks a fixed, closed set of proof facts:

- the proof came from the expected program variant (`VIRTUAL_SNOS`),
- the anchor block is within `proof_validity_blocks` of the tip,
- the proven message hash matches the submitted actions exactly.

There is no user-supplied verification key, no custom public-input vector, no
application circuit slot. **The self-hosted prover does not change this** — it proves
the same fixed program. (Its documented purpose is running your own proving service;
the docs are explicit that self-hosting is not a route around protocol rules, using
deposit screening as the example.)

The one adjacent mechanism is `privacy_compute` / `ComputeAndInvoke` — a client-side
compute whose result is forwarded as a server-side invoke, used by the privacy-bridge
inbound anonymizer to bind an attested cross-chain message to a private note in one
transaction. That binds a value into a proven transaction; it is **not** a
general-purpose circuit authoring path. **UNVERIFIED** whether it could carry a
ranking argument; not on the critical path, and not something to bet a sprint on.

**Consequence:** any privacy the *settlement* needs, we must build ourselves, in
ordinary Cairo, verified by our own contract. See §"What replaces Tier A" below.

## Q3 — Comparisons over sealed values. Cost and scaling.

Not available from the pool. Built by us, and cheap.

Each bid publishes two hash-chain anchors over a public price ladder of `P` levels:

```
step_i(x) = poseidon([CHAIN_TAG, auction_id, claim_commitment_i, x])

A_i = step_i^( ℓ_i )      revealing w with step^t(w) = A_i   proves  ℓ_i ≥ t
B_i = step_i^(P-1-ℓ_i)    revealing w with step^(P-1-t)(w) = B_i  proves  ℓ_i ≤ t
```

Forging either direction is a hash-preimage break. Neither proof reveals `ℓ_i`.

Vickrey settlement at clearing level `ℓ*` needs exactly **N+1 witness checks**:

| Bid | Obligation | Poseidon steps |
|---|---|---|
| winner `w` | `ℓ_w ≥ ℓ*` | `ℓ*` |
| runner-up `r` | `ℓ_r ≥ ℓ*` **and** `ℓ_r ≤ ℓ*` (pins `ℓ_r = ℓ*`) | `P-1` |
| every other `j` | `ℓ_j ≤ ℓ*` | `P-1-ℓ*` |

**Soundness:** the multiset has `ℓ_w ≥ ℓ*`, `ℓ_r = ℓ*`, and all others `≤ ℓ*`.
Second-highest is therefore `≥ ℓ*` (witness `r`) and `≤ ℓ*` (everyone but `w`), so it
equals `ℓ*`. That is the Vickrey price, established without opening a single bid.

This is **O(N)**, matching §5's claim, and it needs no `O(N²)` sort.

Worst case `N=10`, `P=256`: ~2,550 Poseidon hashes at settlement. Poseidon is a
Starknet builtin; this is comfortably inside one transaction. `P` is capped at 1024
in the contract to keep the bound explicit. **UNVERIFIED:** actual mainnet gas at
`N=10, P=256` — measure on Sepolia before quoting a number anywhere.

## Q4 — Viewing keys. What does the reveal path actually get?

**Not what the plan assumed, and we should not use them.**

A viewing key is **per-user, whole-history, and not scopeable**. Recovering one user's
private viewing key `k` opens *all* their incoming and outgoing channels, every note
amount, and every nullifier match, forward and backward through the entire graph.
There is no per-note or per-auction scoping. The only scoping mechanism in the
protocol is the auditor escrow, which is governance-keyed and meant for lawful
process, not application logic.

**So the reveal path must not touch viewing keys at all.** Ours doesn't: bidders hold
a per-bid seed unrelated to their pool identity, and the only thing ever transmitted
is that seed, to the auctioneer, after sealing. A viewing key would disclose that
bidder's entire history, in both directions, to run one auction.

## Q5 — Anonymizer contracts. One atomic private transaction?

**Yes.** The dapp side is two actions in a single `strk20InvokeTransaction`:

```ts
const actions: STRK20_ACTION[] = [
  { type: "transfer", token, amount: "OPEN", recipient: userAddress },   // open note
  { type: "invoke",   contract: helper, calldata: [ ..., "${openNoteIds[0]}"] },
]
```

The wallet resolves `${openNoteIds[N]}` and `${poolAddress}` inside invoke calldata.
Withdraw, helper call and open-note credit are one transaction; **a revert anywhere
aborts the whole pool transaction and no funds move.** Calldata order must match the
helper's `privacy_invoke` signature exactly — the pool deserializes straight into it.

`strk20PrepareInvoke(actions, true)` dry-runs (builds and proves without submitting),
which is the cheap way to catch a calldata-shape error.

Constraint that shapes the design: **at most one external invoke per pool
transaction**, shared jointly with `ComputeAndInvoke`. So bid-with-escrow is one
transaction, and claim-refund is a separate one. No batching a bid and a claim.

### The action envelope — RESOLVED

The documented example shows the open-note leg but not the action that moves funds
*out* to a helper, which left the bid leg a guess. The Wallet API 0.10.3 types settle
it. `STRK20_ACTION` is a four-way union:

```ts
{ type: 'deposit';  token: ADDRESS; amount: FELT }
{ type: 'withdraw'; token: ADDRESS; amount: FELT; recipient: ADDRESS }
{ type: 'transfer'; token: ADDRESS; amount: FELT | 'OPEN'; recipient: ADDRESS }
{ type: 'invoke';   contract: ADDRESS; calldata: (FELT | placeholder)[] }
```

So the bid leg is `withdraw` (pool → helper, a public recipient) followed by `invoke`,
and a claim leg is `transfer … 'OPEN'` followed by `invoke`. Placeholders are
`${openNoteIds[N]}` and `${poolAddress}`, resolved by the wallet during assembly.

**The bug this caught:** `FELT` is prefixed hex with no leading zeros
(`^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$`). The first implementation passed the
collateral as a decimal string, which the wallet would have rejected *after* the user
signed. Every felt now goes through `num.toHex`, and `client/test/strk20.test.ts`
holds the pattern.

The pool reaches the helper through `INVOKE_SELECTOR = selector!("privacy_invoke")`
(`packages/privacy/src/utils.cairo`). That selector is publicly callable, so the
helper's caller assertion is what stops it being driven directly.

### The SDK route is not publicly installable

`@starkware-libs/starknet-privacy-sdk` is not on the public npm registry, and an npm
search surfaces no equivalent. **The Wallet API is the only route a clean `npm
install` can reach today.** That settles the route choice rather than leaving it a
preference, and it means "use the SDK properly" here means using the Wallet API
surface properly: the real `STRK20_ACTION` types, `walletV6.supportedWalletApi` for
capability detection, `strk20PrepareInvoke(actions, true)` to dry-run, and
`get_fee_amount` read live.

## Q6 — Metadata leakage. What does a bid reveal?

The honest list, and it is the section to get right:

| Observable | Visible? |
|---|---|
| That an auction exists, its terms, ladder, deadlines | **Yes** — public by design |
| That *someone* placed a bid, and when | **Yes** — the pool→helper transfer and our `BidPlaced` event |
| **The number of bids** | **Yes** — we store a dense index; this is public |
| The escrowed amount | **Yes** — and it is the same cap for everyone, so it carries no information |
| **Which address bid** | **No** — the pool submits via a relayer; the helper calls us; no bidder address ever reaches our contract. Bids are keyed by a `claim_commitment`, not an address |
| **The bid amount** | **No** — only two hash anchors are stored |
| Losing bid amounts, ever | **No** — never published at any point |
| The winner's own bid amount (Vickrey) | **No** — only `≥ clearing price` is proved |
| The clearing price and which bid index won | **Yes** — deliberately |

Two leaks to state plainly rather than paper over:

1. **Timing and count are public.** A bidder who bids alone in a quiet hour is
   correlatable with their own pool deposit. The mitigation is the documented one —
   shield well ahead of bidding, never in the same breath.
2. **Every private transaction is submitted by a relayer**, so the transaction sender
   is the relayer for all users and is not a deanonymisation vector — but it also
   means per-user attribution must come from pool `Deposit` events, never from
   `tx.sender`. Our UI must not imply otherwise.

## Q7 — Force-reveal / threshold auditing.

**Nothing usable exists.** The only threshold mechanism is the auditor-escrowed
viewing key, which is governance-set, whole-history, and for lawful process. It is
not an application primitive and using it would be an abuse.

**So non-reveal must be handled purely by design.** It is, see below.

## Q8 — Mainnet economics.

**UNVERIFIED — must be measured, not guessed.** What the docs do pin down:

- A **flat pool fee per private operation**, read from the pool's `get_fee_amount`
  and explicitly *not* to be hardcoded (it was 4 STRK on mainnet at the 2026-08-16
  snapshot). Wallet flows sponsor gas but **not** the pool fee. Subtract it when
  pre-filling any MAX amount or the operation fails after the user has signed.
- **Proving takes ~29 s** on a 12-core / 46 GiB machine, machine-dependent. That is
  the dominant latency in a bid, not the chain.
- **New notes mature ~10 blocks** before they are spendable, and proofs should be
  built at `currentBlock - 10`. Build the wait into the UX.

Budget per bid: one pool fee + ~30 s proving. Per refund claim: the same again. This
is a real UX constraint for the demo video — a bid is not instant, and the app must
say so instead of appearing hung.

---

## What replaces Tier A

Tier as shipped: **Tier B, with cryptographic settlement.**

| # | Property | How it is obtained | Enforced by |
|---|---|---|---|
| 1 | Real escrowed funds | Uniform cap collateral parked in the auction contract via `privacy_invoke` | Contract |
| 2 | Sealed from everyone during bidding | Only two hash anchors are ever published; seeds are transmitted to nobody before sealing | Information flow |
| 3 | Commitment before decryption | `bid_root` accumulator updated per bid; `seal()` stamps the block number **from the block, never from calldata**, and freezes count and root. Settlement must account for **exactly** `bid_count` bids | Contract |
| 4 | Losing bids never published | Only predicate proofs are ever revealed | Cryptography |
| 5 | Outcome proved, not asserted | N+1 hash-chain witnesses verified on-chain | Cryptography |
| 6 | Non-reveal cannot grief | A bid with no valid proof is marked `Forfeit`; settlement completes without it, and its escrow stays claimable by its owner forever | Contract |

**Property 2's ordering is enforced by information flow, and this is the load-bearing
detail.** Bidders do not put seed ciphertexts on-chain at bid time — if they did, the
auctioneer could decrypt early. They transmit the seed to the auctioneer *only after
observing the `Sealed` event*. The auctioneer cannot decrypt early because it has not
been sent anything. That is a stronger guarantee than "the contract won't let it,"
and it is the reason the forfeit mechanism in property 6 has to exist.

### The griefing hole this opens, and the fix

If seeds arrive only after sealing, a bidder who goes silent — or who deliberately
published junk anchors — leaves a bid the auctioneer cannot disposition. Settlement
would stall. That is unacceptable, so:

- A bid with no valid proof is settled as `Forfeit`: excluded from the ranking, its
  escrow retained rather than refunded. **Settlement always completes.**
- The forfeited escrow stays **claimable by its owner forever**, by presenting a
  loser-side proof themselves. Going offline costs a delay, not the money.
- A malicious auctioneer could forfeit an honest *high* bidder to exclude them. So
  settlement does not distribute anything: it opens a **dispute window**. During it,
  a forfeited bidder who proves `ℓ ≥ ℓ*+1` — strictly above the clearing price —
  voids the settlement and slashes the auctioneer's bond. `finalize()` only moves
  funds after the window closes clean.

This is the honest version of property 6 and it is better than commit-reveal, where a
non-revealer distorts the outcome or blocks it outright.

### The residual trust, stated exactly

- **After sealing, the auctioneer learns every bid amount.** It cannot publish them
  without the bidders' seeds becoming public, it cannot misreport the outcome without
  forging a preimage, and it cannot exclude a bid without being caught in the dispute
  window. But it knows them. That is Tier B and it goes in the trust statement.
- **A bidder who deliberately publishes inconsistent anchors** can create a band of
  levels in which they can prove neither side, letting a colluding auctioneer place
  them anywhere in that band. This only harms the colluding bidder and requires the
  auctioneer's cooperation, which is already outside the threat model. Documented,
  not hidden.

---

## Engineering decisions taken from this report

1. **Zero external Cairo dependencies** beyond `starknet` and `snforge_std`.
   `OpenNoteDeposit` and the ERC-20 interface are declared locally with provenance
   comments and a layout test. The monorepo pins scarb 2.18.0 / snforge 0.63.0 and
   pulls `openzeppelin`, `starkware_utils` and `ekubo`; a judge running `scarb build`
   on a clean machine should not need any of that. **The layout of
   `OpenNoteDeposit` must be re-checked against the monorepo before mainnet deploy.**
2. **The auction contract is pool-agnostic.** It accepts ERC-20 transfers from
   whatever calls it, so it is fully testable under `snforge` with plain accounts and
   works with the pool in production through the anonymizer.
3. **Bids are keyed by `claim_commitment`, not by address.** No bidder address ever
   reaches our contract. This falls out of Q5 and is strictly better than the plan
   assumed.
4. **Viewing keys are not used anywhere.** Per Q4.
5. **`P` (ladder size) is capped at 1024** so the settlement gas bound is explicit.

## Addendum, 2026-08-23 — the two open items, closed

**`OpenNoteDeposit`'s layout. RESOLVED.** Read from
`packages/privacy/src/objects.cairo` @ `36eac4ea88cd8c59dde1493176e16501c6e90328`:

```cairo
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}
```

Byte-for-byte identical to the local declaration in
`packages/anonymizer/src/privacy_objects.cairo` — same fields, same order, same derive
set. The revision is now cited in that file, and `test_layout.cairo` pins the
serialization.

**The action envelope. RESOLVED** — see Q5 above, including the felt-encoding bug it
exposed.

## Addendum, second pass — the live pool answers

Sepolia has a deployed STRK20 pool, so the whole flow can be exercised without
mainnet funds. Addresses came from `@avnu/avnu-sdk`, then were checked on-chain.

| | |
|---|---|
| Sepolia pool | `0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Class hash | `0x56ab118a8a6e38efc93ad758cefe909fee421fa931ce3cf72df624d345623b2` |
| Mainnet pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| `get_fee_amount` | **2 STRK** on Sepolia — not the 4 the docs quote for mainnet (Q8) |
| `get_proof_validity_blocks` | 450, matching the documented default |

**Also: Blast API is retired.** Every RPC URL in this repo pointed at it and was
dead. Worth noting because a dead default endpoint is the kind of thing that only
surfaces during a demo.

### The pool validated our action encoding

`compile_actions` is a **view** on the pool. That makes it possible to put our own
calldata in front of the real contract read-only — no wallet, no signature, no funds,
no deployment. `client/scripts/verify-pool-shapes.mjs` does exactly that, building the
actions with the production client code rather than a copy:

| Case | Live pool says | Reading |
|---|---|---|
| bid `[Withdraw, InvokeExternal]` | `NEGATIVE_INTERMEDIATE_BALANCE` | **Shape accepted.** Reached the balance invariant; the throwaway user has no notes |
| claim `[CreateOpenNote, Invoke]` | `SUBCHANNEL_NOT_FOUND` | **Shape accepted.** Reached state lookup |
| control: reversed bid | `ACTIONS_OUT_OF_ORDER` | Withdraw is phase 6, invoke is phase 7 |
| control: invoke alone | `NO_REPLAY_PROTECTION` | An invoke with no note action has no nullifier |
| control: two invokes | `ACTIONS_OUT_OF_ORDER` | At most one external invoke per transaction, confirmed on-chain |

Both of our shapes fail on **state**, not shape. The controls fail on **shape**. That
asymmetry is the result: the encoding, the enum variants and the phase ordering are
right, and the check is still capable of failing.

Two things this does *not* establish, and they are the honest limit: no wallet has
assembled, proven and submitted one of these, and the helper has never run, because
nothing is deployed yet.

`NO_REPLAY_PROTECTION` is a design constraint worth carrying forward: **an
`InvokeExternal` cannot stand alone.** A bid must include a note-spending action, which
it does — the `UseNote` that funds the withdraw.

## What is still unverified and must be before launch

- **A wallet assembling, proving and submitting a bid.** The remaining gap, and the
  only one that needs a human at a browser. `strk20PrepareInvoke(actions, true)` first.
- Mainnet/Sepolia gas for `settle()` at `N=10, P=256` (Q8, Q3). We have an `snforge`
  estimate; that is not a chain measurement.
- Whether Ready or Xverse expose STRK20 on **Sepolia** specifically. The pool is
  there; wallet support for it is a separate question.
- Whether `privacy_compute` could carry any part of the ranking argument (Q2). Low
  priority; the design does not need it.
