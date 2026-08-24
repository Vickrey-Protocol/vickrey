# Demo video — script and shot list

**Length:** 3:00, which is the sprint ceiling. The cut below fills it exactly; if it runs long, take it out of beats 1 and 6, never beat 5.
**Export:** 1080p. Not 720p — Bodoni's hairlines break there, measured in
[typography.md](typography.md).
**Record after mainnet is live.** Every number on screen must be a real mainnet
number; nothing is staged and nothing is a mock.

Two settings before recording:

- `?motion=1` on the URL forces the settlement animation regardless of what the
  browser has cached, so the beats are reproducible across takes. `R` replays.
- The auction used on camera must already be **settled and finalized**, so the
  clearing price is a fact rather than a promise.

---

## The spine

The video makes one argument in three moves: *this auction is optimal and has never
been possible → here it is running on mainnet → here is the proof that the losing
bids were never published.* Beat 5 is the entry. Everything before it is setup.

**Runs to 3:00 exactly**, which is the sprint's limit rather than a target to beat.
Beat 3 walks the **public** rail because that is the one a viewer can repeat with a
wallet they already have; beat 3b shows the private rail as the deeper integration.
Getting that order wrong would demonstrate a path almost nobody completes and call it
the way in.

---

## Beat 1 — the problem (0:00–0:22)

**On screen:** the hero, loaded fresh so the instrument resolves in and the clearing
price counts up.

> A Vickrey auction is the best auction we know how to design. Highest bidder wins,
> and pays the *second*-highest bid — so bidding your true value is the dominant
> strategy. There's nothing to game.
>
> It's been known since 1961. It has never worked on a public chain. Sealing the bids
> meant trusting an auctioneer with all of them, and revealing them at the end
> destroyed the privacy the mechanism runs on.

**Direction:** let the ladder finish resolving before speaking over it. The animation
is the first thing a judge sees and it should land on its own.

---

## Beat 2 — what the chain sees while bidding (0:22–0:48)

**On screen:** scroll to the open auction, then to *The whole public record*.

> Here's a live auction on Starknet mainnet. Three bids are in.
>
> This table is the entire public record of them. No addresses — a bid is filed under
> a claim handle, not a wallet. And no amounts: two hash anchors each, and nothing
> else.

**Direction:** hover a row so the reader's eye lands on *not disclosed* in the amount
column. Do not scroll past this quickly; it is the claim the rest depends on.

---

## Beat 3 — place a bid, on the rail a viewer can actually walk (0:48–1:16)

**Shoot the public rail.** Not the private one. A viewer who wants to copy what they
just watched can do the public rail in thirty seconds with a wallet they already have;
the private rail needs them to leave the app, shield inside their own wallet's interface
and pay the pool fee twice before they can start. Demonstrating a path almost nobody
completes, and calling it *the* path, is how a demo produces an audience that bounces.

The bid is sealed on both rails. That is the line to say out loud, because a viewer will
assume "public rail" means "public bid" and it does not.

**On screen:** the rail cards, public already selected. Pick a level on the ladder. The
wallet prompt. The claim-secret wall.

> I'll bid. There are two rails and I'm taking the ordinary one — connect, pick, sign.
>
> **Both rails seal the bid. The only difference is whether my address is publicly
> linked to having bid at all.** The amount is never in the calldata either way.
>
> I pick a level on a public price ladder — and everyone escrows the same amount, the
> top of the ladder, which is what stops the escrow itself leaking what I bid.
>
> What goes on chain is two hashes.
>
> And this is the only copy of my claim secret. No server has it. If I lose it, the
> money stays in the contract.

**Direction:** linger about a second on the three rail cards before clicking, so the
choice reads as a choice. Do not skip the claim-secret wall — it is a real interruption
and pretending otherwise oversells the experience.

---

## Beat 3b — the private rail, as depth not as the route (1:16–1:31)

Fifteen seconds. This is the integration a judge is scoring on the 30% STRK20 weighting,
and it is worth showing precisely because it is the harder thing — but shown as *what
the protocol can do*, not as *what you should go and do now*.

