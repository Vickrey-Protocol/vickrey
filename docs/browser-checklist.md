# Browser checklist

Every path below has been written and typechecked. **None has been run by a human with
a wallet extension.** That is the last unknown in the project, and it is the one thing
I cannot do — I can read the chain but I cannot click a wallet prompt.

Work top to bottom. For each step there is what to click, **what you should see**, and
**what would be a bug**. Report back with the step number and what actually happened;
"step 6 showed a spinner forever" is enough for me to find it.

Two rules while testing:

- **Never approve a transaction whose value surprises you.** The escrow figures below
  are small on purpose. If a wallet asks for more than the page said, stop and tell me
  — that is the most serious class of bug this list can find.
- **Keep the browser console open** (⌥⌘J). A red error there is worth more than any
  description of the symptom; paste it verbatim.

Where to run it: the deployed site, not localhost. Localhost hides SSR and caching
faults.

**Steps 1–17 are valid on Sepolia today.** They exercise the interface, and the
interface is identical on either network. Sepolia is still running the *pre-freeze*
contracts — `abandon` and the `Routed` event are not deployed there — which changes
nothing for these steps, because `web/` never references either. Steps 18–19 and 24b
need mainnet and the frozen build; leave them.

---

## 0. Before you start

| | |
|---|---|
| Wallet | Ready (formerly Argent) or Braavos, on **mainnet** |
| Balance | A little STRK for gas. Public-rail bidding needs no shielded balance |
| Browser | Whichever you normally use, plus one private window for step 14 |

The site reads `NEXT_PUBLIC_NETWORK`. If the badge next to the wordmark says Sepolia,
stop — the deploy did not point it at mainnet, and nothing below will mean anything.

### 0a. Can this wallet do STRK20 at all? — free, and it gates the funding

**Do this before funding anything.** All three qualifying mainnet transactions must
touch the pool, pool transactions are proved *inside the wallet*, and `sncast` has no
prover — so if the wallet cannot do it, no amount of scripting substitutes and the
declare buys nothing.

Open **`/wallet-check`**. Every check on that page is free; nothing signs, nothing moves.

1. Read the **pool** table. `is_paused` must be false, and it prints the live fee.
2. **Connect.** The table should show Wallet API ≥ 0.10.3 and all three of
   `strk20Balances`, `strk20PrepareInvoke`, `strk20InvokeTransaction` present.
3. Click **Run the free STRK20 probe**.

   **Pass — anything the wallet answers with.** A consent prompt, approved or declined.
   `NOT_REGISTERED`. `SUBCHANNEL_NOT_FOUND`. Insufficient balance. All of these are the
   *pool* replying, which means the wallet understood the call and routed it — and that
   is the entire thing being tested. Shape, not state: the same rule
   `verify-pool-shapes.mjs` applies one layer down.

   **Fail — only an absent method.** "is not a function", "not supported", "method not
   found", or no response at all.

   The page names which one it was, so you can check the reasoning rather than trust a
   verdict. `NOT_REGISTERED` in particular is expected on a wallet that has never
   shielded: registration is what your first shield creates.

**If step 3 fails, stop and tell me.** Do not fund the deploy account. The options then
are a different wallet, or a documented entry that cannot be scored on the pool
requirement — and that is a decision for you, not a thing to discover on the 31st.

### 0a-bis. Confirm the reading, from the chain

`NOT_REGISTERED` is a fact you can check independently of any wallet UI:

```
node scripts/pool-status.mjs <your-wallet-address>
```

`registered: no` and `channels: 0` are exactly what the probe reported. Run it again
after 0b — those two lines flipping is what proves the shield landed, and it does not
depend on reading the wallet correctly.

### 0b. The smallest real shield — ~6 STRK plus the amount

Only after 0a passes.

**This site cannot shield for you.** The Wallet API's three STRK20 methods do not include
a deposit; shielding happens in the wallet's own interface. So:

1. Open your wallet's **private / shielded balance** section.
2. Shield the **smallest amount it will accept**. The pool charges its fee (printed on
   `/wallet-check`) on top.
3. Return to `/wallet-check` and run the probe again. It should still answer, and the
   wallet should now show a shielded balance.

**What would be a bug:** the wallet has no private-balance section at all despite passing
0a. Tell me which wallet and version — that is a gap between the API and the product, and
it changes the plan.

