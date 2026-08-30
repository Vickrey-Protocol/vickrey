# Contributing

## Working rules

These are not style preferences. Each one is here because skipping it cost something.

1. **Investigate and report before writing code.** [PHASE0.md](PHASE0.md) is what that
   looks like. The design in this repo is different from the one originally planned
   because the investigation said so.
2. **Never inherit a property without re-verifying it here.** STRK20 hides senders.
   Other chains publish them. Assume nothing transfers.

   The same applies to a default carried between two callers of one function.
   `check-deployed.mjs` grew a 30-minute grace window so the *scheduled* check would not
   cry wolf during the minutes between a push and a deploy. That is right there and
   wrong inside `deploy-web.sh`, whose last line calls the same script to prove the
   deploy it just ran has landed: there the wait is already over, so any drift means
   failure. The default followed the function into the second context and the script
   reported "ahead of live by 1 min — not stale yet", exit 0, on the very deploy it was
   verifying. A genuinely failed deploy would have printed the same thing. One function,
   two callers, and only one of them wanted the default — so pass it explicitly at the
   call site that differs (`GRACE_MIN=0`), rather than letting the definition decide for
   both.
3. **Negative tests before happy paths.** `test_negative.cairo` was written first. It
   is the file that says what the system refuses to do, which is the part worth being
   sure about.
4. **No claim in public text that has not been verified against the code**, at the
   revision actually read. If something is unverified, the word "UNVERIFIED" belongs
   next to it — see the README status section for the ones outstanding.
5. **The trust statement is two sentences and is never shortened.** It appears
   verbatim in [TRUST.md](TRUST.md), the README, the app and the video description.
   Changing the tier changes the statement.
6. **Published documentation lags the chain. Read the chain.** Three times now the
   written source has been out of date and the live contract has been right:

   | Documentation said | The chain said | Cost of believing the doc |
   |---|---|---|
   | Blast RPC is the endpoint | retired, no response | every RPC URL in the repo was dead |
   | Sepolia explorer mirrors mainnet's host | `sepolia.starkscan.co` does not resolve | a judge clicking a contract link gets NXDOMAIN |
   | Shielded transactions cost 4 STRK | `get_fee_amount` returns **6** | a funding plan 50% short on every pool operation |

   So: no number that a contract can be asked for is ever hardcoded from a blog post,
   an announcement, or a guide. The pool fee is read live from `get_fee_amount`. Token
   decimals are read from `decimals()` — assuming 18 rendered a 250 USDC lot as `0`.
   Endpoints are fetched by `scripts/check-links.mjs` rather than trusted.

   The corollary matters as much: **check a document's date before citing it as a
   limit.** A May guide saying only strkBTC is shieldable was quoted here as a caution
   after STRK20 had shipped in June and July's "Push to Private" had stated any ERC-20.
   Stale sources produce false blockers, which waste as much time as false confidence.
7. **Ask what the current behaviour is protecting before you change it.** The obvious fix
   to an apparent bug can open a worse hole than the one it closes.

   Forfeited escrow stays in this contract forever and no path releases it. That reads as
   a leak, and the obvious repair is to sweep it to the seller. Marking a bid forfeited
   requires **no proof** — the auctioneer declares it — so paying that escrow to the
   seller would let an auctioneer who is also the seller profit from forfeiting everyone.
   The apparent bug is what makes the forfeit power safe to hold.

   So the question to answer first is never "how do I fix this", it is "what breaks if I
   do". Where the answer is load-bearing, say so in the docs: a reader who finds money
   locked in a contract will assume a defect unless told otherwise.
8. **A path covered by consequence is not covered.** Assert the contract's own holdings,
   not only that the calls which follow succeed.

   Every `pull` in this contract was exercised by tests that would have failed if the
   pull had not happened — a claim later on would have come up short. That is coverage of
   the *entry*, and it left every *exit* invisible: two defects reached the write-up, and
   both were about where money went on the way out.

   `a_full_lifecycle_conserves_value` is the shape that catches them. It asserts what the
   contract holds at each stage and that it holds **nothing** once an ordinary auction
   has been claimed out. Prefer one invariant over a checklist of paths — the checklist
   only covers what somebody thought to list.
9. **Reachability is its own property.** A feature can exist in the contract, have tests,
   and appear in the documentation, and still be unreachable from the interface.

   `abandon` shipped exactly like that: seven tests, a section in `/docs`, and no button
   anywhere. Every individual check passed, because each verified one side. Nothing
   asserted the relationship *between* the contract and the app, and that relationship is
   a property in its own right.

   `scripts/check-reachability.mjs` asserts it: every external entrypoint is either
   reached by the app, or listed as deliberately not user-facing **with a reason**. Adding
   an entrypoint forces the decision; forgetting to wire one up fails CI. Running it the
   first time immediately found a second instance — a public-rail bidder could not claim
   their own refund, because the claim panel only offered the STRK20 path.
10. **A truthiness guard on a number is not a boolean.** `tick && 0` evaluates to `0`,
    not `false`, and `0 && x` short-circuits to `0` rather than running `x`.

    Threading a clock into the action queue, `actionsFor(..., tick && 0)` type-checked,
    ran, and silently passed `0` as the current time — so a deadline comparison was
    always against the epoch and `abandon` would never have appeared. Numbers used as
    conditions are the easiest place in this codebase to write something that is wrong and
    quiet. Compare explicitly.

