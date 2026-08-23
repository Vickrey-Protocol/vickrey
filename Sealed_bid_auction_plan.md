# Sealed-Bid Auctions on STRK20 — Build Plan

**Sprint:** STRK20 Private Sprint. Repo state on **31 Aug 2026, 23:59 UTC** is what gets judged.
**Idea:** RFP-08 — sealed-bid auctions where the bids are actually sealed.
**Objective:** first place. Not participation.

---

## 1. The competitive situation, first

Two entries are already on this idea:

- **Sealed** (entry 24) — deriving bid secrets from a wallet signature, fixing bid reveal. Working, and ahead of us.
- **Atrum** (entry 21) — reveal window for traders, 28 tests. Serious.

Others adjacent: Quietline (claim-ticket escrow), offbook (RFQ/OTC), GhostDeal, VINSS (deal room, settlement).

**So "we built sealed-bid auctions" is not a winning sentence.** Both of them will say it, with a week's head start.

What almost certainly nobody is building is the version below. Every claim in it is a place where a normal implementation is weak, and where we already know the answer because we hit the same problems on Stellar.

---

## 2. What we are building, precisely

An auction protocol with **six security properties**, each of which a typical commit-reveal or naive-STRK20 implementation fails:

| # | Property | What normally goes wrong |
|---|---|---|
| 1 | Bids are **real escrowed notes**, not commitments | Commit-reveal locks nothing; a bidder can commit to a bid they can't pay |
| 2 | Bids are sealed from **everyone, including the auctioneer**, during bidding | Trusted-auctioneer designs leak everything to the server |
| 3 | The auctioneer **commits to the bid set before learning any amount** | Otherwise the auctioneer can drop a rival's high bid and claim it never arrived |
| 4 | **Losing bids are never published** — only the clearing price is revealed | Commit-reveal publishes every bid; losers' true valuations leak forever |
| 5 | The outcome is **proved, not asserted** — ranking and clearing price are verified on-chain | Most implementations ask you to trust the settlement transaction |
| 6 | **Non-reveal cannot grief.** Settlement proceeds without the loser's cooperation | The RFP names this as commit-reveal's core weakness |

**Property 3 is the one that comes from our Stellar work and the one nobody else will have.** It is the same insight as Tally's round registry: if the party producing the disclosure can choose the set *after* seeing the contents, they can cherry-pick. On Stellar we fixed it by stamping `opened_at` from the ledger sequence so the window could not be backdated. Here the equivalent is: the auctioneer publishes a commitment over the received bid set, on-chain, before obtaining the ability to decrypt any of it.

**Property 4 is the strongest demo moment.** On a transparent chain, and in every commit-reveal scheme, the auction ends with every bid public. Here the auction ends and the losers' numbers have never existed in the clear anywhere except their own devices. That is genuinely impossible elsewhere and it is one sentence a judge understands immediately.

### Auction types on one contract
- **First-price sealed-bid** — highest bidder wins, pays their bid
- **Vickrey (second-price)** — highest bidder wins, pays the second-highest bid. The theoretically optimal auction, unimplementable on-chain without sealed bids. **This is the headline.**
- **Multi-unit** — uniform-price (all winners pay the lowest winning bid) and pay-as-bid

Vickrey is where the cryptography actually gets interesting, because the second price must be established **without publishing the bids that established it**.

---

## 3. Why this can take first place

Mapped to the published criteria:

**STRK20 integration depth — 30%.** Escrowed notes as bids, viewing-key material for the reveal path, an anonymizer contract for atomic bid submission, and if reachable a custom circuit through the self-hosted prover. That is four layers of the stack, not one. A shallow entry calls the SDK's transfer function and stops.

**Working mainnet product — 30%.** Anyone can create an auction; anyone can bid, including a judge, in under a minute. No login. This is the criterion most entries fail and it is satisfied here by construction — unlike a disbursement tool, which has no users on day eight.

**Innovation — 25%.** Vickrey with unpublished losing bids is a result, not a feature. Property 3 is an attack most teams will not have considered. The write-up itself says Vickrey has been known since 1961 and never deployable on-chain.

**Documentation & open-source — 15%.** Our existing discipline: trust statement, honest status section, negative tests, reproducible evidence. Near-automatic marks.

---