---

## 1. The public site, wallet still locked

Do not connect yet. This is the judge's view and it has to stand on its own.

1. Open `/`.
   **Expect:** the ladder instrument draws and animates. Live counts read from chain.
   "Amounts disclosed: **0**". The trust statement in full, both halves.
   **Bug:** a grey skeleton that persists; counts stuck at 0 when auctions exist; the
   trust statement truncated or behind a "read more".

2. Click **See a settled auction**.
   **Expect:** navigation to `/auction/<n>`. Clearing price shown as a figure. Every bid
   in the record table reads *not disclosed*. The winner's own bid reads *never
   disclosed*.
   **Bug:** any number where an amount should be withheld. This is R1 and it is the
   product's whole claim — if you see a bid amount anywhere, stop and tell me
   immediately.

3. Scroll to **The whole public record**.
   **Expect:** one row per bid, each with a claim handle and two hash anchors, amount
   column *not disclosed*.
   **Bug:** an address column. **No bidder address** may appear on this page.

   Be precise about what that means. The **seller and auctioneer** address is public by
   design — it is in the `AuctionCreated` event and it is who you hold accountable — and
   it is present in the page's server-rendered data. That is correct. What must never
   appear is an address tied to *having placed a bid*.

   On the Sepolia demo one account is seller, auctioneer **and** all three bidders,
   because a script ran it. So you will see that address and it proves nothing either
   way. Judge this one on mainnet with distinct bidders.

4. Open `/auctions`.
   **Expect:** every auction, filter chips with counts that add up.
   **Bug:** a filter showing a count that does not match the rows.

5. **Disable JavaScript** (DevTools → ⌘⇧P → "Disable JavaScript") and reload
   `/auction/<n>`.
   **Expect:** the page still shows the terms, the clearing price, the record table and
   the trust statement. Animation and countdowns stop; content does not.
   **Bug:** a blank page or a bare skeleton. Re-enable JS afterwards.

---

## 2. Connecting

6. Click **Connect wallet**.
   **Expect:** the wallet's own picker. After approving, the button becomes a pill with
   your truncated address.
   **Bug:** no prompt at all (usually a wallet not injected into this browser); or the
   page reloading and losing the connection.

7. Go back to `/auction/<n>` on an auction that is **taking bids**.
   **Expect:** the right column is now the bid panel. The left column is unchanged from
   what you saw locked — same instrument, same terms.
   **Bug:** anything in the left column appearing or disappearing on connect. Connecting
   must add the action column and change no evidence.

8. Open `/app`.
   **Expect:** the dashboard. Sidebar, "Action required", "Your positions", "Protocol".
   With no bids yet: *"Nothing needs you right now"* and the next upcoming deadline.
   **Bug:** an empty white band with no sentence — an empty state is a state, not a gap.

---

## 3. Bidding — the rail decision

9. On the bid panel, read the three rail cards before touching anything.
   **Expect:** **Public rail** selected by default. **Private rail** enabled only if
   your wallet speaks STRK20 — otherwise disabled with the reason. **Sponsored private**
   greyed out, "not available".
   **Bug:** the private rail selectable when the wallet cannot do it; the sponsored rail
   clickable.

10. Pick a level on the ladder.
    **Expect:** "Your bid" fills in with that rung's price. "You escrow" shows the
    **cap** — the top of the ladder — not your bid. That difference is the point: the
    escrow is uniform so it says nothing about the bid.
    **Bug:** escrow tracking your chosen level. That would leak the bid to anyone
    watching the transfer.

11. Click **Place sealed bid** (public rail).
    **Expect:** two calls in the wallet — an `approve` then `place_bid`. The approve
    amount equals the escrow shown in step 10.
    **Bug:** an approve for an unlimited amount, or for more than the escrow.

12. Approve.
    **Expect:** a **blocking** claim-secret panel — not a toast. A long secret, a Copy
    button, and a checkbox you must tick before Continue is enabled.
    **Bug:** anything that lets you navigate away without acknowledging. Losing this
    loses the refund and there is no recovery.

13. **Copy the secret into a text file now**, before clicking Continue. You will need it
    and you are about to test losing it.

14. Continue, then open `/app/bids`.
    **Expect:** your bid listed. "Your level" is a dashed chip showing the rung —
    **not** a currency figure. Footnote says it is read from this browser.
    **Bug:** a price where the level should be.

