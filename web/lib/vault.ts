"use client";

import type { PrivateBid } from "@vickrey/client";

/**
 * Where a bidder's secrets live: this browser, and nowhere else.
 *
 * Losing this store means losing the ability to claim a refund or the lot. There is
 * deliberately no server copy and no recovery path — a server that could recover your
 * bid could also read it.
 */
const KEY = "vickrey.bids.v1";

export interface StoredBid {
  auctionId: string;
  index: number;
  level: number;
  claimSecret: string;
  seed: string;
  claimCommitment: string;
  upAnchor: string;
  downAnchor: string;
  txHash?: string;
  revealedAt?: number;
}

const read = (): StoredBid[] => {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as StoredBid[];
  } catch {
    return [];
  }
};

const write = (bids: StoredBid[]) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(bids));
  } catch {
    /* private browsing, quota, blocked site data — the caller warns the user */
  }
};

export const allBids = read;

export const bidsFor = (auctionId: bigint): StoredBid[] =>
  read().filter((b) => b.auctionId === auctionId.toString());

export function saveBid(auctionId: bigint, bid: Omit<PrivateBid, "index">, index: number, txHash?: string) {
  const entry: StoredBid = {
    auctionId: auctionId.toString(),
    index,
    level: bid.level,
    claimSecret: bid.claimSecret.toString(),
    seed: bid.seed.toString(),
    claimCommitment: bid.claimCommitment.toString(),
    upAnchor: bid.upAnchor.toString(),
    downAnchor: bid.downAnchor.toString(),
    txHash,
  };
  write([...read().filter((b) => !(b.auctionId === entry.auctionId && b.index === index)), entry]);
  return entry;
}

export function markRevealed(auctionId: bigint, index: number) {
  write(
    read().map((b) =>
      b.auctionId === auctionId.toString() && b.index === index
        ? { ...b, revealedAt: Date.now() }
        : b,
    ),
  );
}

export const toPrivateBid = (s: StoredBid): PrivateBid => ({
  index: s.index,
  level: s.level,
  claimSecret: BigInt(s.claimSecret),
  seed: BigInt(s.seed),
  claimCommitment: BigInt(s.claimCommitment),
  upAnchor: BigInt(s.upAnchor),
  downAnchor: BigInt(s.downAnchor),
});

/** A backup a bidder can paste somewhere safe. Treat it like a private key. */
export const exportBids = () => JSON.stringify(read(), null, 2);

export function importBids(json: string) {
  const parsed = JSON.parse(json) as StoredBid[];
  if (!Array.isArray(parsed)) throw new Error("expected a list of stored bids");
  write(parsed);
}
