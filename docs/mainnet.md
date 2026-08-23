# Mainnet: the deliverable

Sepolia was a rehearsal. The sprint requires mainnet transactions and a demo anyone
can open, so mainnet is the target and nothing in the code assumes a testnet run will
be available for the pool leg.

Everything below is **measured**, not estimated from documentation: Sepolia resource
usage read from transaction receipts and repriced at live mainnet gas.

The build being shipped has been rehearsed twice —
[`sepolia-run-1.json`](sepolia-run-1.json) and
[`sepolia-run-2.json`](sepolia-run-2.json). The second ran on the merged `main` build
after confirming the deployed classes match the local artifacts byte-for-byte:

```
SealedBidAuction    local dev build == Sepolia  0x1489a905…b94b341
AuctionAnonymizer   local dev build == Sepolia  0x5197552b…3646e0e
```

That check is the point of the rehearsal. "We tested on Sepolia" means nothing if the
bytes differ; comparing computed class hashes is the only way to say the deployment path
was exercised on exactly the code that ships.

### What the second rehearsal caught

Three separate bugs in `scripts/deploy.sh`, all of which would have fired on mainnet:

1. **`--network` conflicted with the `url` in `snfoundry.toml`** — every sncast call
   failed. Fixed by passing `--url` explicitly and depending on nothing in that file.
2. **The output parser never matched.** `field 'Class'` looked for a line starting
   `Class:`; sncast prints `Class Hash: 0x…`. It returned empty, so the script would have
   *paid for the declare* and then exited with "declare produced no class hash", losing
   the class hash of a transaction that had already succeeded. The same bug hit
   `Contract Address:`.
3. **A re-run re-declared.** With the class already on chain, a resumed deploy tried to
   pay for it again. `deploy.sh` now computes the class hash from the artifact, asks the
   node whether it exists, and skips only when *this* build is already there — so a run
   interrupted between the two declares picks up where it stopped.

Bugs 2 and 3 compound: the first loses the class hash of a paid declare, the second makes
the obvious recovery — just run it again — cost another 31 STRK.

## What differs on mainnet

| | Sepolia | Mainnet |
|---|---|---|
| Pool address | `0x254a…0d91` | `0x0403…812a` |
| Pool class hash | `0x56ab…3b2` | `0x67dd…54d` — **a different version** |
| `get_fee_amount` | 2 STRK | **6 STRK** |
| `get_proof_validity_blocks` | 450 | 450 |
| Paused | no | no |

**The pool fee is 6 STRK, not the 4 the documentation quotes and not the 2 Sepolia
charges.** It is governance-settable, so read it at the time; the numbers below use 6.

**The class hashes differ, so the mainnet pool is a different build.** Our action
shapes were therefore re-verified against it directly:

```
STARKNET_RPC=https://api.cartridge.gg/x/starknet/mainnet \
POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a \
node client/scripts/verify-pool-shapes.mjs
```

All five cases behave identically to Sepolia — our two shapes fail on state, the three
controls fail on shape. The encoding carries over.

## Mainnet cost, estimated against mainnet

Superseding the Sepolia reprice that used to be here. These come from
`starknet_estimateFee` called on the mainnet RPC with `simulation_flags:
["SKIP_VALIDATE"]`, at **block 13756429**, l2 gas 30,383,114,633 fri/unit.

It is a read call. Nothing was signed and nothing was submitted. The sender is
borrowed from a recent mainnet block so the nonce resolves — with `SKIP_VALIDATE` the
node ignores the signature, which is why a zero-balance stranger can price a declare.
Pin the estimate to the block the nonce was read at, or a busy borrowed sender's nonce
moves underneath you and the failure reads as a nonce bug rather than a race.

| Step | l2 gas | **Node estimate** |
|---|---|---|
| declare `SealedBidAuction` | 1,142,449,440 | **34.71 STRK** |
| declare `AuctionAnonymizer` | 248,928,416 | **7.56 STRK** |
| deploy an OZ account | — | 0.07 STRK |
| deploy both contracts | ~3.6M | ~0.12 STRK |
| full auction lifecycle, 9 tx | ~55.0M | ~1.84 STRK |

> **A trap worth naming.** `starknet.js`'s `EstimateFee.overall_fee` is **pre-padded by
> ~2.05×** — it returned 71.00 and 15.47 for the two declares. The node's own
> `overall_fee` is 34.71 and 7.56. Read the raw JSON-RPC result; a number taken from
> the library and treated as the estimate overstates the cost by more than double.

**The Sepolia reprice was low but not wrong.** It projected 31.48 STRK for the auction
declare against an actual mainnet estimate of 34.71 — mainnet consumes about 1.10× the
l2 gas Sepolia does for the same class. The method was sound; it just had no way to see
the network difference.

### What must be *held*, which is still the gate

