"use client";

/**
 * Bounding a wallet call that may never answer.
 *
 * A wallet method is a promise across a process boundary we do not control. Most settle;
 * some do not. Approving a network switch in Ready X moved the wallet and never resolved
 * `wallet_switchStarknetChain`, so the `await` never returned, the `finally` that clears
 * the pending flag never ran, and the modal sat on "Asking the wallet…" forever — with
 * the wallet already on the right chain the whole time.
 *
 * Rule 11 governs what a timeout is allowed to mean. It is **not** a refusal and not a
 * failure: it is the absence of an answer, and the only honest report is that we asked
 * and have not heard back. `outcome` says which happened so callers cannot collapse the
 * two.
 */
export type Waited<T> =
  | { outcome: "answered"; value: T }
  | { outcome: "failed"; error: unknown }
  | { outcome: "no-answer" };

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<Waited<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Waited<T>) => { if (!settled) { settled = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => done({ outcome: "no-answer" }), ms);
    p.then((value) => done({ outcome: "answered", value }),
           (error) => done({ outcome: "failed", error }));
  });
}

/**
 * How long to wait on each kind of call.
 *
 * Reads and metadata are quick or broken. Signing and proving are neither: a STRK20
 * proof legitimately takes ~30 seconds and the user may be reading the wallet's prompt,
 * so those are deliberately **not** bounded here — timing out a submitted transaction
 * would let us report "no answer" about a bid that then lands, which is worse than
 * waiting. Their pending copy says so instead.
 */
export const WAIT = {
  /** `requestChainId`, `supportedWalletApi` — a wallet that will not say this is broken. */
  read: 6_000,
  /** `switchStarknetChain` — the user has a prompt to approve, so allow for a human. */
  switch: 45_000,
  /** `strk20Balances` — one read, behind a consent prompt. */
  balance: 60_000,
  /** `requestAccounts` during connect — a human is reading an approval dialog. */
  connect: 90_000,
} as const;
