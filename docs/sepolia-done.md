# Sepolia definition of done

> ## STATUS — Sat 29 Aug, ~16:00 UTC · §5 and §6a GREEN
>
> Sepolia funded (3157 STRK). Candidate declared and deployed there. **Two of the three
> freeze gates pass.** §1 is the browser lifecycle and is the remaining one.
>
> | Gate | Result |
> |---|---|
> | **§5 abandon** | **PASS 6/6** — `scripts/verify-abandon.mjs` |
> | **§6a Routed + BidPlaced** | **PASS 5/5** — tx `0x1b9d71e1…0eeb9cb` |
> | §1 full lifecycle in a browser | outstanding — needs a human |
>
> Candidate on Sepolia:
> `SealedBidAuction 0x00a9b781…4d0639` · `AuctionAnonymizer 0x065c8eb2…2d40334`
>
> **No Cairo change was required.** The freeze holds so far on the contracts themselves;
> both failures found were in tooling.
>
> ## Earlier status — Sat 29 Aug, 14:43 UTC
>
> **Neither account was ever funded, and nothing is deployed on mainnet.** This has been
> the sole blocker since Monday. No line below has moved because none of them can.
>
> | | Needs | Has |
> |---|---|---|
> | Sepolia `0xbf54…c668fa` | 150 (faucet, free) | **57.11** — no longer enough for even one declare |
> | Mainnet `0x04c4…ce5f` | 90 | **0.00** |
>
> Gas rose while we waited. Mainnet declares are now **46.96 STRK** (were 44.53) and the
> bound is **64.99**. Sepolia's bound is **62.71** against a 57.11 balance, so the
> "declare on the 57" fallback offered on Monday no longer exists — it expired
> unexercised.
>
> **The freeze plan is now conditional on funding arriving today.** See
> [mainnet.md](mainnet.md) for what happens if it does not.

## The contracts are CANDIDATE-FROZEN, not frozen

**Frozen** is a claim about testing, not about whether anyone has edited a file. Today
the only thing verified is that the shipped class hashes did not move when the test mock
changed — which is not the same statement and should not have been written as one.

> **CANDIDATE-FROZEN** — the build we intend to ship. Class hashes computed and pinned.
> Unit tests pass. Nothing on chain has exercised them.
>
> **FROZEN** — §1, §5 and §6 have passed **on Sepolia, against the declared candidate
> build**. Only then does 36.64 STRK get spent declaring on mainnet.

Those three sections are the ones capable of forcing a Cairo change, which is why they
run first and why the mainnet declare waits for them. **Declaring twice pays twice**, and
a redeclare after a mainnet-discovered bug costs 44.7 STRK plus the freeze restarting.

### Execution order

| | Section | Why here |
|---|---|---|
| 1 | **§5 abandon on chain** | can force a Cairo change; fully scriptable, so it runs first and unattended |
| 2 | **§6 Routed + BidPlaced in one tx** | can force a Cairo change; has a Sepolia path that does not depend on the wallet — see §6 |
| 3 | **§1 full lifecycle via browser** | can force a Cairo change; needs a human and has time gates, so it runs in parallel with 1 and 2 |
| 4 | §4 decimals in a 6-decimal token | interface-level; cannot invalidate the freeze |
| 5 | §2 failure paths, §3 routes, §7 strk20.json | verification, not discovery |

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
Scripted end to end — `AUCTION=0x… node scripts/verify-abandon.mjs` — so it runs
unattended the moment Sepolia is funded. It checks the refusal *reason*, not merely that
something failed.

| ☐ | an Open auction cannot be abandoned | refuses, `AUCTION_NOT_SEALED` |
| ☐ | abandon inside the grace | refuses, `SETTLE_GRACE_OPEN` |
| ☐ | abandon after the grace | succeeds, status → Cancelled |
| ☐ | every bidder refunded the full cap | balances read back |
| ☐ | lot and bond returned to the seller | balance moved |
| ☐ | abandon is not repeatable | refuses, `AUCTION_NOT_SEALED` |

## 6. The pool leg

The leg splits into two claims that need different evidence, and conflating them is how
you end up believing the whole thing is tested when half of it is.

**6a — our contracts emit both events atomically.** Verifiable on Sepolia **without any
wallet**: `MockPrivacyPool` is a deployable contract that drives `privacy_invoke` exactly
as the real pool does. Deploy it, deploy an anonymizer pointed at it, drive a bid. That
is the real `AuctionAnonymizer` and the real `SealedBidAuction`, on chain, in one
transaction. It is the half that can force a Cairo change, and it does not wait on
Xverse.

**6b — the real pool accepts our action encoding.** Already covered read-only, against
the **live mainnet pool**, by `client/scripts/verify-pool-shapes.mjs` through
`compile_actions`, which is a `view`. Free, and currently passing.

**What neither covers:** the real pool executing our actions with a real proof. That is
the single genuinely mainnet-first step, and no amount of Sepolia work substitutes for
it unless Xverse offers STRK20 there.

| | Line | How |
|---|---|---|
| ☐ | 6a — `Routed` and `BidPlaced` in one transaction, via `MockPrivacyPool` on Sepolia | `scripts/deploy-mock-pool.sh` then `scripts/verify-events.mjs` |
| ☐ | 6a — `Routed` carries no bid-identifying value | asserted in the same script |
| ☑ | 6b — encoding accepted by the live mainnet pool | `npm run verify:pool` — 2 shapes pass on state, 3 controls fail on shape |
| ☐ | 6c — real pool, real proof | Sepolia if Xverse allows it, otherwise mainnet-first |
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

---

## Expected freeze date

**Thursday 27 August.** I expect Wednesday 26; Thursday is the date I will commit to,
and below is what would move it.

Today is Monday 24 August, 17:15 UTC. Seven days to the deadline.

| Day | What happens |
|---|---|
| **Mon 24** | Sepolia funded → declare the candidate build there (~40 STRK). §5 and §6a run unattended tonight — both are scriptable. §1 starts in the browser |
| **Tue 25** | §1 completes (it has real time gates — a bid deadline and a dispute window). Fix whatever the three surfaced; redeclare if the fix is Cairo |
| **Wed 26** | Re-verify. **Freeze here if at most one Cairo fix round was needed** |
| **Thu 27** | Second fix round if needed. **Committed freeze date** |
| Thu 27 / Fri 28 | Mainnet declare + deploy — minutes, because the 90 STRK is pre-funded. Then the judged auction and the three qualifying transactions |
| Sat 29 | Video |
| Sun 30 | Buffer |
| Mon 31 | Deadline, 23:59 UTC |

### What would move it past Thursday

- **Three or more Cairo fix rounds.** Each is a Sepolia redeclare at ~40 STRK and about a
  day of re-verification. The 207 STRK Sepolia budget affords four or five redeclares, so
  money is not the limit here — calendar is.
- **A §1 failure that is architectural rather than a bug.** A wrong assertion is hours; a
  wrong state machine is not.
- **Xverse not offering Sepolia**, which does not move the freeze itself — §6a covers the
  freeze-relevant half — but moves the risk. See below.

### The risk this schedule carries

If Xverse has no Sepolia STRK20, **6c is first attempted on mainnet on the 27th or 28th**,
after the declare. A failure there that needs a Cairo change costs 44.7 STRK to redeclare
*and* restarts the freeze, with three days left.

Mitigation, and it is the reason to keep the ordering strict: **attempt the pool leg
immediately after the mainnet deploy — before the judged auction, before the video.** If
it breaks, that is the moment with the most days left to react.
