# Deployments and live evidence

Everything here was read back from chain, not copied from a plan.

## Sepolia — rehearsal only

**Sepolia is a rehearsal, not the deliverable.** The sprint requires mainnet. Nothing
in the code assumes a Sepolia run will be possible for the pool leg — see
`docs/mainnet.md`.

| | |
|---|---|
| `SealedBidAuction` | [`0x07c9fe011b361470c6269807aae021ecbd8c809b8b29443fb0a2d8df6da3955c`](https://sepolia.voyager.online/contract/0x07c9fe011b361470c6269807aae021ecbd8c809b8b29443fb0a2d8df6da3955c) |
| class hash | `0x1489a905a59d25614300504355ecd9df25e34bc8b099485512d44cc7b94b341` |
| `AuctionAnonymizer` | [`0x0496bd7ec79591a05289c1dd5faf55bd16476c724756152f3ba2aee9e2e34e8e`](https://sepolia.voyager.online/contract/0x0496bd7ec79591a05289c1dd5faf55bd16476c724756152f3ba2aee9e2e34e8e) |
| class hash | `0x5197552b8a5d886b024ed281242c001c8b84aabc8d95edd014ff2b673646e0e` |
| Lot token `CRATE` (a test double) | `0x06faa5f22e11ab496cb4dff52e0c0f93376c1861c51a3f6f8472b0d83580019f` |
| STRK20 pool (theirs) | `0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| pool `get_fee_amount` | 2 STRK |

The anonymizer's constructor pins the pool address, and `privacy_contract()` reads
back as the pool above.

Two demonstration auctions live on this deployment and stay there, so the site always
has something to show without a wallet connected: **#0 resolved** (cleared at 3.25
STRK) and **#1 open** until 31 Aug 2026 12:00 UTC with three sealed bids in it.

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

## Hosting

Live at **https://vickrey-ten.vercel.app** — Vercel, project root `web/`, npm
workspaces so the sibling `client` package is reachable at build time.

Network is entirely env-driven, so pointing the site at mainnet is three variables and
a redeploy, not a code change:

```
NEXT_PUBLIC_NETWORK=mainnet
NEXT_PUBLIC_AUCTION_ADDRESS=…
NEXT_PUBLIC_ANONYMIZER_ADDRESS=…
```

Set them with `vercel env add <NAME> production`, then `vercel --prod`. Until then the
site says which network it is on, in the masthead and the footer, so a judge is never
looking at Sepolia thinking it is mainnet.

**The reveal relay is not durable.** It is an in-memory route on serverless, so a
posted reveal can vanish with the instance. That is why the bidder UI can emit the same
payload as text and the auctioneer console accepts pasted reveals — the demo does not
depend on the relay surviving.