`sncast` demanded 1,437,474,240 l2 gas for a class whose Sepolia receipt charged
1,038,760,640 — a **1.384× margin**. Applied to the mainnet estimates:

| | Spends | Must hold |
|---|---|---|
| declare `SealedBidAuction` | 34.71 | **~48.0** |
| declare `AuctionAnonymizer` | 7.56 | ~10.5 |
| deploys + account | 0.19 | ~0.3 |
| **contracts up** | **~42.5** | **~58.8** |

### The submission total

| | STRK |
|---|---|
| Contracts up (spent) | 42.5 |
| Shield into the pool, once | 6 |
| Three qualifying pool transactions | 18 |
| Auction gas, mainnet | 1.8 |
| **Total spent** | **≈ 68.3** |
| **Peak held, at the first declare** | **≈ 58.8** |

**70 STRK leaves 1.7 STRK of slack.** That is not a margin, it is a rounding error —
one gas spike, one retried transaction, or one extra pool operation and the run stops
with the entry unscoreable. **Send 85.**

## What the submission rule actually requires

Verified verbatim from `starkience/strk20-hackathon` `CONTRIBUTING.md`, not inferred:

> **`transactions`** - at least three mainnet transaction hashes. Each is checked
> against the chain: it must exist, have succeeded, and have touched the STRK20 pool.
> **If you listed anything in `contracts`, the transaction must also carry an event from
> one of them** - touching the pool through someone else's contract is not your project
> running on mainnet.

And from `README.md`:

> To win, your app must run on **Starknet mainnet** against the live STRK20 pool, with
> at least **three mainnet transactions** that touched the pool, listed by hash in your
> `strk20.json`.

**So a direct auction-contract bid does not count, and neither does a bare pool
deposit.** The rule is conjunctive: each of the three must touch the pool *and* carry an
event from a contract we listed. Only transactions that route pool → anonymizer →
auction satisfy both.

Our path does. `SealedBidAuction` emits `BidPlaced`, `RefundClaimed` and `LotClaimed`,
so a bid, a refund and a lot claim placed through the pool are three qualifying
transactions.

Two consequences:

- **The shield does not count.** It touches the pool but carries no event of ours. It is
  still required — bids are funded from shielded balance — so budget four pool
  operations, not three.
- **`AuctionAnonymizer` emits no events at all.** The rule is satisfied by the auction's
  events, so this is not a blocker. But the contract that performs the actual STRK20
  integration is currently invisible in its own transactions, and STRK20 integration
  depth is 30% of the score. Adding an event costs nothing before the declare and is
  impossible after it without paying 42.5 STRK to redeclare.

Also worth noting, since it settles how sponsorship is treated:

> Hashes rather than an address because private transactions are relayed, so the
> on-chain sender is never you.

Relayed transactions are expected, not tolerated. The sponsored rail is not a workaround.

## Verified endpoints

Fetched, not assumed.

| | Result |
|---|---|
| `api.cartridge.gg/x/starknet/mainnet` | alive, spec **0.10.2**, chain `0x534e5f4d41494e` |
| `starkscan.co/contract/<addr>` | **200** |
| `starkscan.co/tx/<hash>` | **200** |
| `voyager.online/*` | 403 — Cloudflare bot-block, fine in a browser |
| `sepolia.starkscan.co` | **no DNS record, no response.** Still dead |

Mainnet uses `starkscan.co`; Sepolia uses `sepolia.voyager.online`. The patterns are
not symmetric and assuming they were is what produced the original dead link.

Live pool reads at the same block: `get_fee_amount` = **6 STRK**,
`get_proof_validity_blocks` = 450, `is_paused` = 0.

## Per-step lifecycle gas, measured on Sepolia

*Superseded for the declares by the mainnet estimates above; still the best source for
the per-step lifecycle costs, which cannot be estimated on mainnet until the classes
are declared. Multiply by ~1.10 for mainnet.*

### Two numbers per step, and the one that matters

Every step below has a **measured** cost and a **bound**. Measured is what the receipt
charged. Bound is what the fee estimator demands the account hold before it will submit
at all. They are not close: on the declares the bound runs ~38% above measured.

The bound is the gate. A rehearsal on 58.99 test STRK died at

```
Resources bounds ({ … l2_gas: { max_amount: 1437474240, … } }) exceed balance (58990874389328446572)
```

even though the same declare had previously *charged* 1,038,760,640 — about 31 STRK
against a 65 STRK bar. **Fund against the bound; expect to be charged the measured
figure.** Budgeting from the receipts of a previous run is how you arrive at a wallet
that cannot submit the transaction it just paid to estimate.

Amounts are network-independent, so Sepolia measurements reprice directly onto mainnet.
Both columns below are those amounts at mainnet gas of the time of writing
(l2 30,303,966,046 fri/unit); the source of truth is
[`scripts/gas-profile.json`](../scripts/gas-profile.json), which `deploy.sh` reads so the
script and this table cannot drift apart.

