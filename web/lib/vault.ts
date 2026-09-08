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
export const VAULT_KEY = KEY;
/** The BroadcastChannel tabs use to say "I removed this bid, and I had proof". */
export const VAULT_CHANNEL = "vickrey.vault.v1";

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

/**
 * Writes the store and proves it landed. `false` means the secret is not on this device.
 *
 * `setItem` is not a reliable signal of storage. It throws on quota in some browsers and
 * returns silently in others; a partitioned store, a site-data block or an extension can
 * accept the call and keep nothing. This swallowed every one of those and told the caller
 * nothing, which is how six mainnet claim secrets were reported saved and were not.
 *
 * A one-byte probe does not detect it either — a store near its quota accepts a token and
 * refuses five hundred bytes. So the actual payload is written and read back, and the
 * caller is told the truth about the write it just asked for.
 */
/**
 * A stored bid's identity is its commitment, not its index. The index is a guess that the
 * chain corrects; the commitment is a hash of the secret and never changes. Every rule
 * about "the same bid" below uses this, so a reindex is an edit and not a delete.
 */
export const identityOf = (b: StoredBid) => `${b.auctionId}:${b.claimCommitment}`;

export interface WriteOpts {
  /**
   * Identities this write is permitted to remove. Each must be backed by a positive
   * on-chain answer — a search that covered the bid's index and found no such commitment.
   * Anything else that would vanish is put back.
   */
  remove?: string[];
}

/**
 * The only way anything reaches the store. It enforces one invariant on every caller,
 * present or future: **a write may not shrink the set without proof.**
 *
 * Six mainnet claim secrets were deleted by a reconciler that believed a "not found" it
 * had no right to believe. Fixing that reconciler was necessary and not sufficient — a tab
 * still running the old bundle kept deleting on its 20-second poll for hours after the fix
 * shipped, because the store trusted whatever it was handed. So the store no longer does.
 * Any entry that a write would drop, and that the caller has not named in `remove` with a
 * reason, is restored into the write. A caller that wants to delete has to say so, and
 * has to have earned it.
 */
export const writeStore = (bids: StoredBid[], opts: WriteOpts = {}): boolean => {
  if (typeof window === "undefined") return false;
  const before = read();
  const kept = new Set(bids.map(identityOf));
  const allowed = new Set(opts.remove ?? []);
  const restored = before.filter((b) => !kept.has(identityOf(b)) && !allowed.has(identityOf(b)));
  if (restored.length) {
    console.warn(`vault: a write tried to drop ${restored.length} bid(s) without proof; kept them`);
  }
  const payload = JSON.stringify(restored.length ? [...bids, ...restored] : bids);
  try {
    window.localStorage.setItem(KEY, payload);
    return window.localStorage.getItem(KEY) === payload;
  } catch {
    return false;
  }
};
const write = writeStore;

/**
 * The store would not keep a claim secret. Thrown before anything is signed, so it always
 * means no funds moved — the message says so, because a bidder who reads "failed" after
 * approving a wallet dialog will otherwise assume the opposite.
 */
export class VaultWriteError extends Error {
  constructor() {
    super(
      "This browser would not store your claim secret, so the bid was not sent — "
      + "nothing was signed and no funds moved. Private browsing, a full store, or "
      + "blocked site data will do this. Allow site data in a normal window and try "
      + "again.",
    );
    this.name = "VaultWriteError";
  }
}

/**
 * Whether this browser will actually keep a claim secret — asked before the bidder fills
 * anything in, so the answer arrives as a disabled button with a reason rather than a
 * failure after they have chosen a level.
 *
 * Probes with a payload the size of the real write, for the reason in `write` above.
 */
export function vaultWritable(): boolean {
  if (typeof window === "undefined") return true; // SSR: do not warn before we can know
  const probeKey = `${KEY}.probe`;
  const filler = "0".repeat(76); // a felt as decimal, near enough
  const payload = JSON.stringify([...read(), {
    auctionId: filler, index: 0, level: 0, claimSecret: filler, seed: filler,
    claimCommitment: filler, upAnchor: filler, downAnchor: filler,
  }]);
  try {
    window.localStorage.setItem(probeKey, payload);
    const ok = window.localStorage.getItem(probeKey) === payload;
    window.localStorage.removeItem(probeKey);
    return ok;
  } catch {
    return false;
  }
}

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
  /* Throws rather than returning, so a caller cannot proceed to a wallet on a secret
     that is not stored. The bid path calls this *before* the send precisely so this
     failure costs nothing but the attempt. */
  /* Replaces only the *same* bid (same commitment). An earlier attempt at the same index
     with a different commitment is a different bid, and it may have landed — it stays,
     and the reconciler sorts the indices out against the chain. */
  const same = (b: StoredBid) => identityOf(b) === identityOf(entry);
  if (!write([...read().filter((b) => !same(b)), entry])) {
    throw new VaultWriteError();
  }
  return entry;
}

