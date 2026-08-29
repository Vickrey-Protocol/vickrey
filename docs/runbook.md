# Mainnet runbook

**Execute, do not think.** Every command in order, what you should see, and what to do
when you don't. Written Saturday so Sunday is typing.

Open this and [fallback.md](fallback.md) side by side. Nothing here needs a decision that
has not already been made.

---

## RULE 1 — the pool leg goes first

**After step 4, the very next thing is a pool transaction.** Not the judged auction, not
the video, not the dashboard.

Two reasons, the second stronger: it is the only step never rehearsed against the real
pool, so it is where an unknown lives — and **three qualifying pool transactions are the
gate to being scored at all.** A five-bidder auction with no pool transactions scores
zero on the criterion that decides whether the entry can win.

## RULE 2 — the shielded rail is the scoreable half

Public-rail bids never touch the pool. However many you run, the qualifying count stays
at zero. Only `pool → AuctionAnonymizer → SealedBidAuction` counts.

---

## Before you start

```
cd /Users/jagadeesh/personal/projects/grants/vickrey
git pull && git status --short          # must be empty
```

- **Expect:** no output from `git status`.
- **If not:** commit or stash. A deploy from a dirty tree matches no commit anywhere.

```
node scripts/pool-status.mjs 0x04c475d32f7929507ad3d4691f8e263528355eca074e43b8ac26892fb03ace5f
```

- **Expect:** `public STRK  120.00` or more.
- **If it reads 0.00:** the funding has not landed. Nothing below will work. Wait.
- **Why 120 and not 90:** after the happy path you keep ~51 STRK. An auction redeclare
  needs **48.69 held**. At 90 you would keep ~21 and be stranded mid-recovery.

---

## Step 1 — deploy the account

```
scripts/new-mainnet-account.sh deploy
```

- **Expect:** `Account deployed` and a transaction hash.
- **If "insufficient balance":** the account pays its own ~0.09 deployment fee out of
  the funds you sent. Confirm the balance above first.
- **If it says already deployed:** fine, skip to step 2.

## Step 2 — preflight, which spends nothing

```
scripts/deploy.sh mainnet vickrey-deploy
```

This builds `-P release`, runs 70 tests, checks the chain and the balance, then declares
and deploys. It refuses before spending if anything is wrong.

- **Expect, in order:** `Building` · `Tests: 70 passed` · `Preflight` showing chain
  `0x534e5f4d41494e`, `pool class matches`, and a balance **above** the bound ·
  two `Declaring` blocks · two `Deploying` blocks · `Verifying on chain` with three
  matches · `Wrote deployments.mainnet.json`.

- **Expect these exact class hashes:**
  ```
  SealedBidAuction    0x19abab9ba38af44a3a9dd2393bfa012dc708eb9003d8225deb4d6b4587c699a
  AuctionAnonymizer   0x112814b7d151b1499d65e8afffae67cc23e47cc5684229a6a2576aeb58b0f84
  ```
  **If a class hash differs, STOP.** The build is not the candidate that passed the
  Sepolia gates, and you would be deploying untested code. Run `git status`, confirm you
  are on `main`, and re-run.

- **If "REFUSING TO DEPLOY — short N STRK":** the estimator bound exceeds the balance.
  Top up by N and re-run. Nothing was spent.
- **If "pool class hash moved":** the STRK20 pool was upgraded. Run
  `npm run verify:pool` before going further — our encoding may no longer match.
- **If it dies between the two declares:** just run it again. It skips what is already
  declared. This is tested.
- **If "Invalid transaction nonce":** two transactions raced. Wait 15 seconds and re-run;
  it is not a failure.

## Step 3 — record the addresses immediately

```
cat deployments.mainnet.json
```

Copy both addresses into `strk20.json` under `contracts`, and delete the matching lines
from `pending`. Then:

```
git add -A && git commit -m "deploy: mainnet" && git push
```

**Do this now, not later.** If everything after this goes wrong, the deployed addresses
are still worth having in the entry.

## Step 4 — point the site at mainnet

```
npx vercel env rm NEXT_PUBLIC_NETWORK production --yes
npx vercel env rm NEXT_PUBLIC_AUCTION_ADDRESS production --yes
npx vercel env rm NEXT_PUBLIC_ANONYMIZER_ADDRESS production --yes
printf 'mainnet' | npx vercel env add NEXT_PUBLIC_NETWORK production
printf '<auction address>' | npx vercel env add NEXT_PUBLIC_AUCTION_ADDRESS production
printf '<anonymizer address>' | npx vercel env add NEXT_PUBLIC_ANONYMIZER_ADDRESS production
scripts/deploy-web.sh
```

