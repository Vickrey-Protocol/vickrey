# Deployments and live evidence

Everything here was read back from chain, not copied from a plan.

## Sepolia — rehearsal only

**Sepolia is a rehearsal, not the deliverable.** The sprint requires mainnet. Nothing
in the code assumes a Sepolia run will be possible for the pool leg — see
`docs/mainnet.md`.

| | |
|---|---|
| `SealedBidAuction` | [`0x0335410610f81d3028be938f9476006935c3098de5b88a6647b67efb89db4ff3`](https://sepolia.starkscan.co/contract/0x0335410610f81d3028be938f9476006935c3098de5b88a6647b67efb89db4ff3) |
| class hash | `0x1489a905a59d25614300504355ecd9df25e34bc8b099485512d44cc7b94b341` |
| `AuctionAnonymizer` | [`0x0316389f97ce430e56a80dbfff0fab9725889a021a9ea29b14fa3f48ac65fe16`](https://sepolia.starkscan.co/contract/0x0316389f97ce430e56a80dbfff0fab9725889a021a9ea29b14fa3f48ac65fe16) |
| class hash | `0x5197552b8a5d886b024ed281242c001c8b84aabc8d95edd014ff2b673646e0e` |
| STRK20 pool (theirs) | `0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| pool `get_fee_amount` | 2 STRK |

The anonymizer's constructor pins the pool address, and `privacy_contract()` reads
back as the pool above.

## A complete auction, on chain

Ten transactions, run by `scripts/live-auction.mjs` using the production client
library. Three bids at ladder levels 6, 4 and 1; Vickrey clears at the second-highest,
level 4.

Hashes in [`sepolia-run-1.json`](sepolia-run-1.json). The settlement is the one to
look at:

- **settle** `0x4e6890dbc8c0d4fb687a9d5ea6292d8771566eb18b518d7a53c95d0f9a63e91`

On-chain state after it: `clearing_level = 4`, `winner_index = 0`. The contract
verified four hash-chain witnesses to accept that, and **no bid amount appears in any
of the ten transactions** — the winner's included.

This exercises the auction layer with direct calls. It does not go through the pool,
which is why it can run unattended: the pool leg needs a privacy wallet to produce the
proof.

## What the live pool has confirmed separately

`client/scripts/verify-pool-shapes.mjs` (`npm run verify:pool`) puts our calldata in
front of the real pool's `compile_actions` view. Our shapes fail on state; three
deliberately malformed controls fail on shape. See PHASE0.md.

## Still not done

- **Mainnet.** The deliverable. See `docs/mainnet.md`.
- **A wallet-signed pool bid.** Needs a human and a privacy-enabled wallet.