## 4. Phase 0 — investigation, no code

**Everything below is gated on this. Report before writing anything.** Timebox tight, but do not skip it: the ambitious version depends on answers we do not have, and finding out in week two loses the sprint.

**Q1 — Escrow.** Can a bid be a genuinely locked note — committed to the auction contract, unspendable elsewhere until settlement? The RFP says "real escrowed funds, not just commitments," so a mechanism should exist. What is it, exactly? What happens to escrow on refund?

**Q2 — Custom circuits. ⚠️ This gates the whole ambitious design.** Can we author our own Cairo/S-two circuit over note plaintexts with note commitments as public inputs, and have it verified on-chain? Or is proving restricted to the SDK's fixed circuit set? Is the self-hosted prover usable for custom circuits? **If the answer is no, Tier A and B in §6 are dead and we drop to Tier C on day two.**

**Q3 — Comparisons.** Can we prove `b_i ≥ b_j` over sealed values? Cost per comparison, and how it scales with N bidders. Note the settlement only needs O(N) comparisons, not O(N²) — see §5.

**Q4 — Viewing keys.** What exactly does viewing-key material let a third party learn? Is it per-user and pull-only, or can it be scoped to a single note or a single auction? The RFP's reveal path assumes something specific here.

**Q5 — Anonymizer contracts.** Can bid submission plus escrow be one atomic private transaction that reverts cleanly on failure?

**Q6 — Metadata leakage.** What does submitting a bid reveal? Is the *number* of bids public? Bid timing? Bidder identity? This determines what our trust statement can honestly claim, and it is the section every competitor will get wrong.

**Q7 — Force-reveal.** Does anything resembling threshold auditing exist today, or must non-reveal be handled purely by design?

**Q8 — Mainnet economics.** Cost and latency of a bid, and of settlement at N=10.

---

## 5. Architecture

### Phases

**1. Listing.** Auctioneer creates an auction: asset, type (first-price / Vickrey / multi-unit), units, reserve price, bidding deadline, reveal deadline. On-chain, public.

**2. Bidding.** Each bidder submits an encrypted bid note, escrowed to the auction contract. The bid binds `(auction_id, bidder, amount, blinding)`. Sealed from everyone, auctioneer included. The contract records the arrival of each bid.

**3. Sealing.** At the bidding deadline the contract stamps closure **from the block/ledger value itself, never from a caller-supplied parameter** — the same rule as Tally's `opened_at`. The bid set is now fixed and the auctioneer gains the ability to decrypt. **Order matters: commitment first, decryption second.** This is property 3.

**4. Settlement.** The auctioneer (or anyone holding the reveal material) produces **one proof** establishing:
   - the winning bid is the maximum of the committed set — N−1 comparisons
   - the clearing price is the maximum of the remainder — N−2 comparisons
   - the winner's escrowed note covers the clearing price
   - every bid in the proof is in the committed set, and none is omitted

   Total O(N) comparisons. Only the **clearing price** and the **winner** become public.

**5. Distribution.** Winner receives the asset, pays the clearing price. Losers receive refunds as private notes. Winner's surplus (bid minus clearing price, in Vickrey) refunds privately — **the winner's own bid is never revealed either**, which is a second thing to say out loud.

### Anti-griefing (property 6)
Because settlement is a proof over the committed set rather than a collection of self-reveals, a bidder going offline cannot block anything. Nobody needs a loser's cooperation to settle. State this explicitly — it is the RFP's named failure of commit-reveal and we simply do not have it.

---

## 6. Fallback ladder

Decide the tier on Phase 0 evidence, not optimism. Move down a tier the day the evidence says so, loudly, and say so in the README.

- **Tier A — full ranking proof.** All comparisons in-circuit; no bid amount ever leaves a device except the clearing price. Best possible outcome.
- **Tier B — auctioneer-as-prover.** The auctioneer decrypts after sealing and produces the ranking proof. Losing bids are never *published*, though the auctioneer learns them. Weaker than A, still far ahead of the field, and the RFP's own model ("invisible to everyone, including the auctioneer, **until reveal**"). **Assume this is the realistic target.**
- **Tier C — reveal-with-forfeiture.** What the RFP describes as baseline and what competitors will build: bidders reveal, mismatches forfeit. Only if A and B are both impossible.

