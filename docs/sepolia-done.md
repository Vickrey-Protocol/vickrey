# Sepolia definition of done

**Nothing goes to mainnet until every line here is true.**

Mainnet is a deployment, not a development phase: declare, deploy, create the judged
auction, run the three qualifying pool transactions, smoke test, done. No new code
written there. No feature discovered there. Debugging on mainnet means this document
failed.

The argument for it is the decimals bug: every amount rendered at a hardcoded 18
decimals, so a 250 USDC lot displayed as `0`. It was found by reasoning about a
contingency, not by testing — which means the ones we have not reasoned about are still
in there. Sepolia is where they surface.

**Status key:** ☐ not started · ◐ in progress · ☑ verified · ⊘ blocked, with the reason

Each line records **how** it was verified. A line marked done without evidence is not
done.

---

## 0. Blocker: Sepolia is underfunded for this plan

Completing the product on Sepolia means declaring the **frozen** build there — the
pre-freeze classes currently deployed have neither `abandon` nor `Routed`, so §5 and §6
cannot be exercised against them.

Measured against Sepolia at block 13980400:

| Step | Spends | Must hold |
|---|---|---|
| declare both contracts + both deploys | 39.95 | **55.28** |
| declare `MockERC20` (decimals is a constructor arg now, so the class moved) | 11.13 | 15.40 |
| deploy two mock tokens, 18-decimal and 6-decimal | 0.20 | 0.30 |
| full lifecycle ×2, one per token | 3.40 | 4.70 |
| `abandon`: create, bid, seal, abandon, refunds | 2.00 | 2.80 |
| pool leg, if Sepolia allows it (shield + 3 ops at 2 STRK) | 8.00 | 8.50 |
| browser-driven runs, checklist 1–17 | 3.00 | 4.00 |
| **total** | **67.68** | **55.28** at the first declare |

**The account holds 57.11 STRK.** That is 10.6 short of the total and leaves **3%**
headroom on the declare bound — a 3% gas rise strands the run with classes declared and
nothing deployed.

☐ **Top up Sepolia to 150 STRK.** Test STRK is free; the faucets at
[starknet-faucet.vercel.app](https://starknet-faucet.vercel.app) and
[faucet.starknet.io](https://faucet.starknet.io) both answer 200. Account:
`0xbf54b8d90403f275fbf0e9db0bb7e2a278bcc0e8b53f3fe71a3e2931c668fa`

Until this is done, everything below is blocked at the first declare. It is the cheapest
blocker in the project and the one gating all the rest.

## 1. Full lifecycle end to end, via a browser wallet

Not the script. A human clicking, because that is the path that has never run.

| | Step | Evidence |
|---|---|---|
| ☐ | create | tx hash |
| ☐ | bid — public rail | tx hash |
| ☐ | bid — private rail | tx hash, **or** ⊘ with the reason from §8 |
| ☐ | claim secret shown as a blocking wall, copied, survives reload | — |
| ☐ | seal | tx hash |
| ☐ | settle | tx hash |
| ☐ | dispute window visible and counting, UTC alongside | — |
| ☐ | finalize | tx hash |
| ☐ | claim refund — loser gets the full cap | tx hash |
| ☐ | claim lot — winner gets lot, refund is the surplus | tx hash |

## 2. Every failure path refuses, in words

From checklist §7. A guard nobody tested is a guess.

| | Path | Expected |
|---|---|---|
| ☐ | bid after deadline | refusal in words, not a raw RPC error |
| ☐ | settle an auction you did not create | names the auctioneer, offers the public view |
| ☐ | claim a refund twice | refusal |
| ☐ | `/auction/999999` | not-found, not a crash |
| ☐ | `/app/manage/<not yours>` | "you are not the auctioneer" banner |

## 3. Routes and deployment

| | Line | How |
|---|---|---|
| ☑ | every route loads, no 404s | `node scripts/check-deployed.mjs` — 4 routes |
| ☑ | deployed commit == HEAD | same script, compares `/api/version` to `git rev-parse HEAD` |
| ☑ | every link returns 200 | `node scripts/check-links.mjs` — 0 dead |
| ☐ | re-run all three immediately before the mainnet declare | — |

## 4. Decimals, against a token that is not 18

The bug rendered a real amount as zero. A fix verified only against STRK proves nothing,
because STRK is the case that already worked.

| | Line | How |
|---|---|---|
| ☐ | deploy a 6-decimal mock ERC-20 on Sepolia | class hash + address |
| ☐ | run a full auction denominated in it | tx hashes |
| ☐ | every displayed amount correct — ladder, escrow, clearing price, refund | screenshots or read-back |
| ☐ | create form reads the token's decimals as typed | — |

## 5. `abandon`, both sides of the grace boundary

| | Line | Expected |
|---|---|---|
| ☐ | abandon inside the grace | refuses, `SETTLE_GRACE_OPEN` |
| ☐ | abandon after the grace | succeeds, everyone refunded, lot home |
| ☐ | abandon a Finalized auction | refuses — the operator escape hatch |

## 6. The pool leg

| | Line | How |
|---|---|---|
| ☐ | `Routed` and `BidPlaced` both present in one transaction | explorer link |
| ☐ | refund returns as an open note | tx hash |

## 7. `strk20.json`

| | Line | |
|---|---|---|
| ☐ | complete except mainnet addresses, hashes, and the video | those three stay under `pending` |
| ☐ | every class hash matches the frozen build | `scripts/lib/class-status.mjs` |

## 8. Does Sepolia allow the pool leg at all?

**This decides how complete the rehearsal can be**, so it is answered first and recorded
here rather than assumed.

| | Line | Finding |
|---|---|---|
| ☑ | STRK20 pool exists on Sepolia | `0x254a…0d91`, class hash matches the pinned value |
| ☑ | pool is live there | `is_paused` = 0, `get_fee_amount` = **2 STRK** (mainnet is 6) |
| ☐ | Xverse offers STRK20 **on Sepolia** | `/wallet-check` — see below |

No published source states whether Xverse exposes STRK20 on Sepolia; wallet features
ship per-network and the announcements describe mainnet. So it is measured, not read.

**If yes:** the pool leg rehearses fully and mainnet is genuinely a redeploy.

**If no:** it is the single mainnet-first path, and we plan for it as exactly that —
not by pretending otherwise. Mitigations then:

- Everything *except* the pool leg still completes here, so the untested surface is one
  transaction shape rather than a product.
- `client/scripts/verify-pool-shapes.mjs` validates our encoded actions against the
  **live mainnet pool** through `compile_actions`, which is a `view`. That is a free,
  read-only rehearsal of the exact calldata, and it is already passing.
- The anonymizer's pool path is covered by `packages/anonymizer/tests` against a mock
  pool built from the real `OpenNoteDeposit` layout.
- Budget for it going wrong on the day: attempt the pool leg **first** after deploying,
  not last, so there is time to react.
