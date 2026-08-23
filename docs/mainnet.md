# Mainnet: the deliverable

Sepolia was a rehearsal. The sprint requires mainnet transactions and a demo anyone
can open, so mainnet is the target and nothing in the code assumes a testnet run will
be available for the pool leg.

Everything below is **measured**, not estimated from documentation: Sepolia resource
usage read from the receipts of the ten-transaction run in
[`sepolia-run-1.json`](sepolia-run-1.json), repriced at live mainnet gas.

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

## Gas, measured

Sepolia resource usage repriced at mainnet gas. Declaring dominates everything else by
two orders of magnitude, because it scales with Sierra size.

| Operation | l2 gas | Mainnet cost |
|---|---|---|
| declare `SealedBidAuction` | 1,038,760,640 | **30.5 STRK** |
| declare `AuctionAnonymizer` | 226,468,800 | 7.4 STRK |
| deploy `SealedBidAuction` | 1,328,000 | 0.04 STRK |
| deploy `AuctionAnonymizer` | 2,312,480 | 0.08 STRK |
| `create_auction` | 12,004,560 | 0.39 STRK |
| `place_bid` | 7,638,080 | 0.25 STRK |
| `seal` | 3,351,520 | 0.11 STRK |
| `settle`, 3 bids | 6,946,080 | 0.23 STRK |
| `finalize` | 4,496,080 | 0.15 STRK |
| `claim_lot` / `claim_refund` | ~3.5M each | 0.12 STRK each |

The declare figure is **after** a 10% Sierra reduction from sweeping
`inlining-strategy` (75 beat the default; see `Scarb.toml`). Gas prices move, so treat
these as the right order of magnitude rather than a quote.

## What to fund, itemised

Two separate questions: getting the contracts up, and running the judged auction.

### A. One-off, unavoidable — **≈ 39 STRK**

| Item | STRK | Note |
|---|---|---|
| Deploy a mainnet account | ~0.5 | The keystore only has a Sepolia account today |
| Declare `SealedBidAuction` | 30.5 | One-off per class hash. Redeclaring after a code change costs this again |
| Declare `AuctionAnonymizer` | 7.4 | Same |
| Deploy both | 0.12 | |
| Headroom for gas movement | ~1 | |

**Budget 40 STRK, and do not change the contracts after declaring** — every code change
is another 38 STRK.

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

| Scenario | Bidders | Pool fees | Auction gas | Escrow (returned) | **Total** |
|---|---|---|---|---|---|
| Minimum viable — 3 mainnet transactions, no pool | 3 | 0 | ~2 | nominal | **~2 STRK** |
| Small pool demo | 3 | 60 | ~2 | nominal | **~62 STRK** |
| Full demo, plan's target | 5 | 96 | ~3 | nominal | **~99 STRK** |

Escrow is the ladder cap and is refunded, so set it nominal — 0.001 STRK ladder, 8
levels, cap 0.008. It is public and identical for everyone, so a small number costs
nothing in credibility.

### The honest total

| | STRK |
|---|---|
| Contracts up, plus a first auction run without the pool | **~42** |
| The above, plus a five-bidder auction through the pool | **~140** |

I would fund **50 STRK now** to get the contracts deployed and a real auction on
mainnet, then decide on the pool demo separately once a wallet has signed one bid.
Spending 96 STRK on pool fees before knowing a wallet can assemble our transaction is
the wrong order.

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