/**
 * Removes a stored bid. Used only when the transaction that would have created it is
 * known not to have landed.
 *
 * The write happens *before* the send, deliberately: a transaction that lands while the
 * secret does not is an escrow nobody can release. Nothing undid it when the send failed,
 * so a reverted bid left an entry for an index the chain never assigned — a claim row
 * against a bid that does not exist.
 *
 * Rule 11 governs when this may be called. Dropping is safe only if we know the
 * transaction did not reach the chain, which in practice means the wallet threw *before*
 * returning a hash. Once a hash exists the transaction may still land, and a vault entry
 * removed on a guess is a secret destroyed.
 */
export function dropBid(auctionId: bigint, index: number) {
  const victims = read().filter((b) => b.auctionId === auctionId.toString() && b.index === index);
  if (!victims.length) return;
  const ids = victims.map(identityOf);
  /* Announced before it is written, so a tab that sees the shrink can tell a proven
     removal from a stale tab's wipe — and only undoes the latter. */
  announceRemoval(ids);
  write(read().filter((b) => !ids.includes(identityOf(b))), { remove: ids });
}

/**
 * Puts bids back that another tab removed without announcing proof. Never shrinks, so
 * the guard has nothing to object to.
 */
export function restoreEntries(lost: StoredBid[]) {
  const have = new Set(read().map(identityOf));
  const missing = lost.filter((b) => !have.has(identityOf(b)));
  if (missing.length) write([...read(), ...missing]);
  return missing.length;
}

let channel: BroadcastChannel | null | undefined;
const vaultChannel = () => {
  if (channel !== undefined) return channel;
  try { channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(VAULT_CHANNEL); }
  catch { channel = null; }
  /* Node's BroadcastChannel holds the event loop open; browsers have no unref. */
  (channel as unknown as { unref?: () => void } | null)?.unref?.();
  return channel;
};
export function announceRemoval(ids: string[]) {
  vaultChannel()?.postMessage({ type: "removed", ids, at: Date.now() });
}

/** Runs `cb` whenever another tab changes the vault. Returns the unsubscribe. */
export function onVaultChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener("storage", h);
  return () => window.removeEventListener("storage", h);
}

/**
 * Corrects a stored bid's index to the one the chain actually assigned.
 *
 * The index was taken from `bidCount` on a polled view, which is a guess: anyone bidding
 * between the poll and the send shifts it. `place_bid` returns the real index and
 * `BidPlaced` carries it as a key, so the authoritative answer is available and was
 * simply never read.
 */
export function reindexBid(auctionId: bigint, from: number, to: number) {
  if (from === to) return;
  write(read().map((b) =>
    b.auctionId === auctionId.toString() && b.index === from ? { ...b, index: to } : b));
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

/**
 * One bid as an importable backup — the same shape `importBids` accepts, so a file saved
 * from the bid panel restores through the ordinary import.
 *
 * The claim secret alone is half a backup. `claim_lot` and `redeem_forfeit` take only the
 * secret, but `reveal` takes the seed and the level, and a bid that cannot reveal cannot
 * win the lot — it can only be forfeited. So a panel that says "save this or lose it" has
 * to hand over the whole entry, not the one field that fits on a line.
 */
export const backupOf = (bid: StoredBid) => JSON.stringify([bid], null, 2);

/**
 * Restores bids from a backup, *merging* rather than replacing.
 *
 * This used to write the parsed array wholesale, which made importing a single-bid backup
 * — exactly what the bid panel now hands out — silently destroy every other secret in the
 * browser. Restoring one bid must never be a way to lose three.
 *
 * Merge is by identity (commitment), with the imported copy winning: a backup is the record
 * the bidder deliberately kept, and the entry it collides with is the same bid. The cost
 * is that an import can never remove a stale entry, which is cosmetic. Losing a seed is
 * not — the same trade the bid path makes.
 */
export function importBids(json: string) {
  const parsed = JSON.parse(json) as StoredBid[];
  if (!Array.isArray(parsed)) throw new Error("expected a list of stored bids");
  const merged = new Map(read().map((b) => [identityOf(b), b] as const));
  for (const b of parsed) merged.set(identityOf(b), b);
  if (!write([...merged.values()])) throw new VaultWriteError();
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
