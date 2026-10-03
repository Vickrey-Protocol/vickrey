/**
 * The winner's lot and surplus are released by the same claim secret, and the secret is
 * in calldata. Collected separately, the first claim published the key to the second.
 */
import { describe, expect, it } from "vitest";
import { halfCollected, winnerCollectCalls } from "@/lib/winner";

const base = {
  auctionAddress: "0xa", auctionId: 5n, index: 2, claimSecret: 0x1234n, recipient: "0xbeef",
};

describe("winnerCollectCalls", () => {
  it("collects both halves in one multicall while both remain", () => {
    const calls = winnerCollectCalls({ ...base, lotClaimed: false, refundClaimed: false });
    expect(calls.map((c) => c.entrypoint)).toEqual(["claim_lot", "claim_refund"]);
    expect(calls.every((c) => c.contractAddress === "0xa")).toBe(true);
  });

  it("passes the contract's argument order for each call", () => {
    const [lot, refund] = winnerCollectCalls({ ...base, lotClaimed: false, refundClaimed: false });
    // claim_lot(auction_id, claim_secret, recipient)
    expect((lot!.calldata as string[]).map((x) => BigInt(x))).toEqual([5n, 0x1234n, 0xbeefn]);
    // claim_refund(auction_id, bid_index, claim_secret, recipient)
    expect((refund!.calldata as string[]).map((x) => BigInt(x))).toEqual([5n, 2n, 0x1234n, 0xbeefn]);
  });

  it("builds only the half that is left", () => {
    expect(winnerCollectCalls({ ...base, lotClaimed: true, refundClaimed: false })
      .map((c) => c.entrypoint)).toEqual(["claim_refund"]);
    expect(winnerCollectCalls({ ...base, lotClaimed: false, refundClaimed: true })
      .map((c) => c.entrypoint)).toEqual(["claim_lot"]);
  });

  it("builds nothing once both are collected", () => {
    expect(winnerCollectCalls({ ...base, lotClaimed: true, refundClaimed: true })).toEqual([]);
  });
});

describe("halfCollected", () => {
  it("is true exactly when one half is gone and the other is not", () => {
    expect(halfCollected(true, false)).toBe(true);
    expect(halfCollected(false, true)).toBe(true);
    expect(halfCollected(false, false)).toBe(false);
    expect(halfCollected(true, true)).toBe(false);
  });
});