15. Click **Export secrets to file**.
    **Expect:** a JSON download.
    **Bug:** nothing happens — likely a blocked download; check the console.

16. Open the same site in a **private window** and connect the same wallet.
    **Expect:** `/app/bids` shows the bid row with the secret column flagged
    **MISSING — refund unrecoverable**. This is correct: secrets are per-browser.
    **Bug:** the secret appearing. That would mean it is leaving the browser, which
    breaks the privacy model.

17. Still in the private window, use **Import…** with the file from step 15.
    **Expect:** the row recovers.

---

## 4. Private rail

Only if your wallet supports STRK20 and you have a shielded balance. **Costs 6 STRK in
pool fees** — skip if you would rather spend that on the judged run.

18. Select **Private rail**, pick a level, click **Bid privately**.
    **Expect:** "Proving takes about 30 seconds" *before* you click, and a changing
    progress line during it — "Checking the transaction shape…" then "Proving…".
    **Bug:** thirty seconds of an unchanged button. That is where people conclude the
    app has died.

19. After it lands, look at the transaction on Starkscan.
    **Expect:** a `Routed` event from the anonymizer **and** a `BidPlaced` from the
    auction. Both are required for the hash to count toward the sprint's three.
    **Bug:** only one of them. Tell me which.

---

## 5. Sealing and settling — auctioneer

Use an auction you created. If you have not created one, do step 20 first.

20. `/app/create`. Walk the five steps.
    **Expect:** at **Ladder**, the preview redraws as you change reserve, top and level
    count, and the spacing line updates. At **Timing**, the dispute-window presets each
    carry their honest note.
    **Bug:** the preview not tracking the inputs; a spacing of zero accepted.

21. Wait for bidding to close, then `/app` → **Seal**.
    **Expect:** the action card appeared on its own, with a countdown *and* an absolute
    UTC time.
    **Bug:** a countdown with no UTC timestamp, or a date that is not UTC.

22. `/app/manage/<id>` → settle.
    **Expect:** your bond and what puts it at risk, stated. Seeds collected. **No bid
    amounts anywhere on this screen** — you know them, the interface must not draw them,
    or a screenshot of this console becomes the disclosure.
    **Bug:** any amount or level visible in the console. Serious.

23. Settle.
    **Expect:** the clearing price appears on the public page. Losing bids still read
    *not disclosed*.

24. Wait out the dispute window, then **Finalize**.
    **Do this before judging opens.** A Finalized auction can never be abandoned; a
    Sealed one can, by anyone, once its grace period elapses. See "Operating `abandon`"
    in [mainnet.md](mainnet.md).

24b. With the auction still **Sealed** and inside its grace period, try `abandon` from a
    second wallet.
    **Expect:** a refusal — `SETTLE_GRACE_OPEN`.
    **Bug:** it succeeding. That would mean the grace is being measured from the wrong
    moment, and the demo auction is cancellable by anyone.

---

## 6. Claiming

25. `/app` as a losing bidder.
    **Expect:** "Claim your refund" card.
26. Claim.
    **Expect:** the escrow returns in full. On the public page the bid still reads
    *never disclosed*.
    **Bug:** a partial refund for a loser — losers get the whole cap back.
27. As the winner, **Claim your lot**.
    **Expect:** the lot arrives; the winner's refund is the **surplus**, cap minus the
    clearing price.

---

## 7. The things that should fail

Worth ten minutes — these are the guards, and a guard nobody tested is a guess.

28. Try to bid after the deadline. **Expect** a refusal, in words, not a raw RPC error.
29. Try to settle an auction you did not create. **Expect** the console to tell you who
    the auctioneer is and offer the public view.
30. Try to claim a refund twice. **Expect** a refusal.
31. Visit `/auction/999999`. **Expect** a not-found, not a crash.
32. Visit `/app/manage/<someone else's id>`. **Expect** the "you are not the auctioneer"
    banner.

---

## Reporting back

For each failure: **step number**, what you clicked, what you expected, what happened,
and any console error verbatim. A screenshot helps except on step 22, where a screenshot
of a bug would be the disclosure itself — describe that one in words.

If everything passes, say so plainly. That result is worth as much as a bug list: it is
the difference between "the code is written" and "the product runs".
