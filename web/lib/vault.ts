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

/* ── export state ──────────────────────────────────────────────────────────── */

/**
 * Whether the secrets in this browser have been backed up, and whether that backup is
 * still current.
 *
 * This record lives in the same `localStorage` as the secrets it describes, so clearing
 * site data destroys both at once — and nothing can be done about that. Every other
 * origin-scoped store goes in the same sweep, and the only thing that would survive is a
 * server, which is exactly what this design refuses: a server that knew you held bids
 * could link you to auctions.
 *
 * So it must never read as a safety guarantee. It is a statement about what is in this
 * browser right now, which stays true in every state including immediately after a wipe,
 * when the answer is "nothing" and the empty state says so.
 *
 * It records the *set* exported rather than a flag, because the state that actually
 * costs money is not "never exported" — it is having exported once, bid again, and
 * believed yourself covered. A boolean cannot see that; a set can.
 */
const EXPORT_KEY = "vickrey.bids.exported.v1";

interface ExportRecord {
  /** Epoch millis of the last export. */
  at: number;
  /** `auctionId:index` for each bid in that export. Not secret material. */
  keys: string[];
}

const bidKey = (b: StoredBid) => `${b.auctionId}:${b.index}`;

const readExport = (): ExportRecord | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EXPORT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as ExportRecord;
    return Array.isArray(rec?.keys) && typeof rec?.at === "number" ? rec : null;
  } catch {
    return null;
  }
};

export function markExported() {
  try {
    const rec: ExportRecord = { at: Date.now(), keys: read().map(bidKey) };
    window.localStorage.setItem(EXPORT_KEY, JSON.stringify(rec));
  } catch {
    /* private browsing, quota, blocked site data — the export itself still happened */
  }
}

export interface ExportStatus {
  held: number;
  /** Epoch millis, or null if this browser has never exported. */
  lastExport: number | null;
  /** Bids held that were not in the last export. */
  unbacked: number;
}

export function exportStatus(): ExportStatus {
  const held = read();
  const rec = readExport();
  if (!rec) return { held: held.length, lastExport: null, unbacked: held.length };
  const covered = new Set(rec.keys);
  return {
    held: held.length,
    lastExport: rec.at,
    unbacked: held.filter((b) => !covered.has(bidKey(b))).length,
  };
}
