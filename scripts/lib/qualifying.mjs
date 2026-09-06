/**
 * What makes a transaction a qualifying one, defined once.
 *
 * Two scripts need this answer and they must not answer it differently:
 * `verify-private-tx.mjs` checks a hash a wallet just sent, and
 * `check-submission.mjs` checks the hashes we are about to declare. Two
 * implementations of one rule is how a checker comes to agree with itself while
 * disagreeing with reality — the same reason `actionsFor` is imported by the live
 * observation harness rather than transcribed into it.
 *
 * The rule has three parts and all three matter:
 *
 *   pool    — an event from the STRK20 pool. Without it nothing about the transaction is
 *             private, and the sprint requires pool contact.
 *   routed  — a `Routed` event from one of *our* declared contracts. This identifies the
 *             anonymizer by what it did rather than by a name we would have to configure,
 *             and it is the half `MockPrivacyPool` could never establish.
 *   ours    — some other event, or a calldata reference, tying the transaction to a
 *             contract we declared. This mirrors the hub's own `mine`.
 *
 * `ours` alone is what the hub counts. `routed` is ours on top of that, and it is the
 * difference between "a bid that went through the private rail" and "any pool activity
 * that happened to mention us".
 */

/** Poseidon selector for `Routed`, computed once by the caller and passed in. */
export const sameAddress = (a, b) => {
  try { return BigInt(a) === BigInt(b); } catch { return false; }
};

/**
 * @param receipt      starknet_getTransactionReceipt result
 * @param calldata     starknet_getTransactionByHash `.calldata`, or []
 * @param pool         the STRK20 pool address
 * @param own          addresses we declared in `contracts`
 * @param routedKey    selector for `Routed`
 */
export function classify(receipt, calldata, { pool, own, routedKey }) {
  const events = receipt?.events ?? [];
  const succeeded = receipt?.execution_status === "SUCCEEDED";
  const touchedPool = events.some((e) => sameAddress(e.from_address, pool));

  /* `null`, not `false`, when nothing is declared — the hub treats those differently and
     so must we. A project with no contracts is judged on pool contact alone. */
  let ours = null;
  if (own.length) {
    ours = events.some((e) => own.some((a) => sameAddress(e.from_address, a)))
      || calldata.some((f) => own.some((a) => sameAddress(f, a)));
  }

  const routed = own.length
    ? events.some((e) =>
        own.some((a) => sameAddress(e.from_address, a)) &&
        sameAddress(e.keys?.[0] ?? 0, routedKey))
    : null;

  /** What the hub will count. */
  const countedByHub = succeeded && touchedPool && ours !== false;

  /** What we require of ourselves once we have declared contracts. */
  const privateRail = succeeded && touchedPool && ours === true && routed === true;

  return { succeeded, touchedPool, ours, routed, countedByHub, privateRail };
}

/** Why a transaction is not a private-rail bid, in words. Null when it is one. */
export function whyNot(c) {
  if (!c.succeeded) return "reverted";
  if (!c.touchedPool) return "did not touch the STRK20 pool";
  if (c.ours === false) return "touched the pool, but not through a contract we declared";
  if (c.routed === false) {
    return "went through our contracts without a Routed event — a public-rail bid or a "
      + "bare shield, not a private-rail bid";
  }
  return null;
}