11. **Absence of an answer is not a negative answer.** Three states, not two: answered
    yes, answered no, and has not answered yet. Code that collapses the third into the
    second fails in the direction of *looking correct* — it produces a definite, plausible
    outcome instead of an error, so nothing surfaces and nobody investigates.

    This has now cost something six times, and it is always the same shape wearing
    different clothes. `NOT_REGISTERED` from `strk20Balances` is the pool *answering* —
    the wallet understood the call and routed it — and reading it as "this wallet cannot
    do STRK20" would have abandoned a working strategy. Our encoded pool actions are
    expected to fail on state, not on shape, and the two look alike from the outside.

    The worst instance was the silent reconnect. Wallet discovery is an announcement
    protocol: `getWallets()` returns whoever has replied *so far*, and on a cold reload
    that is often nobody, because the extension is still starting while React is already
    mounting. An empty list meant "nobody has answered yet" and was read as "no wallet
    installed" — and the caller then ran `forgetWallet()`, erasing the remembered name.
    A wallet that is merely locked returns nothing here too. So one unlucky reload
    ended the session permanently, and the symptom was the exact screen the feature had
    been built to prevent.

    Two habits follow.

    **Never take an irreversible action on a missing answer.** Forgetting, disabling,
    marking unsupported, deleting — all of them need a real "no", not a silence. Waiting
    and retrying costs nothing when the operation cannot prompt.

    **Never substitute an arbitrary answer for a missing one.** The same reconnect code
    fell back to `found[0]` when the named wallet was absent, so with several extensions
    installed it would read the chain of a wallet the user had never connected and report
    a network mismatch with no visible cause. A wrong answer is harder to diagnose than
    no answer, because it looks like data.

    Ask of every empty result: can I tell "no" from "not yet"? If not, treat it as "not
    yet" and say so in the code, because that is the reading that stays recoverable.

12. **Correcting the README is not correcting the product.** A claim lives wherever it
    was written, not where you remember writing it.

    The Wallet API "has exactly three STRK20 methods and none of them deposits" was found
    to be wrong, corrected in the README with its own section explaining the correction —
    and left standing in three other places: `/wallet-check` and twice in `Panels.tsx`.
    Users read the app. For days the product asserted the falsehood while the
    documentation explained why it was false.

    So when a claim turns out to be wrong, **grep for the claim**, not for the file. Grep
    for the phrase, for the distinctive noun, for the negation — "no deposit", "none of
    them", "has no". Fix every instance in one commit, so no version of it can outlive
    the correction. And a correction is worth a test wherever the claim is load-bearing:
    the fix is only permanent if something fails when it regresses.

13. **Some CSS properties change an element's layout _role_, not just its appearance.**
    Three instances now, none visible in the declaration, all three found by measuring.

    | Property | What it silently changed | How it presented |
    |---|---|---|
    | `position: absolute` on `.nav` | out of flow, so `order` and `flex` cannot move it | narrow rules written against it did nothing; the nav sat on top of the wordmark |
    | `backdrop-filter` on `.dash-top` | the bar becomes the containing block for every `position: fixed` descendant | a bottom sheet pinned to the bottom of a 64px topbar, its full-screen veil covering nothing else |
    | `position: fixed` on `.dash-side` | no longer a grid item, so it stops being placed by the grid | `.dash-main` became the only item in flow and was laid out inside the 72px rail |

    Each reads as a value — where a thing sits, what it looks like. Each is really a
    change of kind: in or out of flow, whose coordinate system a descendant resolves
    against, whether the parent's layout algorithm sees the element at all. The
    declaration says nothing about the consequence, and the consequence lands on a
    *different* element than the one carrying the property — the nav's positioning broke
    rules about the nav, but the filter on the topbar broke a sheet inside it, and the
    sidebar's positioning broke the main column beside it.

    **Two of the three produced screenshots that still looked plausible.** The desktop
    popover landed close enough to right that the bug only appeared at 390px, and the
    collapsed rail looked correct while the content was laid out inside it. So looking is
    not sufficient: assert geometry — bounding boxes, computed `position` and `display`,
    which element is at a point — and compare against what you intended.

    When layout is wrong and the CSS reads correctly, stop re-reading the values. Ask
    what the properties in play do to the box model's *structure*: what is still in flow,
    what containing block a descendant resolves against, and what the parent's layout
    algorithm still considers a child.

## Before you push

```shell
scarb fmt && scarb build && snforge test
cd client && npm test && npx tsc --noEmit
cd web    && npm run build
```

Everything must be green and warning-free. `scarb build` emits no warnings today; keep
it that way.

## Changing the cryptography

`packages/auction/src/ladder.cairo` and `client/src/ladder.ts` are the same algorithm
written twice. If you touch either:

1. Change both.
2. Regenerate the vectors: `snforge test --package auction test_vectors`.
3. Paste them into `client/test/conformance.test.ts`.
4. Run both suites.

A drift between them is silent until a real bid turns out to be unprovable, which is
why the conformance test exists.

## Changing anything the pool sees

`OpenNoteDeposit` and the `privacy_invoke` signature are a wire format shared with the
STRK20 pool. `packages/anonymizer/tests/test_layout.cairo` pins them. If that test
changes, `client/src/strk20.ts` and the web app's calldata almost certainly need to
change with it.

## Deploying

`scripts/deploy.sh` runs the full test suite before it touches a network, on purpose.
Do not add a flag to skip it.
