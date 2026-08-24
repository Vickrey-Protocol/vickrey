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
