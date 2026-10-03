/**
 * `waitForTransaction` resolves for a REVERTED transaction too. The bid screen read that
 * as "placed" and handed out a claim secret for a bid that never reached the auction.
 */
import { describe, expect, it } from "vitest";
import { receiptOutcome, shortRevert } from "@/lib/receipt";

describe("receiptOutcome", () => {
  it("reads a success", () => {
    expect(receiptOutcome({ execution_status: "SUCCEEDED" })).toEqual({ kind: "succeeded" });
  });

  it("reads a revert, with its reason, and never as a success", () => {
    expect(receiptOutcome({ execution_status: "REVERTED", revert_reason: "boom" }))
      .toEqual({ kind: "reverted", reason: "boom" });
  });

  it("reads the starknet.js helper shape", () => {
    expect(receiptOutcome({ statusReceipt: "REVERTED", value: { revert_reason: "x" } }))
      .toEqual({ kind: "reverted", reason: "x" });
    expect(receiptOutcome({ statusReceipt: "SUCCEEDED" })).toEqual({ kind: "succeeded" });
  });

  it("says unknown rather than guessing", () => {
    for (const r of [undefined, null, {}, { statusReceipt: "ERROR" }, { execution_status: "?" }]) {
      expect(receiptOutcome(r)).toEqual({ kind: "unknown" });
    }
  });
});

describe("shortRevert", () => {
  it("pulls the last named Cairo error out of a trace", () => {
    const trace = "Transaction execution has failed: 0x1 ('ENTRYPOINT_FAILED') ... "
      + "0x4155435449 ('AUCTION_NOT_OPEN')";
    expect(shortRevert(trace)).toBe("AUCTION_NOT_OPEN");
  });

  it("truncates an unstructured reason", () => {
    expect(shortRevert("x".repeat(500)).length).toBeLessThanOrEqual(161);
  });
});
