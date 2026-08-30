/**
 * Each row answers its own question, in its own words.
 *
 * /wallet-check has been wrong three times, and two of those were one mistake: a single
 * error object handed to a single sentence-writer, printed in two rows that ask different
 * questions. On Xverse the reachability row explained the user's shielded-balance state;
 * on Ready X it apologised for a bug that was not one. Both were the real read's sentence
 * appearing in a row about method reachability.
 *
 * So the property under test is not "the message is nice". It is: for the *same* input,
 * the two rows must not say the same thing, and neither may borrow the other's meaning.
 */
import { describe, expect, it } from "vitest";
import { WALLET_ERRORS, readWalletError } from "@vickrey/client";
import {
  REACH_LABEL, REAL_READ_LABEL, reachabilityAnswered, reachabilityRejected,
  realReadFailed, realReadPassed, routedNotFailed,
} from "@/lib/walletCheck";

const err = (code: number) =>
  ({ code, message: `An error occurred (${(WALLET_ERRORS as Record<number, { name: string }>)[code]?.name ?? "X"})` });

describe("rows do not share messages", () => {
  it("gives different text to the two rows for the same error", () => {
    for (const code of Object.keys(WALLET_ERRORS).map(Number)) {
      const real = realReadFailed(err(code), "SN_SEPOLIA");
      const reach = reachabilityRejected(err(code));
      expect(reach.detail).not.toBe(real.detail);
      expect(reach.label).not.toBe(real.label);
    }
  });

  it("never lets the reachability row use the real read's sentence", () => {
    /* The exact Xverse bug: NOT_REGISTERED's explanation is about balances, and it
       appeared in a row about whether a method responds — directly under a real read
       that had passed. */
    for (const code of Object.keys(WALLET_ERRORS).map(Number)) {
      const say = (WALLET_ERRORS as Record<number, { say: string }>)[code]!.say;
      expect(reachabilityRejected(err(code)).detail).not.toContain(say);
    }
  });

  it("does not apologise for the argumentless call, which is deliberate", () => {
    /* The Ready X bug: INVALID_REQUEST_PAYLOAD maps to "That is our bug, not yours",
       which is right for a real read and wrong here — we omit `tokens` on purpose. */
    const reach = reachabilityRejected(err(114));
    expect(reach.detail).not.toMatch(/our bug/i);
    expect(reach.detail).toMatch(/deliberately|on purpose/i);
    expect(reach.detail).toMatch(/correct/i);
  });

  it("is never a warning, because a rejection there is correct behaviour", () => {
    for (const code of Object.keys(WALLET_ERRORS).map(Number)) {
      expect(reachabilityRejected(err(code)).state).not.toBe("warn");
    }
    expect(reachabilityAnswered().state).not.toBe("warn");
  });

  it("states its own weakness in both outcomes", () => {
    for (const row of [reachabilityAnswered(), reachabilityRejected(err(163))]) {
      expect(row.detail).toMatch(/exists and nothing more/i);
      expect(row.detail).toMatch(/row above/i);
    }
  });

  it("names the code for the record without interpreting it", () => {
    expect(reachabilityRejected(err(118)).detail).toContain("NOT_REGISTERED");
    expect(reachabilityRejected(err(118)).detail)
      .not.toContain("no shielded presence in the pool yet");
  });
});

describe("the real read reports the read, and the network the wallet was on", () => {
  it("passes when the read completes", () => {
    const r = realReadPassed(1, "SN_SEPOLIA");
    expect(r.state).toBe("pass");
    expect(r.detail).toContain("SN_SEPOLIA");
    expect(r.label).toBe(REAL_READ_LABEL);
  });

  it("treats NOT_REGISTERED and a refusal as routed, not failed", () => {
    for (const code of [118, 113]) {
      expect(routedNotFailed(code)).toBe(true);
      expect(realReadFailed(err(code), "SN_MAIN").state).toBe("pass");
    }
  });

  it("fails on the spec's catch-all rather than excusing it", () => {
    /* UNKNOWN_ERROR was being shown raw and read as inconclusive. It is a failed read. */
    const r = realReadFailed(err(163), "SN_SEPOLIA");
    expect(r.state).toBe("fail");
    expect(r.detail).toContain("FAIL on SN_SEPOLIA");
  });

  it("shows the raw payload only when the code is unrecognised", () => {
    expect(realReadFailed({ code: 999 }, "SN_MAIN").detail).toMatch(/Raw:/);
    expect(realReadFailed(err(163), "SN_MAIN").detail).not.toMatch(/Raw:/);
  });

  it("never prints [object Object]", () => {
    for (const thrown of [{ code: 163 }, { nope: 1 }, "s", null]) {
      expect(realReadFailed(thrown, "SN_MAIN").detail).not.toContain("[object Object]");
      expect(reachabilityRejected(thrown).detail).not.toContain("[object Object]");
    }
  });
});

describe("labels are distinct and self-describing", () => {
  it("says which call each row made", () => {
    expect(REAL_READ_LABEL).toContain("strk20Balances([STRK])");
    expect(REACH_LABEL).toContain("no token list");
    expect(readWalletError({ code: 118 }).name).toBe("NOT_REGISTERED");
  });
});
