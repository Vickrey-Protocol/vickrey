# Contributing

## Working rules

These are not style preferences. Each one is here because skipping it cost something.

1. **Investigate and report before writing code.** [PHASE0.md](PHASE0.md) is what that
   looks like. The design in this repo is different from the one originally planned
   because the investigation said so.
2. **Never inherit a property without re-verifying it here.** STRK20 hides senders.
   Other chains publish them. Assume nothing transfers.
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
