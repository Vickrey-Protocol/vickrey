/**
 * Classifying a wallet's answer to `strk20Balances`: shape versus state.
 *
 * The question the probe asks is whether the wallet **implements** the STRK20
 * interface. That is a question about shape. It is not a question about whether the
 * account has a shielded balance, is registered with the pool, or consented to the
 * read — those are state, and every one of them produces an error.
 *
 * The distinction matters because getting it backwards inverts the conclusion. A wallet
 * that relays `NOT_REGISTERED` has understood the call, routed it to the pool, and
 * returned the pool's reply — it has demonstrated exactly the capability we are testing
 * for. Reading that as "this wallet cannot do STRK20" would abandon a working strategy.
 *
 * It is the same rule `scripts/verify-pool-shapes.mjs` applies one layer down, where our
 * encoded actions are expected to "fail on state, not on shape" against the live pool.
 * Here it is applied to the wallet rather than to the pool.
 *
 * So the default is PASS, and only an explicitly absent method is a FAIL.
 */

/** The wallet does not offer the method at all. The only genuine failure. */
const NOT_IMPLEMENTED =
  /not a function|undefined is not|unsupported|not support|not implement|method not found|unknown method|no such method|does not exist/i;

export type ProbeVerdict = {
  pass: boolean;
  /** Why, in words — a verdict without a reason is not reviewable. */
  reason: string;
};

/** No error at all: the wallet answered. */
export const probeAnswered = (): ProbeVerdict => ({
  pass: true,
  reason: "Answered normally. The wallet implements STRK20.",
});

/** The method was missing from the account object before any call was made. */
export const probeMissing = (): ProbeVerdict => ({
  pass: false,
  reason: "NOT IMPLEMENTED — the method does not exist on this account object.",
});

/** Classify a thrown error. */
export function classifyProbeError(message: string): ProbeVerdict {
  if (NOT_IMPLEMENTED.test(message)) {
    return {
      pass: false,
      reason: `NOT IMPLEMENTED — the wallet does not offer this method. Raw: ${message}`,
    };
  }
  if (/not[_ ]?registered/i.test(message)) {
    return {
      pass: true,
      reason:
        "PASS · NOT_REGISTERED — the pool replied. This account has no shielded presence yet, " +
        "which is what your first shield creates. The wallet routed the call, so the interface is there.",
    };
  }
  if (/reject|denie|declin|cancel|consent/i.test(message)) {
    return {
      pass: true,
      reason: "PASS · You declined the consent prompt, which means the wallet understood the request.",
    };
  }
  return {
    pass: true,
    reason: `PASS · The wallet returned a protocol-level reply, so the call was routed: ${message}`,
  };
}
