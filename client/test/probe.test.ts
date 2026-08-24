/**
 * The classifier that decides whether a wallet can do STRK20 at all.
 *
 * Worth testing because a wrong answer here is not a cosmetic bug: the page told a real
 * user their wallet had failed when it had relayed `NOT_REGISTERED` from the pool, and
 * acting on that would have meant abandoning the pool strategy and not funding a
 * declare. Shape versus state, one layer up from `verify-pool-shapes.mjs`.
 */
import { describe, expect, it } from "vitest";
import { classifyProbeError } from "../src/probe.ts";

/** Protocol replies. The wallet understood the call — that is the whole test. */
const STATE = [
  "NOT_REGISTERED",
  "Error: NOT_REGISTERED",
  "NOT_REGISTERED: register a subchannel first",
  "Execution reverted: NOT_REGISTERED",
  "SUBCHANNEL_NOT_FOUND",
  "insufficient balance",
  "nullifier already used",
  "channel_exists returned false",
  "User rejected request",
  "User denied consent",
];

/** The interface is absent. The only genuine failure. */
const SHAPE = [
  "acct.strk20Balances is not a function",
  "Method not supported",
  "starknet_strk20Balances: method not found",
  "Unknown method strk20Balances",
  "This wallet does not implement STRK20",
  "Wallet does not support STRK20",
];

describe("strk20 probe classification", () => {
  it.each(STATE)("treats a protocol reply as a pass: %s", (msg) => {
    expect(classifyProbeError(msg).pass).toBe(true);
  });

  it.each(SHAPE)("treats an absent method as a failure: %s", (msg) => {
    expect(classifyProbeError(msg).pass).toBe(false);
  });

  it("names NOT_REGISTERED rather than just passing it", () => {
    const v = classifyProbeError("NOT_REGISTERED");
    expect(v.pass).toBe(true);
    expect(v.reason).toMatch(/NOT_REGISTERED/);
    expect(v.reason).toMatch(/shield/i);
  });

  it("always gives a reason, so a verdict can be argued with", () => {
    for (const m of [...STATE, ...SHAPE]) {
      expect(classifyProbeError(m).reason.length).toBeGreaterThan(20);
    }
  });
});
