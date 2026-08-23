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

## Gas: two numbers per step, and the one that matters

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
| Deploy a mainnet account | ~0.5 | ~0.5 |
| Declare `SealedBidAuction` | 43.56 | 31.48 |
| Declare `AuctionAnonymizer` | 9.49 | 6.86 |
| Deploy both | 0.17 | 0.11 |
| | **≈ 54 STRK at the first declare** | **≈ 39 STRK gone** |

**Do not change the contracts after declaring** — every code change is another 38 STRK
spent and 53 that has to be sitting there.

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

The sprint's submission rule sets the floor:

> at least three mainnet transaction hashes … it must exist, have succeeded, and **have
> touched the STRK20 pool**.

Bids placed directly on our contract do not touch the pool, so they cannot be the three
transactions. At least three **pool** transactions are unavoidable, at 6 STRK each.

| | Spends | Peak holding | Buys |
|---|---|---|---|
| Deploy only | ~39 | ~54 | Contracts on mainnet, nothing running |
| **Submission minimum** | **~65** | **~54** | Deploy, shield once, three pool transactions, gas |
| Judge-friendly | ~125 | ~54 | The above plus ten sponsored private bids |
| Five-bidder pool auction | ~160 | ~54 | The plan's full target |

Peak holding is flat across the rows because the declare is the first thing that happens
and the most expensive single moment; everything after it is cheap by comparison.

**70 STRK covers this at today's gas** — it clears the 54 bound at the declare and the
65 of total spending, with ~5 STRK of slack. That slack is the whole margin, and it is
thin:

- **If mainnet l2 gas rises ~30% before the declare, 70 stops being enough.** The bound
  scales linearly with gas price, so a 43.56 declare becomes 56.6 and the run strands
  with nothing declared.
- **Declare first, on a full wallet, when gas is low.** `deploy.sh` prints the bound,
  the balance and the headroom before it spends anything, and refuses to start if the
  balance is under the bound.
- **85 STRK removes the gas-movement risk.** If the funding decision is still open, that
  is the number I would send.

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

1. Create and deploy a mainnet account; fund it.
2. `scarb -P release build`, then declare both classes. **Record the class hashes.**
3. Deploy `SealedBidAuction`, then `AuctionAnonymizer` with the **mainnet** pool
   address and the auction address.
4. Read both back — `privacy_contract()` must equal the mainnet pool.
5. Point the hosted app at the mainnet addresses.
6. Run one auction without the pool for the three-transaction requirement.
7. Only then attempt the pool leg, dry-run first.

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
