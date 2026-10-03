/**
 * The auctioneer's per-auction reveal keys.
 *
 * Bidders encrypt their reveals to a key made in the auctioneer's browser at listing.
 * The secret half is kept here, keyed by the public key's x-coordinate (which the
 * contract stores in `AuctionExtras`), so the console finds it for an auction without
 * needing the auction id at creation time. It is also downloaded as a file: this
 * storage is a convenience, and a cleared browser must not cost the auctioneer the
 * ability to settle.
 *
 * Deleted once the auction is final. Anyone who ever holds it can read that auction's
 * bids.
 */
import { newRevealKey, type RevealKey } from "@vickrey/client";
import { ec } from "starknet";

const KEY = "vickrey.revealkeys.v1";

export interface StoredRevealKey {
  /** Hex. */
  publicX: string;
  publicY: string;
  secret: string;
  createdAt: number;
  /** The auction contract it was made for. */
  contract: string;
}

const read = (): StoredRevealKey[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as StoredRevealKey[]; }
  catch { return []; }
};
const write = (keys: StoredRevealKey[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(keys)); return true; } catch { return false; }
};

export function makeRevealKey(contract: string): StoredRevealKey {
  const { sk, key } = newRevealKey();
  return {
    publicX: "0x" + key.x.toString(16),
    publicY: "0x" + key.y.toString(16),
    secret: "0x" + sk.toString(16),
    createdAt: Date.now(),
    contract,
  };
}

export const publicKeyOf = (k: StoredRevealKey): RevealKey =>
  ({ x: BigInt(k.publicX), y: BigInt(k.publicY) });

/** Saves locally. Returns false when this browser will not keep it. */
export function keepRevealKey(k: StoredRevealKey): boolean {
  const rest = read().filter((x) => BigInt(x.publicX) !== BigInt(k.publicX));
  return write([...rest, k]);
}

export function findRevealKey(publicX: bigint): StoredRevealKey | null {
  return read().find((k) => BigInt(k.publicX) === publicX) ?? null;
}

export function forgetRevealKey(publicX: bigint) {
  write(read().filter((k) => BigInt(k.publicX) !== publicX));
}

export const revealKeyFile = (k: StoredRevealKey) => JSON.stringify(
  { kind: "vickrey-reveal-key", ...k }, null, 2);

/**
 * Reads a downloaded key file back. Refuses one whose secret does not produce its
 * public key, so a mistyped or mismatched file fails here rather than at settlement.
 */
export function parseRevealKeyFile(text: string): StoredRevealKey {
  const o = JSON.parse(text) as Partial<StoredRevealKey> & { kind?: string };
  if (!o.secret || !o.publicX || !o.publicY) throw new Error("not a Vickrey reveal key file");
  const p = ec.starkCurve.ProjectivePoint.BASE.multiply(BigInt(o.secret)).toAffine();
  if (p.x !== BigInt(o.publicX)) throw new Error("the secret in this file does not match its public key");
  return {
    publicX: o.publicX, publicY: o.publicY, secret: o.secret,
    createdAt: o.createdAt ?? Date.now(), contract: o.contract ?? "",
  };
}
