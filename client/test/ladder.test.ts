import { describe, expect, it } from "vitest";
import {
  claimCommitmentOf,
  downAnchor,
  upAnchor,
  upSeed,
  verifyAtOrAbove,
  verifyAtOrBelow,
  witnessAtOrAbove,
  witnessAtOrBelow,
} from "../src/ladder.ts";

const AID = 7n;
const LEVELS = 16;
const C = claimCommitmentOf(123n);
const SEED = 456n;
const LEVEL = 9;

describe("thermometer proofs", () => {
  const up = upAnchor(AID, C, SEED, LEVEL);
  const down = downAnchor(AID, C, SEED, LEVEL, LEVELS);

  it("proves every bound at or below the committed level", () => {
    for (let t = 0; t <= LEVEL; t++) {
      expect(verifyAtOrAbove(AID, C, up, t, witnessAtOrAbove(AID, C, SEED, LEVEL, t))).toBe(true);
    }
  });

  it("proves every bound at or above the committed level", () => {
    for (let t = LEVEL; t < LEVELS; t++) {
      expect(
        verifyAtOrBelow(AID, C, down, LEVELS, t, witnessAtOrBelow(AID, C, SEED, LEVEL, t)),
      ).toBe(true);
    }
  });

  it("refuses to build a witness for a bound the bid does not meet", () => {
    expect(() => witnessAtOrAbove(AID, C, SEED, LEVEL, LEVEL + 1)).toThrow(/cannot prove/);
    expect(() => witnessAtOrBelow(AID, C, SEED, LEVEL, LEVEL - 1)).toThrow(/cannot prove/);
  });

  it("cannot be forged above the committed level", () => {
    for (let t = LEVEL + 1; t < LEVELS; t++) {
      expect(verifyAtOrAbove(AID, C, up, t, upSeed(SEED))).toBe(false);
      expect(verifyAtOrAbove(AID, C, up, t, up)).toBe(false);
    }
  });

  it("does not carry across auctions or bids", () => {
    const w = witnessAtOrAbove(AID, C, SEED, LEVEL, 5);
    expect(verifyAtOrAbove(AID, C, up, 5, w)).toBe(true);
    expect(verifyAtOrAbove(AID + 1n, C, up, 5, w)).toBe(false);
    expect(verifyAtOrAbove(AID, claimCommitmentOf(999n), up, 5, w)).toBe(false);
  });
});
