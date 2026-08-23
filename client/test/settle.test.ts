import { describe, expect, it } from "vitest";
import { createBid, revealFor } from "../src/bid.ts";
import { planSettlement, verifyPlan } from "../src/settle.ts";
import {
  AuctionKind,
  type AuctionTerms,
  NO_WINNER,
  ProofKind,
  type PrivateBid,
  type PublicBid,
  type Reveal,
} from "../src/types.ts";

const terms = (kind: AuctionKind): AuctionTerms => ({
  auctionId: 1n,
  kind,
  reservePrice: 100n,
  tick: 10n,
  numLevels: 16,
});

/** Mints a book of bids at the given levels, as the chain and the bidders would see it. */
function book(t: AuctionTerms, levels: number[]) {
  const bids: PrivateBid[] = levels.map((level, index) => ({
    ...createBid(t, level),
    index,
  }));
  const publics: PublicBid[] = bids.map(
    ({ index, claimCommitment, upAnchor, downAnchor }) => ({
      index,
      claimCommitment,
      upAnchor,
      downAnchor,
    }),
  );
  return { bids, publics, reveals: bids.map(revealFor) };
}

describe("vickrey settlement", () => {
  const t = terms(AuctionKind.Vickrey);

  it("clears at the second-highest level and pins exactly one runner-up", () => {
    const { publics, reveals } = book(t, [12, 9, 4, 7, 0]);
    const plan = planSettlement(t, publics, reveals);

    expect(plan.winnerIndex).toBe(0);
    expect(plan.clearingLevel).toBe(9);
    expect(plan.clearingPrice).toBe(190n);
    expect(plan.proofs[0]!.kind).toBe(ProofKind.AtOrAbove);
    expect(plan.proofs.filter((p) => p.kind === ProofKind.Exactly)).toHaveLength(1);
    expect(verifyPlan(t, publics, plan)).toEqual([]);
  });

  it("breaks a top tie by arrival and still clears at that level", () => {
    const { publics, reveals } = book(t, [8, 8, 3]);
    const plan = planSettlement(t, publics, reveals);

    expect(plan.winnerIndex).toBe(0);
    expect(plan.clearingLevel).toBe(8);
    expect(verifyPlan(t, publics, plan)).toEqual([]);
  });

  it("clears a lone bidder at the reserve", () => {
    const { publics, reveals } = book(t, [11]);
    const plan = planSettlement(t, publics, reveals);

    expect(plan.clearingLevel).toBe(0);
    expect(plan.clearingPrice).toBe(100n);
    expect(verifyPlan(t, publics, plan)).toEqual([]);
  });

  it("forfeits a bidder who never revealed, without stalling", () => {
    const { publics, reveals } = book(t, [12, 9, 3]);
    const partial = reveals.filter((r) => r.index !== 2);
    const plan = planSettlement(t, publics, partial);

    expect(plan.forfeited).toEqual([2]);
    expect(plan.proofs[2]!.kind).toBe(ProofKind.Forfeit);
    expect(plan.clearingLevel).toBe(9);
    expect(verifyPlan(t, publics, plan)).toEqual([]);
  });

  it("forfeits a reveal that does not reconstruct the published anchors", () => {
    const { publics, reveals } = book(t, [12, 9]);
    const lying: Reveal[] = [reveals[0]!, { ...reveals[1]!, level: 11 }];
    const plan = planSettlement(t, publics, lying);

    expect(plan.forfeited).toEqual([1]);
    // With no live runner-up the survivor drops to the reserve, which is exactly the
    // situation the dispute window exists to police.
    expect(plan.clearingLevel).toBe(0);
    expect(verifyPlan(t, publics, plan)).toEqual([]);
  });

  it("declares no winner when nobody revealed", () => {
    const { publics } = book(t, [12, 9]);
    const plan = planSettlement(t, publics, []);

    expect(plan.winnerIndex).toBe(NO_WINNER);
    expect(plan.proofs.every((p) => p.kind === ProofKind.Forfeit)).toBe(true);
    expect(verifyPlan(t, publics, plan)).toEqual([]);
  });
});

describe("first-price settlement", () => {
  const t = terms(AuctionKind.FirstPrice);

  it("clears at the winner's own level and pins it", () => {
    const { publics, reveals } = book(t, [13, 9, 2]);
    const plan = planSettlement(t, publics, reveals);

    expect(plan.winnerIndex).toBe(0);
    expect(plan.clearingLevel).toBe(13);
    expect(plan.clearingPrice).toBe(230n);
    expect(plan.proofs[0]!.kind).toBe(ProofKind.Exactly);
    expect(plan.proofs.slice(1).every((p) => p.kind === ProofKind.AtOrBelow)).toBe(true);
    expect(verifyPlan(t, publics, plan)).toEqual([]);
  });
});

describe("verifyPlan catches what the contract would reject", () => {
  const t = terms(AuctionKind.Vickrey);

  it("rejects a plan that omits a bid", () => {
    const { publics, reveals } = book(t, [12, 9]);
    const plan = planSettlement(t, publics, reveals);
    plan.proofs.pop();
    expect(verifyPlan(t, publics, plan)[0]).toMatch(/proof count/);
  });

  it("rejects a second unpinned bid above the price", () => {
    const { publics, reveals } = book(t, [12, 11, 2]);
    const plan = planSettlement(t, publics, reveals);
    plan.proofs[1] = { ...plan.proofs[1]!, kind: ProofKind.AtOrAbove };
    expect(verifyPlan(t, publics, plan).join(" ")).toMatch(/only the winner/);
  });

  it("rejects a clearing level nobody is pinned at", () => {
    const { publics, reveals } = book(t, [12, 9, 2]);
    const plan = planSettlement(t, publics, reveals);
    const tampered = { ...plan, clearingLevel: 5 };
    expect(verifyPlan(t, publics, tampered).length).toBeGreaterThan(0);
  });
});
