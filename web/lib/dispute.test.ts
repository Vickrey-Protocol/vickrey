/**
 * `dispute` on the deployed contracts checks only that a bid's up-chain clears the line
 * above the clearing price. It never asks how the bid was settled, so the screen is the
 * only thing deciding who is shown "Void the settlement". These pin that decision.
 */
import { describe, expect, it } from "vitest";
import { Disposition, Status } from "@vickrey/client";
import { canDispute, unreadCandidates } from "@/lib/dispute";

const settled = { status: Status.Settled, clearingLevel: 4, winnerIndex: 0 };
const st = (disposition: Disposition) => ({ disposition });

describe("canDispute", () => {
  it("allows a forfeited bid above the clearing price that is not the winner", () => {
    expect(canDispute(settled, { index: 1, level: 5 }, st(Disposition.Forfeit))).toBe(true);
  });

  it("refuses the winner, whatever the chain recorded for it", () => {
    for (const d of [Disposition.AtOrAbove, Disposition.Exactly, Disposition.Forfeit]) {
      expect(canDispute(settled, { index: 0, level: 9 }, st(d))).toBe(false);
    }
  });

  it("refuses a bid at or below the clearing price, even if forfeited", () => {
    expect(canDispute(settled, { index: 1, level: 4 }, st(Disposition.Forfeit))).toBe(false);
    expect(canDispute(settled, { index: 1, level: 2 }, st(Disposition.Forfeit))).toBe(false);
  });

  it("refuses a bid the settlement accounted for", () => {
    for (const d of [Disposition.AtOrAbove, Disposition.Exactly, Disposition.AtOrBelow,
      Disposition.Unset]) {
      expect(canDispute(settled, { index: 1, level: 5 }, st(d))).toBe(false);
    }
  });

  it("refuses when the disposition is unread or the read failed", () => {
    expect(canDispute(settled, { index: 1, level: 5 }, undefined)).toBe(false);
    expect(canDispute(settled, { index: 1, level: 5 }, null)).toBe(false);
  });

  it("refuses outside Settled", () => {
    for (const status of [Status.Sealed, Status.Finalized, Status.Cancelled]) {
      expect(canDispute({ ...settled, status }, { index: 1, level: 5 },
        st(Disposition.Forfeit))).toBe(false);
    }
  });
});

describe("unreadCandidates", () => {
  it("lists only failed reads of bids that could qualify", () => {
    const bids = [
      { index: 0, level: 9 }, // the winner
      { index: 1, level: 5 }, // candidate, read failed
      { index: 2, level: 3 }, // below the line
      { index: 3, level: 6 }, // candidate, still reading
    ];
    expect(unreadCandidates(settled, bids, { 1: null, 2: null, 3: undefined })).toEqual([1]);
  });
});

describe("a settlement that named no winner", () => {
  it("can be disputed by a forfeited bid at any level", () => {
    const none = { status: Status.Settled, clearingLevel: 15, winnerIndex: 0xffffffff };
    expect(canDispute(none, { index: 1, level: 2 }, st(Disposition.Forfeit))).toBe(true);
  });
});
