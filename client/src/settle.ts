/**
 * The auctioneer's side: turn revealed seeds into the N+1 witnesses the contract
 * checks. Runs after the `Sealed` event and nowhere else.
 *
 * `verifyPlan` re-runs the contract's own acceptance rules locally, so a bad plan is
 * caught before it costs a transaction.
 */
import { revealMatches } from "./bid";
import {
  verifyAtOrAbove,
  verifyAtOrBelow,
  witnessAtOrAbove,
  witnessAtOrBelow,
} from "./ladder";
import {
  AuctionKind,
  type AuctionTerms,
  type DispositionProof,
  NO_WINNER,
  ProofKind,
  type PublicBid,
  type Reveal,
  type SettlementPlan,
  priceOfLevel,
} from "./types";

const forfeit = (): DispositionProof => ({
  kind: ProofKind.Forfeit,
  witnessUp: 0n,
  witnessDown: 0n,
});

/**
 * Ranks the bid set and builds the settlement.
 *
 * A bid with no reveal, or a reveal that does not reconstruct its published anchors,
 * is forfeited rather than guessed at. Settlement always completes.
 */
export function planSettlement(
  terms: AuctionTerms,
  bids: PublicBid[],
  reveals: Reveal[],
): SettlementPlan {
  const byIndex = new Map(reveals.map((r) => [r.index, r]));
  const valid: Array<{ bid: PublicBid; reveal: Reveal }> = [];
  const forfeited: number[] = [];

  for (const bid of bids) {
    const reveal = byIndex.get(bid.index);
    if (reveal && revealMatches(terms, bid, reveal)) valid.push({ bid, reveal });
    else forfeited.push(bid.index);
  }

  if (valid.length === 0) {
    return {
      clearingLevel: 0,
      clearingPrice: priceOfLevel(terms, 0),
      winnerIndex: NO_WINNER,
      proofs: bids.map(forfeit),
      forfeited,
    };
  }

  // Highest level wins; earliest arrival breaks a tie.
  const ranked = [...valid].sort(
    (a, b) => b.reveal.level - a.reveal.level || a.bid.index - b.bid.index,
  );
  const winner = ranked[0]!;
  const runnerUp = ranked[1];

  const clearingLevel =
    terms.kind === AuctionKind.FirstPrice
      ? winner.reveal.level
      : // Vickrey pays the second price. A lone survivor clears at the reserve.
        (runnerUp?.reveal.level ?? 0);

  const proofs: DispositionProof[] = [];
  let runnerUpPinned = false;

  for (const bid of bids) {
    const entry = valid.find((v) => v.bid.index === bid.index);
    if (!entry) {
      proofs.push(forfeit());
      continue;
    }
    const { seed, level } = entry.reveal;
    const c = bid.claimCommitment;
    const isWinner = bid.index === winner.bid.index;

    if (terms.kind === AuctionKind.FirstPrice) {
      // The winner pays their own bid, so that bid must be pinned exactly.
      proofs.push(
        isWinner
          ? {
              kind: ProofKind.Exactly,
              witnessUp: witnessAtOrAbove(terms.auctionId, c, seed, level, clearingLevel),
              witnessDown: witnessAtOrBelow(terms.auctionId, c, seed, level, clearingLevel),
            }
          : {
              kind: ProofKind.AtOrBelow,
              witnessUp: 0n,
              witnessDown: witnessAtOrBelow(terms.auctionId, c, seed, level, clearingLevel),
            },
      );
      continue;
    }

    if (isWinner) {
      proofs.push({
        kind: ProofKind.AtOrAbove,
        witnessUp: witnessAtOrAbove(terms.auctionId, c, seed, level, clearingLevel),
        witnessDown: 0n,
      });
    } else if (!runnerUpPinned && level === clearingLevel) {
      // Exactly one non-winner must be pinned at the clearing level: that pinning is
      // what makes the second price a proved fact rather than the auctioneer's word.
      runnerUpPinned = true;
      proofs.push({
        kind: ProofKind.Exactly,
        witnessUp: witnessAtOrAbove(terms.auctionId, c, seed, level, clearingLevel),
        witnessDown: witnessAtOrBelow(terms.auctionId, c, seed, level, clearingLevel),
      });
    } else {
      proofs.push({
        kind: ProofKind.AtOrBelow,
        witnessUp: 0n,
        witnessDown: witnessAtOrBelow(terms.auctionId, c, seed, level, clearingLevel),
      });
    }
  }

  return {
    clearingLevel,
    clearingPrice: priceOfLevel(terms, clearingLevel),
    winnerIndex: winner.bid.index,
    proofs,
    forfeited,
  };
}

/** Every reason the contract would reject a plan, checked locally first. */
export function verifyPlan(
  terms: AuctionTerms,
  bids: PublicBid[],
  plan: SettlementPlan,
): string[] {
  const problems: string[] = [];
  const { clearingLevel, winnerIndex, proofs } = plan;

  if (proofs.length !== bids.length) {
    problems.push(`proof count ${proofs.length} != bid count ${bids.length}`);
    return problems;
  }
  if (clearingLevel < 0 || clearingLevel >= terms.numLevels) {
    problems.push(`clearing level ${clearingLevel} is off the ladder`);
    return problems;
  }

  let forfeited = 0;
  let runnerUpPinned = false;
  let winnerKind: ProofKind | undefined;

  bids.forEach((bid, i) => {
    const p = proofs[i]!;
    const isWinner = bid.index === winnerIndex;
    const c = bid.claimCommitment;

    switch (p.kind) {
      case ProofKind.AtOrAbove:
        if (!isWinner) problems.push(`bid ${bid.index}: only the winner may be unpinned above`);
        if (!verifyAtOrAbove(terms.auctionId, c, bid.upAnchor, clearingLevel, p.witnessUp)) {
          problems.push(`bid ${bid.index}: at-or-above witness fails`);
        }
        break;
      case ProofKind.Exactly:
        if (!verifyAtOrAbove(terms.auctionId, c, bid.upAnchor, clearingLevel, p.witnessUp)) {
          problems.push(`bid ${bid.index}: exact witness fails upward`);
        }
        if (
          !verifyAtOrBelow(
            terms.auctionId,
            c,
            bid.downAnchor,
            terms.numLevels,
            clearingLevel,
            p.witnessDown,
          )
        ) {
          problems.push(`bid ${bid.index}: exact witness fails downward`);
        }
        if (!isWinner) runnerUpPinned = true;
        break;
      case ProofKind.AtOrBelow:
        if (
          !verifyAtOrBelow(
            terms.auctionId,
            c,
            bid.downAnchor,
            terms.numLevels,
            clearingLevel,
            p.witnessDown,
          )
        ) {
          problems.push(`bid ${bid.index}: at-or-below witness fails`);
        }
        break;
      case ProofKind.Forfeit:
        if (isWinner) problems.push("the winner cannot be forfeited");
        forfeited += 1;
        break;
    }
    if (isWinner) winnerKind = p.kind;
  });

  if (winnerIndex === NO_WINNER) {
    if (forfeited !== bids.length) problems.push("no winner requires every bid to forfeit");
  } else if (terms.kind === AuctionKind.FirstPrice) {
    if (winnerKind !== ProofKind.Exactly) problems.push("first-price winner must be pinned");
  } else if (!runnerUpPinned) {
    if (forfeited + 1 !== bids.length) problems.push("vickrey needs a pinned runner-up");
    else if (clearingLevel !== 0) problems.push("a lone surviving bid clears at the reserve");
  }

  return problems;
}
