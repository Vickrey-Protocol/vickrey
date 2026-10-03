/**
 * The client encrypts reveals and the contract opens them in a dispute. If the two
 * disagree on a tag, a pad or the point arithmetic, a wronged bidder's reveal would not
 * open on chain. These vectors are the output of `snforge test reveal_vectors`, which
 * asserts the same numbers on the Cairo side.
 */
import { describe, expect, it } from "vitest";
import { shortString } from "starknet";
import {
  ephemeralScalar, ephemeralX, newRevealKey, openAsAuctioneer, revealRecord, sealReveal,
  sharedKey,
} from "../src/reveal.ts";
import { ec } from "starknet";

const felt = (s: string) => BigInt(shortString.encodeShortString(s));

const SK = felt("AUCTIONEER_SK");
const SEED = felt("BID_SEED");
const AUCTION_ID = 42n;
const BID_INDEX = 3;
const LEVEL = 9;

const CAIRO = {
  key_x: 2913399886200854871156530811467663855586970529306347680629537328134210865361n,
  key_y: 3481874518163364671774807477719208855389490104879362338110515193573942714714n,
  r: 1096758706370399936340077541185969099233227558469687129007935104948560983167n,
  eph_x: 1730920132285456082242979380521797916492723854716072199299279519883021950147n,
  k: 1234767036340032115673756496322496542623562067134743824257253330510632466289n,
  c_seed: 1913448946204768278282019681581804167590657384628665040943092916084201524734n,
  c_level: 746589006867101285454884351858382899742679408783976786781839442902682449079n,
  record: 2528002370535569320848995011472422013897095279822391146556647628442082289472n,
};
const KEY = { x: CAIRO.key_x, y: CAIRO.key_y };

describe("cross-language conformance with reveal.cairo", () => {
  it("derives the same public key from the auctioneer's secret", () => {
    const p = ec.starkCurve.ProjectivePoint.BASE.multiply(SK).toAffine();
    expect(p.x).toBe(CAIRO.key_x);
    expect(p.y).toBe(CAIRO.key_y);
  });

  it("derives the same ephemeral scalar and point", () => {
    expect(ephemeralScalar(SEED, AUCTION_ID, BID_INDEX)).toBe(CAIRO.r);
    expect(ephemeralX(CAIRO.r)).toBe(CAIRO.eph_x);
  });

  it("agrees on the shared key", () => {
    expect(sharedKey(CAIRO.r, KEY)).toBe(CAIRO.k);
  });

  it("produces the same ciphertext and record", () => {
    const sealed = sealReveal(KEY, AUCTION_ID, BID_INDEX, SEED, LEVEL);
    expect(sealed.ephX).toBe(CAIRO.eph_x);
    expect(sealed.cSeed).toBe(CAIRO.c_seed);
    expect(sealed.cLevel).toBe(CAIRO.c_level);
    expect(revealRecord(sealed)).toBe(CAIRO.record);
  });
});

describe("the auctioneer reads reveals with its key alone", () => {
  it("opens the pinned vector", () => {
    const opened = openAsAuctioneer(SK, AUCTION_ID, BID_INDEX, {
      ephX: CAIRO.eph_x, cSeed: CAIRO.c_seed, cLevel: CAIRO.c_level,
    });
    expect(opened.seed).toBe(SEED);
    expect(opened.level).toBe(BigInt(LEVEL));
  });

  it("round-trips with a fresh key, whichever y the point recovers", () => {
    for (let i = 0; i < 5; i++) {
      const { sk, key } = newRevealKey();
      const sealed = sealReveal(key, 7n, i, 123456789n + BigInt(i), i * 3);
      const opened = openAsAuctioneer(sk, 7n, i, sealed);
      expect(opened.seed).toBe(123456789n + BigInt(i));
      expect(opened.level).toBe(BigInt(i * 3));
    }
  });

  it("a reveal is bound to its bid: another index opens to noise", () => {
    const sealed = sealReveal(KEY, AUCTION_ID, BID_INDEX, SEED, LEVEL);
    const wrong = openAsAuctioneer(SK, AUCTION_ID, BID_INDEX + 1, sealed);
    expect(wrong.seed).not.toBe(SEED);
  });
});