| Operation | l2 gas (measured) | Measured | **Must hold** |
|---|---|---|---|
| declare `SealedBidAuction` | 1,038,760,640 | 31.48 | **43.56** |
| declare `AuctionAnonymizer` | 226,468,800 | 6.86 | 9.49 |
| deploy `SealedBidAuction` | 1,328,000 | 0.04 | 0.06 |
| deploy `AuctionAnonymizer` | 2,312,480 | 0.07 | 0.11 |
| `create_auction` | 12,004,560 | 0.36 | 0.55 |
| `place_bid` (first) | 7,638,080 | 0.23 | 0.35 |
| `place_bid` (subsequent) | 6,834,080 | 0.21 | 0.31 |
| `seal` | 3,351,520 | 0.10 | 0.15 |
| `settle`, 3 bids | 6,946,080 | 0.21 | 0.32 |
| `finalize` | 4,496,080 | 0.14 | 0.20 |
| `claim_lot` | 3,590,480 | 0.11 | 0.16 |
| `claim_refund` | 3,325,840 | 0.10 | 0.15 |
| **declares + deploys** | | **38.45** | **53.21** |
| **full lifecycle** | | **39.71** | **55.09** |

The first `place_bid` costs more than the ones after it — it pays to initialise the
auction's bid storage. Only the declare bounds are measured; the rest are the same
1.384 ratio applied to the measured figure, which is conservative for the small steps
and exact where it matters.

### The release profile does not help, and we are not using it

`Scarb.toml` carries `[profile.release.cairo] inlining-strategy = 75`, added after a
sweep, on the theory that a smaller Sierra makes the largest one-off cost smaller. It
does shrink the artifact:

| | dev | release |
|---|---|---|
| `SealedBidAuction` Sierra | 511,355 B | 387,276 B (−24%) |
| `SealedBidAuction` CASM | 17,147 felts | 15,807 felts (−8%) |
| `AuctionAnonymizer` CASM | 3,616 felts | 3,829 felts (**+6%**) |

**But the declare bound is identical either way — 1,437,474,240 l2 gas, measured both
ways against the live node.** The saving does not exist where it was claimed, and
inlining makes the anonymizer *larger*. An earlier version of this file said the declare
figure was "after a 10% Sierra reduction"; that was wrong on both counts — the figure
came from a dev build, and the reduction does not move the number that gates the spend.

So we declare the **dev** build. It is the build whose class hashes are verified byte-for-byte
against the contracts that ran the full Sepolia lifecycle, and switching to an unverified
artifact to chase a saving that measurement says is zero is a bad trade on the single most
expensive transaction in the project.

## What to fund, itemised

Two separate questions: getting the contracts up, and running the judged auction. The
first is a *holding* requirement, the second a *spending* one.

### A. One-off, unavoidable

| Item | Must hold | Actually spends |
|---|---|---|
| Deploy a mainnet account | ~0.1 | 0.07 |
| Declare `SealedBidAuction` | 48.0 | 34.71 |
| Declare `AuctionAnonymizer` | 10.5 | 7.56 |
| Deploy both | 0.17 | 0.11 |
| | **≈ 58.8 STRK at the first declare** | **≈ 42.5 STRK gone** |

**Do not change the contracts after declaring** — every code change is another 42.5 STRK
spent and 58.8 that has to be sitting there.

### B. The judged auction, run through the pool

This is where the pool fee bites: **6 STRK per private operation**, not sponsored by
wallet flows.

Per bidder, a full round trip is three private operations:

| Step | Pool fee | Why |
|---|---|---|
| Shield STRK into the pool | 6 | Must happen well before bidding, or timing links the deposit to the bid |
| Place the bid | 6 | withdraw + invoke, one transaction |
| Collect the refund | 6 | Or the surplus, if they won |

**18 STRK per bidder**, plus the winner's `claim_lot` at another 6.

Escrow is the ladder cap and is refunded, so set it nominal — 0.001 STRK ladder, 8
levels, cap 0.008. It is public and identical for everyone, so a small number costs
nothing in credibility.

### The honest total

Per the submission rule quoted above, each of the three transactions must touch the pool
**and** carry an event from a contract we listed. A bare shield satisfies the first and
not the second, so it is a fourth pool operation rather than one of the three.

| | Spends | Peak holding | Buys |
|---|---|---|---|
| Deploy only | 42.5 | 58.8 | Contracts on mainnet, nothing running |
| **Submission minimum** | **68.3** | **58.8** | Deploy, shield once, three qualifying pool transactions, gas |
| Judge-friendly | ~128 | 58.8 | The above plus ten sponsored private bids |
| Five-bidder pool auction | ~164 | 58.8 | The plan's full target |