**On screen:** the private rail card selected, the setup note it reveals, then the
Starkscan transaction of a private-rail bid already placed, with the `Routed` event from
the anonymizer and `BidPlaced` from the auction both visible.

> The other rail also hides the bidder. The collateral is withdrawn from the STRK20 pool
> straight into escrow inside one transaction, so no address ever holds it in between.
>
> It costs more and it needs a shielded balance first — the wallet standard has no
> deposit call, so shielding happens in your wallet, not on our site. That is why this
> isn't the default.
>
> Here is one on chain. Our anonymizer, then the auction. No bidder anywhere in it.

**Direction:** pre-record this transaction. Do not attempt a live shield on camera.

---

## Beat 4 — settle (1:31–1:56)

**On screen:** the auctioneer console; press settle; the transaction lands; the
instrument redraws with the clearing line.

> Bidding closes. The contract stamps the block and freezes the set — that ordering
> matters, and I'll come back to it.
>
> Now settlement. The winner proves they're at or above a level. The runner-up proves
> they're exactly on it. Everyone else proves they're at or below. That's N+1 hash
> preimages, and together they pin the second price.

**Direction:** the clearing line wiping across and the price counting up is the
money shot. Hold on it for a full second before speaking again.

---

## Beat 5 — the moment (1:56–2:26) ▲ THE ENTRY RESTS HERE

**On screen:** the resolved auction, then the public record table again — **the same
table as beat 2, visibly unchanged in the amount column**. Then the explorer, showing
the settle transaction.

Exact wording:

> The auction is over. The winner paid **three point two five STRK**, and that number
> is on chain.
>
> Now look at what *isn't*.
>
> **This is the same table you saw before the auction settled. Every losing bid still
> reads "not disclosed" — and so does the winner's own bid. Those numbers were never
> published. Not on chain, not in this app, nowhere but the bidders' own devices.
> There is nothing left to open.**
>
> That's not a policy. Nobody is choosing to withhold them. The settlement proof
> establishes the price *without* opening a single bid, so the amounts have no
> on-chain existence to reveal.

**Direction, and this is the whole video:**

- Cut back to the **identical** table from beat 2, not a re-render. The viewer must
  see that nothing changed where a reveal would have shown.
- Say "there is nothing left to open" over the unchanged table, not over the price.
- Then, and only then, cut to the explorer so the claim is checkable rather than
  asserted.
- Do not add music swell here. The line is the effect.

---

## Beat 6 — the attack that fails (2:26–2:46)

**On screen:** split — the settle transaction on the left, the auctioneer console on
the right attempting to exclude a bid.

> One more. The auctioneer can't cheat this. To overstate the price it would have to
> forge a hash preimage. To drop a rival's high bid, the same. And it committed to the
> bid set on chain *before* it could read any of it — that's why the ordering
> mattered.
>
> If it excludes a bid anyway, that bidder proves they were above the line during the
> dispute window, voids the settlement, and takes the bond.

**Direction:** ten seconds, no more. Show the negative test failing in the terminal if
there is room; otherwise say it over the settle transaction.

---

## Close (2:46–3:00)

**On screen:** the trust statement, full, held long enough to read.

> Everything here is open source and unaudited, and the trust statement says exactly
> what is and isn't assured — including that after sealing, the auctioneer does learn
> the amounts. It just can never publish them or prove a false outcome.

**Direction:** end on the trust statement, not on a logo. Being precise about the
limits is a scoring criterion and it is the last thing a judge should see.

---

## What must not appear on camera

- Any number that is not read from mainnet.
- The Sepolia rehearsal — the badge must read mainnet.
- A placeholder, a mock, or a "coming soon".
- The word *audited*.

## Description text (same trust statement, verbatim, unshortened)

> **What is assured:** the winner and the clearing price are established by
> hash-preimage proofs verified on-chain over a bid set the contract froze before any
> bid could be opened, so the auctioneer cannot alter the outcome, exclude a bid, or
> misreport the price without failing a proof or being slashed in the dispute window.
> **What is not:** after sealing, the auctioneer learns every bid amount — it can
> never publish them, prove a false outcome, or spend anyone's funds, but it knows
> them; and the number of bids, their timing, and the uniform escrow amount are public
> on-chain.