- **Expect:** `in sync · 4 routes live`, and `/api/version` showing `network: mainnet`
  with the new addresses.
- **If the badge still says Sepolia:** the env did not take. Re-run `vercel env ls
  production` and check.

---

# → RULE 1 STARTS HERE ←

## Step 5 — the pool leg, before anything else

**5a. Confirm the wallet can still do it, free:**

Open `https://vickrey-ten.vercel.app/wallet-check`, connect the wallet you tested on
Sepolia.

- **Expect:** "Wallet is on the same network as this page" = **pass**, all three STRK20
  methods present, and the probe answering.
- **If the network row fails:** click *Switch the wallet to mainnet*.
- **If the probe says NOT IMPLEMENTED:** stop and read [fallback.md](fallback.md) Tier D.
  Try the other wallet before concluding anything.

**5b. Shield, if this wallet has never shielded on mainnet:**

```
node scripts/pool-status.mjs <your wallet address>
```

- **If `registered: no`:** tap the shield toggle (🛡️, top right in Xverse) to activate
  privacy, then shield. Budget **6 STRK** for the pool fee plus what you shield.
- Re-run the command. **Expect `registered: yes` and `channels: 1`.** That flip is the
  proof; do not rely on reading the wallet UI.

**5c. Create the auction that the qualifying transactions will bid into:**

```
AUCTION=<auction address> NETWORK=mainnet node scripts/live-auction.mjs
```

- This runs a **public-rail** lifecycle. It proves the contracts work on mainnet and
  costs ~2 STRK. **None of its transactions qualify** — they never touch the pool.
- **Expect:** ten `OK` lines ending `DONE. Clearing price …`.
- **If any step reverts:** the contracts are wrong on mainnet in a way Sepolia did not
  show. Stop, read the revert, and go to [fallback.md](fallback.md) Tier B or C.

**5d. The three that actually count.**

First create an auction the qualifying bids can go into, with a **long bid deadline** —
past 4 Sept, so it can never sit Sealed and unattended during judging (the `abandon`
operator rule in [mainnet.md](mainnet.md)).

Use the site: `https://vickrey-ten.vercel.app/app/create`, connect, walk the five steps.
At **Timing** choose a bid deadline past 4 Sept and the **Suggested** 24h dispute window.
Note the auction id it gives you.

If the create form misbehaves, fall back to the script — it creates a 200-second auction,
so edit `DEADLINE` in `scripts/live-auction.mjs` to something far out first, and run only
as far as the bids.

Then place three bids **through the pool**: open `/auction/<id>`, connect, choose the
**Private rail**, bid. Three times.

- **Expect for each:** a wallet prompt, ~30 seconds of proving, then a transaction hash.
- **Verify each on Starkscan:** the transaction must show **`Routed`** from the
  anonymizer **and** **`BidPlaced`** from the auction. Both. That pairing is what the
  submission rule checks and it is what Sepolia transaction `0x1b9d71e1…0eeb9cb` proved
  the shape of.
- **If only one event appears:** note which, and stop — that is the submission rule
  unsatisfied, not a cosmetic problem.

**5e. Record them the moment they land:**

Put all three hashes in `strk20.json` under `transactions`, remove the `pending` entry,
commit, push.

---

## Step 6 — the judged auction

Only now. A five-bidder auction is worth points; it is not worth risking step 5.

Set `dispute_window` to 24h+ **or** run it through to Finalized before judging opens —
see the `abandon` operator rule. Never leave an auction Sealed and unattended.

## Step 7 — the video

[docs/demo-script.md](demo-script.md). Six beats, 3:00, 1080p. Beat 3 walks the **public**
rail because that is what a viewer can repeat; beat 3b shows the private rail as the
depth. Record after the auction so every number on screen is real.

## Step 8 — final pass

```
npm test && snforge test          # 50 + 70
node scripts/check-links.mjs      # 0 dead
node scripts/check-deployed.mjs   # in sync
```

Then read `strk20.json` top to bottom and confirm every field is true. The README status
section must not claim more than happened.

---

## If you are short of time

Drop in this order, and stop dropping as soon as the clock allows:

1. The five-bidder judged auction (step 6) — points, not the gate
2. The dashboard polish
3. The video *last* — it is a scored field, so cut it only if the alternative is missing
   the three transactions

**Never drop step 5.** Without it the entry cannot be scored, however good everything
else is.
