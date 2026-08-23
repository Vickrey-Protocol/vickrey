/** Mirrors `auction::types`. Variant indices are the on-wire encoding — see
 *  `packages/anonymizer/tests/test_layout.cairo`. */

export enum AuctionKind {
  FirstPrice = 0,
  Vickrey = 1,
}

export enum ProofKind {
  AtOrAbove = 0,
  Exactly = 1,
  AtOrBelow = 2,
  Forfeit = 3,
}

export enum Disposition {
  Unset = 0,
  AtOrAbove = 1,
  Exactly = 2,
  AtOrBelow = 3,
  Forfeit = 4,
}

export enum Status {
  None = 0,
  Open = 1,
  Sealed = 2,
  Settled = 3,
  Finalized = 4,
  Cancelled = 5,
}

export enum AuctionOperation {
  PlaceBid = 0,
  ClaimRefund = 1,
  RedeemForfeit = 2,
  ClaimLot = 3,
}

/** Sentinel matching `auction::types::NO_WINNER`. */
export const NO_WINNER = 0xffffffff;

export interface AuctionTerms {
  auctionId: bigint;
  kind: AuctionKind;
  reservePrice: bigint;
  tick: bigint;
  numLevels: number;
}

/** A bid as the chain sees it. Two hashes and a handle. */
export interface PublicBid {
  index: number;
  claimCommitment: bigint;
  upAnchor: bigint;
  downAnchor: bigint;
}

/**
 * A bid as its owner sees it. **`claimSecret` never leaves the device** — it is the
 * only thing that can collect the refund, and the auctioneer has no use for it.
 */
export interface PrivateBid extends PublicBid {
  claimSecret: bigint;
  seed: bigint;
  level: number;
}

/**
 * What a bidder sends the auctioneer, and only after observing the `Sealed` event.
 * Deliberately excludes `claimSecret`.
 */
export interface Reveal {
  index: number;
  seed: bigint;
  level: number;
}

export interface DispositionProof {
  kind: ProofKind;
  witnessUp: bigint;
  witnessDown: bigint;
}

export interface SettlementPlan {
  clearingLevel: number;
  clearingPrice: bigint;
  winnerIndex: number;
  proofs: DispositionProof[];
  /** Indices the auctioneer could not disposition. They keep their escrow, redeemable. */
  forfeited: number[];
}

export const priceOfLevel = (terms: AuctionTerms, level: number): bigint =>
  terms.reservePrice + terms.tick * BigInt(level);

/** What every bidder escrows, identical for all of them, so it leaks nothing. */
export const collateralOf = (terms: AuctionTerms): bigint =>
  priceOfLevel(terms, terms.numLevels - 1);

/**
 * Dispute-window presets, mirroring `ladder.cairo`.
 *
 * The contract enforces no minimum on purpose: any floor short enough for a live demo
 * would be far too short for real value. The window is fixed at listing and public, so
 * a bidder can read it and decline to bid.
 */
export const DISPUTE_WINDOW = {
  /** 3 minutes. Nominal amounts, bidders in the room, demo only. */
  demo: 180,
  /** 1 hour. A staffed auction where participants are actively watching. */
  supervised: 3600,
  /** 24 hours. What real value deserves; assumes nobody was watching. */
  suggested: 86400,
} as const;

/** Plain-language read on a proposed window, for the listing UI to show. */
export function disputeWindowAdvice(seconds: number): {
  level: "demo" | "short" | "reasonable";
  note: string;
} {
  if (seconds <= DISPUTE_WINDOW.demo) {
    return {
      level: "demo",
      note: "Demo length. A wrongly excluded bidder has minutes to notice and react — only safe with nominal amounts and bidders who are watching.",
    };
  }
  if (seconds < DISPUTE_WINDOW.suggested) {
    return {
      level: "short",
      note: "Shorter than the 24 hours real value deserves. Fine for a supervised auction; state it plainly to bidders.",
    };
  }
  return {
    level: "reasonable",
    note: "Long enough that a bidder who was not watching can still notice a wrong settlement and overturn it.",
  };
}
