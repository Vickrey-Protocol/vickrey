# Questions for the Cairo CoreStars Telegram

Two of the original four were answered from source and are no longer worth anyone's
time — recorded here so nobody re-asks them:

- **`OpenNoteDeposit`'s layout** — read from `packages/privacy/src/objects.cairo` @
  `36eac4ea`. Matches. Closed.
- **The action envelope** — `STRK20_ACTION` in `@starknet-io/starknet-types-0103`
  defines `withdraw { token, amount, recipient }`. Closed.

What is left needs a human.

---

**Context (one line, for the group):** building sealed-bid Vickrey auctions for the
STRK20 sprint. Bids escrow through our own anonymizer contract; refunds and the lot
come back as open notes.

**1. Is `withdraw` → `invoke` the intended shape for a helper that *parks* funds?**

Every documented example is the DeFi round-trip: `transfer … "OPEN"` then `invoke`,
with the helper returning an `OpenNoteDeposit`. Ours has a leg that deliberately
returns an **empty span** — the pool withdraws collateral to the helper, the helper
forwards it into an escrow contract, and nothing is credited back until settlement,
possibly days later.

```ts
[
  { type: "withdraw", token: PAYMENT, amount: COLLATERAL, recipient: HELPER },
  { type: "invoke",   contract: HELPER, calldata: [...] },   // returns [].span()
]
```

Is that a supported shape, or does the pool expect every `invoke` to be paired with an
open note? The escrow example on strk20-by-example does exactly this on its deposit
leg, but it is flagged unofficial, so we would rather hear it from you than infer it.

**2. Sepolia: is there a pool, and a wallet that can reach it?**

We want to run a full auction end-to-end before going near mainnet. Is there a Sepolia
privacy pool deployed, and does Ready (or Xverse) support STRK20 on Sepolia — or is
mainnet with nominal amounts the only realistic route? The testing note we have says to
plan wallet-flow testing against a public network rather than a devnet, but does not
say which.

**3. Current pool addresses.** Mainnet and Sepolia if it exists. The address is pinned
in our anonymizer's constructor and gates `privacy_invoke`, so we would rather not
guess it.

**4. Is the Privacy SDK installable anywhere?**

`@starkware-libs/starknet-privacy-sdk` is not on the public npm registry and a search
turns up nothing equivalent, so we have built entirely on the Wallet API route. If
there is a published or GitHub-installable build we should be using for a headless
auctioneer, we would rather know now than after the deadline.

**5. Any gotcha with a long-lived helper?**

Ours holds no funds *between* transactions — collateral passes straight through to the
auction contract — but the auction contract itself holds escrow across days. The
security checklist covers stateful helpers; is there anything specific to a helper
whose downstream contract is long-lived that we should have caught?
