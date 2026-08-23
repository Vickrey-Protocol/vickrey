import {
  claimCommitmentOf,
  downAnchor,
  upAnchor,
  witnessAtOrAbove,
  witnessAtOrBelow,
} from "./ladder";
import type { AuctionTerms, PrivateBid, PublicBid, Reveal } from "./types";

/**
 * A uniformly random field element. 31 bytes is always below the STARK prime
 * (2^251 + 17·2^192 + 1), so no rejection sampling and no modular bias.
 *
 * Uses the Web Crypto CSPRNG, present in browsers and in Node 19+. There is no
 * `Math.random` fallback on purpose: a predictable seed is a readable bid.
 */
export function randomFelt(): bigint {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.getRandomValues) {
    throw new Error("no secure random source available; refusing to generate a bid seed");
  }
  const bytes = webcrypto.getRandomValues(new Uint8Array(31));
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc;
}

/**
 * Mints a bid. The claim secret and the seed are generated here and stay here:
 * publishing either before settlement would open the bid.
 */
export function createBid(terms: AuctionTerms, level: number): Omit<PrivateBid, "index"> {
  if (!Number.isInteger(level) || level < 0 || level >= terms.numLevels) {
    throw new Error(`level ${level} is off a ${terms.numLevels}-level ladder`);
  }
  const claimSecret = randomFelt();
  const seed = randomFelt();
  const claimCommitment = claimCommitmentOf(claimSecret);
  return {
    claimSecret,
    seed,
    level,
    claimCommitment,
    upAnchor: upAnchor(terms.auctionId, claimCommitment, seed, level),
    downAnchor: downAnchor(terms.auctionId, claimCommitment, seed, level, terms.numLevels),
  };
}

/**
 * What the bidder hands the auctioneer, and only after the `Sealed` event has been
 * observed on-chain. Sending it earlier would hand over the book before the auctioneer
 * had committed to the bid set, which is the whole point of the seal.
 *
 * Note what is absent: `claimSecret`. The auctioneer has no use for it and it is the
 * only thing that can collect the refund.
 */
export const revealFor = (bid: PrivateBid): Reveal => ({
  index: bid.index,
  seed: bid.seed,
  level: bid.level,
});

/** Checks a reveal against what the chain actually stores for that bid. */
export function revealMatches(terms: AuctionTerms, bid: PublicBid, reveal: Reveal): boolean {
  if (!Number.isInteger(reveal.level) || reveal.level < 0 || reveal.level >= terms.numLevels) {
    return false;
  }
  return (
    upAnchor(terms.auctionId, bid.claimCommitment, reveal.seed, reveal.level) === bid.upAnchor &&
    downAnchor(
      terms.auctionId,
      bid.claimCommitment,
      reveal.seed,
      reveal.level,
      terms.numLevels,
    ) === bid.downAnchor
  );
}

/** The loser-side proof a forfeited bidder serves themselves, late. */
export const redeemWitness = (terms: AuctionTerms, bid: PrivateBid, clearingLevel: number) =>
  witnessAtOrBelow(terms.auctionId, bid.claimCommitment, bid.seed, bid.level, clearingLevel);

/** The proof that voids a settlement which wrongly excluded this bid. */
export const disputeWitness = (terms: AuctionTerms, bid: PrivateBid, clearingLevel: number) =>
  witnessAtOrAbove(
    terms.auctionId,
    bid.claimCommitment,
    bid.seed,
    bid.level,
    clearingLevel + 1,
  );
