# Deployments and live evidence

Everything here was read back from chain, not copied from a plan.

## Mainnet — second version (current)

Deployed 4 Oct 2026 from the same release build that ran on Sepolia (the class hashes
match). Read back from chain after deploying: the anonymizer points at the pool and at
the auction.

| | |
|---|---|
| `SealedBidAuction` | [`0x01b81e43fa60a6ef78ed86fdcd472a1f0072fc1556723f04b94d8ac8c62908c7`](https://starkscan.co/contract/0x01b81e43fa60a6ef78ed86fdcd472a1f0072fc1556723f04b94d8ac8c62908c7) |
| class hash | `0xbb605ad94f562e75dd3a867798489dcb5e71f38b0f1dfc4adb340d829f058d` — declared [`0x65ce575dfe…`](https://starkscan.co/tx/0x65ce575dfe2d74439ed49d4ac7229fb2ab7f787ec72eb8c1a0c9d598409b795), 31.04 STRK |
| `AuctionAnonymizer` | [`0x00cb8007daa66eb9eb92c3b3e5a4e2b27f848ccef08d6e7688a2a737ff94e050`](https://starkscan.co/contract/0x00cb8007daa66eb9eb92c3b3e5a4e2b27f848ccef08d6e7688a2a737ff94e050) |
| class hash | `0x32bb3bf49e29a93b248f6bd9a69be6de7fb3b0ccac469beded7e827c0adf269` — declared [`0x3f9c7f5c5a…`](https://starkscan.co/tx/0x3f9c7f5c5a0ad86a833b92236ab9b4425194194f17fa71fc34885edaa315dae), 4.04 STRK |
| deploy block | 15866452 |
| reveal relay | [`0x00b6bd64be4cab27fbf60b1cb34908a472441ab44820f4715053ef88a1e99966`](https://starkscan.co/contract/0x00b6bd64be4cab27fbf60b1cb34908a472441ab44820f4715053ef88a1e99966) |
| STRK20 pool (theirs) | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`, class `0x6d163f2b27df0f53c5b0d019366261ba8034af1bef949dee920a60fe58bcf83` |
| smoke-test NFT collection | [`0x030adfdfc908ef197a3c3e7f6b6d0bd3cd9525bece1c33dcdddd0cecaf8f8bd2`](https://starkscan.co/contract/0x030adfdfc908ef197a3c3e7f6b6d0bd3cd9525bece1c33dcdddd0cecaf8f8bd2) — a test ERC-721 with an open mint |

### Smoke test, 4 Oct 2026

Nine auctions on the public rail at nominal value (0.001–0.008 STRK a rung), driven
through the site's own screens. Every bid was collected, every seller paid and every lot
returned or delivered; nothing is left in the contract. The private collect is not
covered: the pool reports the helper as `Required` for open-note deposits, so the site
offers the public collect instead.

| Path | Auction | Transaction |
|---|---|---|
| Token lot: sealed bids, reveals posted by the relay, settled at the second price | #2 | [`0x31a5b967bf…`](https://starkscan.co/tx/0x31a5b967bf2f86fe18469acd211d229704a3354bcbb55baa29939800179fd65) |
| Winner collects the token lot and the surplus | #2 | [`0x3acc36a598…`](https://starkscan.co/tx/0x3acc36a598f58144f6e389cab38865718fb5180d6c85a44ffbacd508c9839dc) |
| A bid not revealed, at or below the price: forfeit redeemed in full | #2 | [`0x1384ff6950…`](https://starkscan.co/tx/0x1384ff6950fded48ca05d22dead1515a24ca914c6aea55f2984b7f3cc2468bb) |
| NFT lot: winner collects the NFT | #3 | [`0x5a5de3f187…`](https://starkscan.co/tx/0x5a5de3f1877d549188b669a1143fa260eafb57145bac538829b1f4cdba27a22) |
| Off-chain lot: buyer confirms delivery | #4 | [`0xef1153e0d5…`](https://starkscan.co/tx/0xef1153e0d5b1eb169027e73f93efaa6bd2cd21d54fca871f8cab08653bb2cf) |
| Off-chain lot: buyer rejects; price and seller bond destroyed | #5 | [`0x65fb7015d6…`](https://starkscan.co/tx/0x65fb7015d6f1d5aa8de4390b920d929d30d863bfed74bea2dc958f28dd59023) |
| Off-chain lot: released after the delivery deadline | #6 | [`0x1a7b89dfe9…`](https://starkscan.co/tx/0x1a7b89dfe991a9c527e98bd49b58900711c96c0bbef97537b1723e456c988fb) |
| Auctioneer settles leaving out the higher, revealed bid | #7 | [`0x2c0b3722ae…`](https://starkscan.co/tx/0x2c0b3722ae85307bd8eea1c78390ba0fa3bf8ef9140233233859b66f58e9622) |
| That bid voids the settlement, sent by the relay | #7 | [`0x14ed335842…`](https://starkscan.co/tx/0x14ed3358422a707d6c082163e9769030a99faf41d2a159fa09b6844b00d5b31) |
| Abandoned after the grace period | #8 | [`0x4fbc9526eb…`](https://starkscan.co/tx/0x4fbc9526ebe5de570390f97f58fa8b536aa28f695b67abbcbda3d20487bb39b) |
| No bids: no winner, the lot goes back to the seller | #0 | [`0x114147279a…`](https://starkscan.co/tx/0x114147279a03f654a8845b2731c6157eb03ea71d296af62ab4264f7e722a7d2) |

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

Live at **https://vickrey.0xo.in** — Vercel, project root `web/`, npm
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
