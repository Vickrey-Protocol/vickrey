/**
 * Client-side mirror of `packages/auction/src/reveal.cairo`: the reveal a bidder posts
 * on chain after the seal, encrypted to the auctioneer's per-auction key.
 *
 * ```text
 *   r        = H(EPH_TAG, seed, auction_id, bid_index) mod n
 *   eph_x    = (r·G).x
 *   k        = (r·PK).x            == (sk·R).x for either R = ±(r·G)
 *   c_seed   = seed  + H(PAD_TAG, k, auction_id, bid_index, 0)   (mod p)
 *   c_level  = level + H(PAD_TAG, k, auction_id, bid_index, 1)   (mod p)
 * ```
 *
 * `r` is derived from the seed, so a bidder keeps no extra secret: whoever has the seed
 * can open their own reveal in a dispute. Every function here must agree with Cairo bit
 * for bit; `test/reveal.test.ts` pins them against vectors from `snforge test
 * reveal_vectors`.
 */
import { ec, hash, shortString } from "starknet";
import { randomFelt } from "./bid.ts";

const curve = ec.starkCurve;
const Point = curve.ProjectivePoint;
/** The STARK field prime. Ciphertexts are field elements. */
export const FIELD_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;
/** The STARK curve's group order. */
export const CURVE_ORDER: bigint = curve.CURVE.n;
const BETA = 0x6f21413efbe40de150e596d72f7a8c5609ad26c15c915c1f4cdfcb99cee9e89n;

const poseidon = (xs: bigint[]): bigint =>
  BigInt(hash.computePoseidonHashOnElements(xs.map((x) => "0x" + x.toString(16))));
const tag = (s: string): bigint => BigInt(shortString.encodeShortString(s));
const mod = (x: bigint, m: bigint) => ((x % m) + m) % m;

export const EPH_TAG = tag("VICKREY_REVEAL_EPH:V1");
export const PAD_TAG = tag("VICKREY_REVEAL_PAD:V1");
export const RECORD_TAG = tag("VICKREY_REVEAL:V1");

export interface RevealKey {
  x: bigint;
  y: bigint;
}

/** What goes on chain: `post_reveal(auction_id, bid_index, ephX, cSeed, cLevel)`. */
export interface SealedReveal {
  ephX: bigint;
  cSeed: bigint;
  cLevel: bigint;
}

/**
 * A fresh auctioneer key for one auction. The secret half stays in the auctioneer's
 * console and should be deleted once the auction is final; the public half goes into
 * `AuctionExtras` at listing.
 */
export function newRevealKey(): { sk: bigint; key: RevealKey } {
  let sk = 0n;
  while (sk === 0n) sk = mod(randomFelt(), CURVE_ORDER);
  const p = Point.BASE.multiply(sk).toAffine();
  return { sk, key: { x: p.x, y: p.y } };
}

export function ephemeralScalar(seed: bigint, auctionId: bigint, bidIndex: number): bigint {
  const r = poseidon([EPH_TAG, seed, auctionId, BigInt(bidIndex)]) % CURVE_ORDER;
  return r === 0n ? 1n : r;
}

export const ephemeralX = (r: bigint): bigint => Point.BASE.multiply(r).toAffine().x;

export const sharedKey = (r: bigint, key: RevealKey): bigint =>
  Point.fromAffine({ x: key.x, y: key.y }).multiply(mod(r, CURVE_ORDER)).toAffine().x;

export const pad = (k: bigint, auctionId: bigint, bidIndex: number, i: bigint): bigint =>
  poseidon([PAD_TAG, k, auctionId, BigInt(bidIndex), i]);

/** What the contract stores per posted reveal. */
export const revealRecord = (r: SealedReveal): bigint =>
  poseidon([RECORD_TAG, r.ephX, r.cSeed, r.cLevel]);

/** Encrypts one bid's `(seed, level)` to the auctioneer's key. */
export function sealReveal(
  key: RevealKey, auctionId: bigint, bidIndex: number, seed: bigint, level: number,
): SealedReveal {
  const r = ephemeralScalar(seed, auctionId, bidIndex);
  const k = sharedKey(r, key);
  return {
    ephX: ephemeralX(r),
    cSeed: mod(seed + pad(k, auctionId, bidIndex, 0n), FIELD_PRIME),
    cLevel: mod(BigInt(level) + pad(k, auctionId, bidIndex, 1n), FIELD_PRIME),
  };
}

/** The point on the curve with this x-coordinate; either one, since only `x` is used. */
function pointFromX(x: bigint) {
  const rhs = mod(x * x * x + x + BETA, FIELD_PRIME);
  const y = curve.CURVE.Fp.sqrt(rhs);
  return Point.fromAffine({ x, y });
}

/** The auctioneer reads a posted reveal with its secret key alone. */
export function openAsAuctioneer(
  sk: bigint, auctionId: bigint, bidIndex: number, sealed: SealedReveal,
): { seed: bigint; level: bigint } {
  const k = pointFromX(sealed.ephX).multiply(sk).toAffine().x;
  return {
    seed: mod(sealed.cSeed - pad(k, auctionId, bidIndex, 0n), FIELD_PRIME),
    level: mod(sealed.cLevel - pad(k, auctionId, bidIndex, 1n), FIELD_PRIME),
  };
}

/** The dispute's arguments: `dispute(auction_id, bid_index, r, cSeed, cLevel)`. */
export const disputeArgs = (seed: bigint, auctionId: bigint, bidIndex: number, sealed: SealedReveal) => ({
  r: ephemeralScalar(seed, auctionId, bidIndex),
  cSeed: sealed.cSeed,
  cLevel: sealed.cLevel,
});
