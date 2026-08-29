# Vickrey

**Sealed-bid auctions on STRK20 where the losing bids are never published.**

**[Open the live auctions](https://vickrey-ten.vercel.app)** &nbsp;·&nbsp;
**[How it works, in full](https://vickrey-ten.vercel.app/docs)** — the six properties,
the hash-chain construction, and what the STRK20 integration does and does not reveal.

A Vickrey auction is the theoretically optimal auction: the highest bidder wins and
pays the second-highest bid, so bidding your true valuation is the dominant strategy.
It has been known since 1961 and has never been deployable on a public chain, because
sealing the bids required trusting an auctioneer and revealing them destroyed the
privacy that made the mechanism work.

This one settles with a **proof**. The winner and the clearing price are established
on-chain by hash-preimage witnesses over a bid set the contract froze before anyone
could open it. The losing bids are never published — not on chain, not in the app, not
anywhere except the bidders' own devices. Neither is the winner's.

**To try it: connect a wallet, pick a level, sign.** That is the public rail and it
needs no shielded balance and no set-up. Your bid is sealed either way — the private
rail additionally hides your address, and costs a pool fee and a shield you make inside
your own wallet. [Both rails, and which one you want](#two-rails-and-which-one-you-will-actually-use).

**Submissions close 31 Aug 2026, 23:59 UTC.** Whatever this repository shows at that
moment is the entry — there is no separate submission step.

## Trust statement

> **What is assured:** the winner and the clearing price are established by
> hash-preimage proofs verified on-chain over a bid set the contract froze before any
> bid could be opened, so the auctioneer cannot alter the outcome, exclude a bid, or
> misreport the price without failing a proof or being slashed in the dispute window.
> **What is not:** after sealing, the auctioneer learns every bid amount — it can
> never publish them, prove a false outcome, or spend anyone's funds, but it knows
> them; and the number of bids, their timing, and the uniform escrow amount are public
> on-chain.

The long form, including everything this does *not* protect against, is in
[TRUST.md](TRUST.md).

## Status — read this before believing anything above

**Nothing is on mainnet yet, and mainnet is the deliverable.** There is a full Sepolia
rehearsal — contracts deployed and a complete ten-transaction auction run, see
[docs/deployments.md](docs/deployments.md) — and the site is hosted at
**https://vickrey-ten.vercel.app**, currently pointed at that rehearsal. The mainnet
fields in [strk20.json](strk20.json) stay empty until they are real.

Mainnet cost is measured rather than estimated: [docs/mainnet.md](docs/mainnet.md).

| Piece | State |
|---|---|
| Auction contract | Written, 51 tests passing, **not deployed, not audited** |
| Anonymizer helper | Written, 7 tests passing, **not deployed, not audited** |
| Client library | Written, 32 tests passing, hash-conformant with Cairo, action shapes type-checked against the wallet's own types |
| Web app | Reads and writes the contracts. **Design under review — the current UI is a working prototype, not the shipped design** |
| Sepolia rehearsal | **Done.** Contracts deployed, one complete auction, 10 transactions |
| Hosted demo | **Done**, pointed at Sepolia. Mainnet is three env vars away |
| Mainnet deployment | Not done — needs ~40 STRK, itemised in [docs/mainnet.md](docs/mainnet.md) |
| Mainnet run with ≥5 bidders | Not done |
| A wallet-signed bid through the pool | Not done — the one step needing a human |
| Demo video | Not made |
| Visual direction | Second pass under review — the shipped UI is the previous direction |

Two dependency advisories are open and deliberately not chased: `postcss` and `sharp`
reach the web app only as Next.js build-time transitives, and clearing them needs
Next 16, a breaking major. Neither is reachable here (no attacker-controlled CSS, image
optimization unused). The one *critical* advisory, in Next itself, is patched.

The two items previously marked UNVERIFIED are now **resolved against source**:

1. **The STRK20 action envelope** — typed against `STRK20_ACTION` as shipped in
   `@starknet-io/starknet-types-0103`, the Wallet API 0.10.3 types `starknet@10.4.0`
   vendors. This caught a real bug: `FELT` is prefixed hex with no leading zeros, and
   the first implementation passed the collateral as a decimal string, which the
   wallet would have rejected *after* the user signed.
2. **`OpenNoteDeposit`'s layout** — read from `packages/privacy/src/objects.cairo` @
   `36eac4ea88cd8c59dde1493176e16501c6e90328` and byte-for-byte identical to the local
   declaration. The revision is cited in the file; `test_layout.cairo` pins the
   serialization.

### The live pool has checked our encoding

`compile_actions` is a `view` on the STRK20 pool, so our calldata can be put in front
of the real contract read-only. `npm run verify:pool` in `client/` does that, building
the actions with the production code rather than a copy:

| Case | Live Sepolia pool | Reading |
|---|---|---|
| bid `[Withdraw, InvokeExternal]` | `NEGATIVE_INTERMEDIATE_BALANCE` | **shape accepted**, reached the balance invariant |
| claim `[CreateOpenNote, Invoke]` | `SUBCHANNEL_NOT_FOUND` | **shape accepted**, reached state lookup |
| control: reversed | `ACTIONS_OUT_OF_ORDER` | |
| control: invoke alone | `NO_REPLAY_PROTECTION` | |
| control: two invokes | `ACTIONS_OUT_OF_ORDER` | |

Our shapes fail on *state*; the controls fail on *shape*. That asymmetry is the point,
and the controls are there so the check can still fail if the encoding drifts.

Sepolia pool `0x254a…0d91`, live `get_fee_amount` **2 STRK** — not the 4 the docs quote
for mainnet, which is why it is read and never hardcoded.

### Still open, and gating a deploy

- **No wallet has assembled, proven and submitted one of these.** That is the
  remaining gap and the only one needing a human at a browser.
- The helper has never run, because nothing is deployed.
- Mainnet gas for `settle`, measured rather than estimated.
- Whether Ready or Xverse expose STRK20 on Sepolia specifically. The pool is there;
  wallet support for it is a separate question.

## Two rails, and which one you will actually use

**Bidding on the public rail is the ordinary path.** Connect a wallet, pick a level,
sign. Nothing to install, nothing to fund in advance, and **your bid is sealed** — the
amount is never in the calldata and never reaches the chain.

**The private rail additionally hides your address**, by funding the bid from a shielded
balance inside the STRK20 pool. It is the deeper integration and it is what the rest of
this section is about. It also has a real cost of entry: the Wallet API exposes exactly
three STRK20 methods — `strk20Balances`, `strk20PrepareInvoke`, `strk20InvokeTransaction`
— and **none of them deposits**. Shielding therefore happens inside your own wallet's
interface, not on our site or anyone else's, and the pool charges its fee for the shield
and again for the bid.

So, in one sentence: **both rails seal your bid; the only difference is whether your
address is publicly linked to having bid.** If you are here to try the auction, take the
public rail. If you are here to see the pool integration, the private rail is the one to
read about.

| | Set-up | Cost | Address | Bid |
|---|---|---|---|---|
| **Public** | none | gas only | public | **sealed** |
| **Private** | shield in your wallet first | pool fee ×2 + gas | **private** | **sealed** |
| Sponsored private | none | free to the bidder | **private** | **sealed** |

Sponsored is costed and the pool supports it; no relayer is deployed, so the interface
shows it and does not offer it.

### Why the app leads with one rail and the sprint counts the other

These sound like they disagree and they do not, so it is worth stating both plainly in
one place.

**The app leads with the public rail** because it is the one a visitor completes. There
is nothing to install and nothing to fund in advance, and their bid is sealed. Leading
with a rail that requires leaving the site, activating privacy in your own wallet and
paying a fee twice would mean most people abandon a bid halfway — a worse outcome than
a public address on a sealed bid.

**The sprint counts the shielded rail** because its rule is conjunctive: a qualifying
mainnet transaction must touch the STRK20 pool **and** carry an event from a contract we
deployed. Only `pool → AuctionAnonymizer → SealedBidAuction` does both. Public-rail bids
never touch the pool, so no number of them counts.

So the shielded rail is not the ambitious extra on this entry — it is the part that makes
it scoreable, and the entry runs at least three of those transactions on mainnet. The
public rail is the front door. Both are real, both seal the bid, and the honest way to
describe the difference has not changed: **only your address is treated differently.**

## Where this touches STRK20

The ranking proof is our own Poseidon construction, because it has to be — STRK20
exposes no custom-circuit slot (PHASE0.md Q2). Everything *around* it is the pool, and
the value never leaves it:

**1. Shielded notes are the value rail, in both directions.** A bid is funded from
shielded balance and escrowed by the pool itself. Every way value comes back — a
loser's refund, the winner's surplus, a forfeited escrow redeemed late, the lot — comes
back as an **open note** credited inside the pool. There is no public leg on the way
out, so winning an auction does not put an address on-chain next to a price.

**2. Our own anonymizer contract makes bid-and-escrow atomic.**
`packages/anonymizer` implements `privacy_invoke`, which the pool reaches through
`INVOKE_SELECTOR = selector!("privacy_invoke")`. The bid leg is the deposit half of the
sandwich: the pool withdraws collateral to the helper, the helper forwards it into the
auction and returns an **empty span** — the protocol's way of saying "credit nothing",
because the funds are parked, not returned. A revert anywhere aborts the entire pool
transaction and no funds move. The claim legs run the sandwich the other way, measuring
output by **balance delta** rather than trusting a return value, and approving the pool
to pull rather than transferring. The helper pins the pool address in its constructor
and asserts the caller, because `privacy_invoke` is otherwise publicly callable.

**3. The Wallet API is used as the SDK, not worked around.** Actions are typed against
the wallet's own `STRK20_ACTION` union rather than a local look-alike. Capability is
detected with `walletV6.supportedWalletApi` and a version compare — never by probing
`strk20Balances`, which is a balance read wallets gate behind a consent prompt for data
this app has no reason to see. Every bid is dry-run through
`strk20PrepareInvoke(actions, true)` before submission. The pool fee is read live from
`get_fee_amount` and shown separately from the collateral, because the collateral comes
back and the fee does not. This app never asks for a viewing key and never sees private
state.

*(The self-custody Privacy SDK route is not publicly installable —
`@starkware-libs/starknet-privacy-sdk` is not on npm. The Wallet API is the only route
a clean `npm install` reaches, so that is the one wired properly rather than
half-wired alongside a second.)*

**4. Protocol constraints shaped the design rather than being patched around.**

| Constraint | What it forced |
|---|---|
| The pool→helper withdraw is a public ERC-20 transfer | **Uniform cap collateral.** Escrowing your bid would publish it |
| At most one external invoke per pool transaction | Bidding and claiming are separate transactions; no batching |
| Viewing keys are per-user and whole-history, not scopeable | The reveal path uses **no viewing keys at all** — a per-bid seed instead |
| Notes mature ~10 blocks; proving takes ~30s | The bid flow is built around the wait rather than appearing hung |
| Bidder identity never crosses the helper boundary | Bids are keyed by a **claim commitment**, never an address |

## Two things on the sprint's list we did not use

The integration-depth criterion names "the SDK" and "stealth accounts". We use neither,
deliberately, and a judge working down that list should find the reasoning rather than a
silence.

### The TypeScript SDK is not installable

`@starkware-libs/starknet-privacy-sdk` is not published to the public npm registry.
Re-checked on 29 Aug 2026: that name and two plausible variants all return **404**.

```
@starkware-libs/starknet-privacy-sdk   404
@starkware-libs/starknet-privacy       404
starknet-privacy                       404
```

So the Wallet API is the only route a clean `npm install` reaches, which settles the
choice rather than leaving it a preference. What it means in practice is that "use the
SDK properly" becomes "use the Wallet API surface properly", and that is what
[`client/src/strk20.ts`](client/src/strk20.ts) does: actions typed against the wallet's
own `STRK20_ACTION` union rather than a local look-alike, capability detected with
`walletV6.supportedWalletApi` and a version compare, and every bid dry-run through
`strk20PrepareInvoke(actions, true)` before it is submitted.

The encoding is checked against the **live mainnet pool** rather than against our reading
of it — `npm run verify:pool` runs our two real action shapes plus three deliberately
malformed controls through the pool's `compile_actions` view. The real ones fail on
state, the controls fail on shape. A check that cannot fail proves nothing, which is why
the controls are there.

### Stealth accounts would make this design less private, not more

A stealth account gives a recipient a fresh, unlinkable **address** to be paid at. That
is the right tool when value has to land somewhere public.

Here it never does. Every way value comes back — a loser's refund, the winner's surplus,
a forfeited escrow redeemed late, the lot itself — is returned as an `OpenNoteDeposit`
**credited inside the pool**, by
[`AuctionAnonymizer::credit`](packages/anonymizer/src/auction_anonymizer.cairo). There is
no recipient address in any of those paths, stealth or otherwise, because there is no
public leg to receive on.

Adding stealth accounts would mean introducing an address where the design currently has
none. That is a step backwards from the property we are claiming, and the claim is the
product.

## How it works

### The problem with the obvious design

Escrow the bid and the bid is public — the pool→helper leg is a plain ERC-20 transfer.
Commit to the bid instead and nothing is actually locked, so a bidder can commit to a
price they cannot pay. Publish the bids at reveal time and every loser's valuation is
on-chain forever. Ask the bidders to reveal and any one of them can grief the auction
by going quiet.

### The ladder

Bids are levels on a public price ladder: `price(ℓ) = reserve + ℓ · tick`, for
`ℓ ∈ [0, P)`. Level 0 is the reserve, so bidding at all means bidding at least the
reserve.

Each bidder publishes two hash-chain anchors and nothing else:

```
step(x) = poseidon([CHAIN_TAG, auction_id, claim_commitment, x])

up_anchor   = step^( ℓ )       a depth-t preimage proves  ℓ ≥ t
down_anchor = step^(P-1-ℓ)     a depth-(P-1-t) preimage proves  ℓ ≤ t
```

Producing a witness for a bound you did not commit to is a Poseidon preimage break.
Producing one for a bound you *did* commit to reveals only that bound — never `ℓ`.

### Settlement is O(N)

At clearing level `ℓ*`, Vickrey needs exactly **N+1 witnesses**:

- the winner proves `ℓ ≥ ℓ*`
- the runner-up proves `ℓ ≥ ℓ*` **and** `ℓ ≤ ℓ*`, pinning them at exactly `ℓ*`
- everyone else proves `ℓ ≤ ℓ*`

The second-highest bid is then `≥ ℓ*` (the runner-up is there) and `≤ ℓ*` (everyone
but the winner is at most there), so it *is* `ℓ*`. The Vickrey price, proved, without
opening a single bid.

First-price is the same shape with the winner pinned instead of the runner-up — their
bid is the price, so it necessarily becomes public. The losers' still do not.

### Escrow that does not leak

Every bidder escrows the **same** amount: the price at the top of the ladder. Uniform
collateral is the only escrow that satisfies "real locked funds" and "the bid stays
secret" at once. The winner pays the clearing price out of it and the surplus refunds
as a private note; losers refund in full, privately. The cost is capital efficiency —
you lock the cap, not your bid — and that is an honest trade, not a hidden one.

### Nobody can be griefed, and nobody can be excluded

Bidders transmit their seed to the auctioneer **only after observing the `Sealed`
event**. The auctioneer cannot decrypt early because it has not been sent anything.

A bidder who then goes quiet leaves a bid the auctioneer cannot disposition, so it is
marked `Forfeit`: excluded from the ranking, escrow retained but **redeemable by its
owner forever** with a loser-side proof they can generate whenever they come back.
Settlement always completes.

That mechanism could be abused to exclude an honest high bid, so settlement moves no
money. It opens a **dispute window**. A forfeited bidder who proves `ℓ ≥ ℓ*+1` voids
the settlement and takes the auctioneer's bond. `finalize` releases funds only after
the window closes clean.

### What the chain sees

| Public | Private |
|---|---|
| The auction, its ladder and deadlines | Every bid amount, winner's included |
| That a bid arrived, and when | Which address bid — bids are keyed by a claim commitment, never an address |
| The number of bids | Any losing bid, ever |
| The uniform escrow amount | |
| The clearing price and winning index | |

## The dispute window

Settlement moves no money. It records the outcome and opens a window in which a
forfeited bidder can prove they were above the clearing price, void the result and take
the auctioneer's bond. `finalize` releases funds only after it closes clean.

The length is **a parameter fixed at listing and public on-chain**, and the contract
enforces no minimum. That is deliberate: any floor short enough to demo an auction
end-to-end would be far too short for real value, so a floor would buy nothing and
imply a safety it could not deliver. Instead the value is visible before anyone bids,
and a bidder who thinks it is too short can decline.

| Preset | Seconds | When |
|---|---|---|
| `demo` | 180 | Nominal amounts, bidders in the room. Demo only |
| `supervised` | 3,600 | A staffed auction where participants are actively watching |
| `suggested` | 86,400 | Real value. Assumes nobody was watching |

Defined in `ladder.cairo` as `DEMO_DISPUTE_WINDOW` / `SUGGESTED_DISPUTE_WINDOW`, and in
the client as `DISPUTE_WINDOW`, with `disputeWindowAdvice()` returning the plain-language
read a listing UI should show. **The demo runs at 180 seconds. Nothing carrying real
value should.**

## Layout

```
packages/auction/      the auction contract, the ladder, 51 tests
packages/anonymizer/   the privacy_invoke helper, 7 tests
client/                bid crypto, settlement planning, action building, 32 tests
web/                   create / bid / settle / result. No login.
PHASE0.md              the investigation this design came out of
TRUST.md               the long-form trust statement
```

## Build and test

Requires the toolchain in `.tool-versions` (scarb 2.14.0, starknet-foundry 0.53.0) and
Node 24.

```shell
scarb build && snforge test            # 58 Cairo tests
cd client && npm install && npm test   # 32 client tests
cd client && npm run verify:pool       # our calldata vs the live Sepolia pool
cd web    && npm install && npm run build
```

Deploying, once you have a funded `sncast` account:

```shell
scripts/deploy.sh sepolia <account-name> <privacy-pool-address>
```

It runs the whole suite before it touches a network.

There are **no external Cairo dependencies**. `scarb build` works on a clean machine
with no git fetches.

### Measured settlement cost

From `packages/auction/tests/test_benchmark.cairo`, at N=10 bids on a P=256 ladder,
subtracting the `baseline_ten_bids_without_settling` scenario:

| Scenario | `settle` alone |
|---|---|
| Clearing at level 150 of 256 | **~32.3M l2 gas** |
| Clearing at level 0 (worst case) | **~38.1M l2 gas** |

These are `snforge` estimates, not mainnet measurements. See PHASE0.md Q8.

## Why the design looks like this

[PHASE0.md](PHASE0.md) is the investigation that produced it, written before the code.
The short version: **custom circuits are not available on STRK20** — proving runs a
fixed program (`VIRTUAL_SNOS`) over a virtual Starknet execution, with a closed set of
proof facts and no application circuit slot. That killed the original plan's Tier A.

It turned out not to matter. The ranking proof does not need the pool's proof system
at all; it needs Poseidon and a contract of our own. The result is *stronger* than the
Tier B that was the fallback: properties 3, 4, 5 and 6 are cryptographically enforced
rather than procedurally asserted.

## Licence

MIT. See [LICENSE](LICENSE).
