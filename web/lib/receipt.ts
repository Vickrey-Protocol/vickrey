/**
 * What a receipt says happened.
 *
 * `waitForTransaction` resolves for a transaction that was accepted and then REVERTED —
 * it waits for inclusion, not for success. The bid screen read "resolved" as "placed"
 * and showed the claim-secret screen for a bid that never reached the auction, so a
 * bidder could save a secret for an escrow that does not exist and walk away.
 *
 * Read the execution status explicitly. Anything that is neither a clear success nor a
 * clear revert is `unknown`, and callers must not turn that into either.
 */
export type ReceiptOutcome =
  | { kind: "succeeded" }
  | { kind: "reverted"; reason: string }
  | { kind: "unknown" };

export function receiptOutcome(rcpt: unknown): ReceiptOutcome {
  const r = (rcpt ?? {}) as {
    execution_status?: string; revert_reason?: string;
    statusReceipt?: string; value?: { execution_status?: string; revert_reason?: string };
  };
  const status = r.execution_status ?? r.value?.execution_status ?? r.statusReceipt;
  if (status === "SUCCEEDED") return { kind: "succeeded" };
  if (status === "REVERTED") {
    return { kind: "reverted", reason: r.revert_reason ?? r.value?.revert_reason ?? "" };
  }
  return { kind: "unknown" };
}

/**
 * The revert reasons Cairo produces are long traces; the felt-encoded short string near
 * the end is the part a person can act on. Returns it if there is one, else the start.
 */
export function shortRevert(reason: string): string {
  const named = [...reason.matchAll(/'([A-Z0-9_]{4,31})'/g)].map((m) => m[1]);
  if (named.length) return named[named.length - 1]!;
  return reason.length > 160 ? `${reason.slice(0, 160)}…` : reason;
}