Peak holding is flat because the declare is the first thing that happens and the most
expensive single moment; everything after it is cheap by comparison.

**Send 85 STRK.** 70 covers the 68.3 minimum by 1.7 STRK, which is not a margin — one
gas spike, one retried transaction, or one extra pool operation and the run stops with
the entry unscoreable. The declare bound scales linearly with gas price, so a 15% rise
between funding and declaring eats the difference on its own.

`deploy.sh` prints the bound, the balance and the headroom before it spends anything,
and refuses to start when the balance is under the bound.

## Open questions this raises

- **Who pays the pool fee for a judge who wanders in and bids?** They do, out of their
  own shielded balance. That is 12 STRK for a stranger to try the demo, which is a real
  barrier and worth saying plainly on the page rather than letting them discover it at
  the signing prompt.
- **Do the five bidders need to be five different wallets?** If so they each need
  shielded STRK, and funding five strangers is its own task. Recruit early.
- Whether wallet flows sponsor any part of the pool fee in practice. The documentation
  says gas yes, pool fee no. Worth confirming with the first real bid.

## Sequence

Steps 2 through 4 are one command. It builds, runs the 58 tests, checks the chain and
the balance, declares only what is not already declared, deploys, and reads both
contracts back before writing anything down.

```
scripts/deploy.sh mainnet <sncast-account>
```

1. **Create and deploy a mainnet account, and fund it.** The keystore has only a
   Sepolia account today. Everything below refuses to run until this exists and holds
   the bound.

2. **Run the command.** It refuses to spend if the chain is wrong, the pool class has
   moved, or the balance is under the estimator bound — all before `scarb build`. On
   success it writes `deployments.mainnet.json` and prints the class hashes.

   The class hashes are already known and are in `strk20.json`:

   ```
   SealedBidAuction    0x1489a905a59d25614300504355ecd9df25e34bc8b099485512d44cc7b94b341
   AuctionAnonymizer   0x5197552b8a5d886b024ed281242c001c8b84aabc8d95edd014ff2b673646e0e
   ```

   **If the declare prints something different, stop.** It means the build is not the
   one that was rehearsed, and the contracts on mainnet would be untested code.

   Note it builds with the **dev** profile, not `-P release`. That is deliberate — see
   "The release profile does not help" above.

3. **If it dies partway, just run it again.** It skips whatever is already declared, so
   a re-run costs the deploys and nothing else.

4. **Point the hosted app at the addresses** — the command prints the three `vercel env`
   lines.

5. **Run one auction without the pool** to prove the contracts work on mainnet:
   `AUCTION=<addr> NETWORK=mainnet node scripts/live-auction.mjs`. Ten transactions,
   about 1.3 STRK. These do **not** satisfy the submission rule — they never touch the
   pool — but they prove the deployment before any pool money is spent.

6. **Only then attempt the pool leg**, dry-run first. This is the part nobody has run.

## The declare date

Deadline **Mon 31 Aug 2026, 23:59 UTC** — submissions close, and whatever the repo
shows at that moment is the entry. There is no separate submission step.

Working backwards from what has to be true at the end — a five-bidder auction run, a
video recorded, and `strk20.json` filled with three verified pool transactions:

| Day | | What has to happen |
|---|---|---|
| Wed 26 Aug | T-5 | **Recommended declare.** Declare, deploy, read back, point the site at mainnet |
| Thu 27 Aug | T-4 | First pool transaction end to end. This is where an unknown surfaces |
| Fri 28 Aug | T-3 | Five-bidder auction. Bidders recruited and rehearsed *before* today |
| Sat 29 Aug | T-2 | Record the video. Needs the auction already run |
| Sun 30 Aug | T-1 | `strk20.json`, README, link-check. Everything final |
| Mon 31 Aug | T-0 | Buffer. Something breaks on the last day; it always does |

**Recommended declare: Wed 26 Aug.** That leaves two clear days for the pool path,
which is the part nobody has ever run.

**Hard latest: Sat 29 Aug.** Declare and deploy in the morning, three pool
transactions in the afternoon, video Sunday, submit Monday. No room for a failed
declare, a wallet surprise, or a re-declare after a contract fix.

**Do not declare later than 29 Aug.** Past that there is no path to three verified pool
transactions and a video.

### The trade being made

Declaring before the wallet question is answered risks ~38 STRK on a second declare if
a contract change turns out to be needed. Being unproven on mainnet on 31 Aug costs the
entry. The second is worse, so the date wins over the certainty.

One mitigation, and it is worth taking: **run the pool leg against the Sepolia
deployment first if any wallet supports it.** The contracts there are the same class,
so a wallet failure found on Sepolia is a wallet failure we can fix before spending the
mainnet declare. If no wallet supports Sepolia, declare on the 26th and find out on
mainnet.
