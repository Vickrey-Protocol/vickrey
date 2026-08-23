/**
 * The client and the contract must hash identically or every bid is unprovable.
 *
 * These vectors are not hand-written. They are the output of
 * `snforge test --package auction test_vectors`, pasted verbatim. Regenerate them
 * whenever a domain tag or field order changes in `ladder.cairo`.
 */
import { describe, expect, it } from "vitest";
import {
  claimCommitmentOf,
  downAnchor,
  downSeed,
  extendBidRoot,
  step,
  upAnchor,
  upSeed,
  witnessAtOrAbove,
  witnessAtOrBelow,
} from "../src/ladder";
import { shortString } from "starknet";

const felt = (s: string) => BigInt(shortString.encodeShortString(s));

const SECRET = felt("CLAIM_SECRET");
const SEED = felt("BID_SEED");
const AUCTION_ID = 42n;
const LEVEL = 9;
const LEVELS = 16;
const C = claimCommitmentOf(SECRET);

/** Straight from the Cairo test output. */
const CAIRO = {
  claim_commitment:
    1215784312807005438584065996713629345174920229111947049557783577098320429161n,
  up_seed: 1973019453160390212481817963646460177035205748943083313744601595233115597561n,
  down_seed: 2159154752363545411354332183911435398029224556435155046563557793459100800831n,
  step1: 3487261345273425616810074606452810850058029823449173154804894174273787324601n,
  up_anchor: 2666262007772051879446945831965501491541621972364344928919623854414349545403n,
  down_anchor: 1416886781356936095728922313368674211076682493056709747408235582261935288309n,
  w_above_5: 2243792132802313985798730152210022257874719799709561760790863325215380346598n,
  w_below_12: 1381516152639189036454422755043967292420213272802936990904468377993789931334n,
  bid_root1: 3479204807544668681430605108378447106929626673558963790219523915402188417127n,
  bid_root2: 2115383453641419745825221800461818385864092301747661930390006188897544144608n,
};

describe("cross-language conformance with ladder.cairo", () => {
  it("derives the same claim commitment", () => {
    expect(C).toBe(CAIRO.claim_commitment);
  });

  it("derives the same chain seeds", () => {
    expect(upSeed(SEED)).toBe(CAIRO.up_seed);
    expect(downSeed(SEED)).toBe(CAIRO.down_seed);
  });

  it("takes the same chain step", () => {
    expect(step(AUCTION_ID, C, felt("X"))).toBe(CAIRO.step1);
  });

  it("builds the same anchors", () => {
    expect(upAnchor(AUCTION_ID, C, SEED, LEVEL)).toBe(CAIRO.up_anchor);
    expect(downAnchor(AUCTION_ID, C, SEED, LEVEL, LEVELS)).toBe(CAIRO.down_anchor);
  });

  it("builds the same witnesses", () => {
    expect(witnessAtOrAbove(AUCTION_ID, C, SEED, LEVEL, 5)).toBe(CAIRO.w_above_5);
    expect(witnessAtOrBelow(AUCTION_ID, C, SEED, LEVEL, 12)).toBe(CAIRO.w_below_12);
  });

  it("accumulates the same bid root", () => {
    const r1 = extendBidRoot(0n, 0, C, 111n, 222n);
    expect(r1).toBe(CAIRO.bid_root1);
    expect(extendBidRoot(r1, 1, C, 333n, 444n)).toBe(CAIRO.bid_root2);
  });
});