**The trust statement changes with the tier.** Write it for the tier actually shipped, not the one hoped for.

---

## 7. Scope

**Must exist by 31 Aug — nothing ships without these**
- Auction contract on mainnet: listing, bidding, sealing, settlement
- First-price **and** Vickrey on the same contract
- Web app: create auction, place bid, watch settle, see result. No login.
- At least three real mainnet transactions
- One complete auction run on mainnet with ≥ 5 real bidders
- `strk20.json` at repo root: demo video, contract addresses, transaction hashes
- 2–3 minute demo video
- README, MIT license, trust statement, honest status section

**Strongly wanted**
- Multi-unit auctions
- Anonymizer contract for atomic bid submission
- A public auction anyone can bid in, live, during judging
- Negative tests: bid after deadline, settle before deadline, auctioneer attempts to exclude a bid, forged clearing price, replayed bid

**Explicitly not doing**
- Auction discovery, search, profiles, notifications
- Mobile
- Anything not visible in the demo video

---

## 8. Timeline

Sequenced against 31 Aug. Report at the end of each block.

- **Day 0 (today).** Entry PR to `registry.json`. `npx skills add welttowelt/strk20-skills`. Fund a mainnet account. Fork the Next.js starter kit. First push — the leaderboard reads the repo every 30 minutes and days-active is public.
- **Days 1–2.** Phase 0. Report. Pick the tier. Draft the trust statement for that tier before building.
- **Days 3–5.** Contract and circuits: listing, bidding, sealing, settlement. First-price first, Vickrey immediately after. Negative tests written **before** happy paths — this caught a real bug on Stellar.
- **Days 5–6.** Web app on the starter kit. Create, bid, settle, result.
- **Day 6.** Mainnet deployment. Full auction with ≥5 real bidders — recruit them now, not on day six.
- **Day 7.** `strk20.json`, demo video, README, trust statement, status section.
- **Day 8.** Buffer. Something on mainnet will break.

**Continuously:** push often, keep the repo defensible at all times. Nothing is submitted at the end — whatever the repo shows is what is judged.

---

## 9. The demo video

Two to three minutes. The panel will not clone the repo. Structure:

1. **The problem, in one sentence.** Vickrey auctions are optimal and have been unbuildable on-chain since 1961 because sealed bids needed a trusted auctioneer.
2. **Bid live.** Two or three bids placed on mainnet. Show the chain: nothing visible.
3. **Settle.** The clearing price appears. The winner appears.
4. **The moment.** Show that the losing bids are *still* not public — not on chain, not in the app, nowhere. Then show the on-chain proof that the price is nonetheless correct.
5. **The attack we prevent.** Auctioneer tries to drop a high bid; the commitment ordering makes it fail. Ten seconds, and it is the thing no competitor will show.

Point 4 is the video. Everything else is setup.

---

## 10. Working rules (carried over, unchanged)

- **Investigate and report before writing code.**
- **Never inherit a property without re-verifying it here.** STRK20 hides senders; Stellar publishes them. Assume nothing transfers.
- **Negative tests before happy paths.**
- Two-sentence trust statement — what is assured, what is not — verbatim in README, site and video description. Never shortened.
- No claim in public text that has not been verified against the code, at the revision actually read.
- Everything in `CONTRIBUTING.md` still applies.

---

## 11. Risks

| Risk | Response |
|---|---|
| **Q2 fails — no custom circuits** | Tier C on day two. Differentiate on property 3 and 6, which do not need custom circuits. |
| Sealed and Atrum are ahead | We are not racing them on the base feature. Properties 3, 4 and 6 are the race. |
| Cairo is new | Starter kit and skills reduce it. Budget learning time in days 1–2. |
| Mainnet with real funds | Nominal amounts. Sepolia first where possible. |
| Not enough real bidders | Recruit five people **today**, not on day six. |
| Scope creep into multi-unit | Multi-unit is optional. First-price plus Vickrey shipped beats three variants half-built. |

---

## 12. Name

Needs one that is not Tally and not Sealed. Candidates: **Reserve** (the reserve price, and the sense of holding back), **Paddle**, **Vickrey** (instantly legible to anyone who knows auction theory), **Hammer**. Check GitHub and npm before committing — the Tally collision cost us a rename.