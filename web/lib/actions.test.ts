/**
 * The queue's job is to be *right about consequences*, and it was not.
 *
 * Two defects shipped together in `send-seed`, the one step a bidder can miss without
 * ever seeing an error:
 *
 * 1. Its deadline read `a.disputeDeadline || null`, but `dispute_deadline` is written by
 *    `settle` — during `Sealed`, the only status this action fires in, it is still 0. So
 *    `|| null` rendered the tightest window in the protocol as "No deadline", and the
 *    sort in `actionsFor` puts null-deadline actions *last*.
 * 2. Its copy said a seed not sent forfeits your collateral. `redeem_forfeit` exists so
 *    that it does not.
 *
 * Neither would fail a test that only checked the action appears. So these assert the
 * two properties directly: the step has a deadline, and the copy does not claim a loss
 * the contract does not impose.
 */
import { describe, expect, it } from "vitest";
import { Status, AuctionKind } from "@vickrey/client";
import { actionsFor } from "@/lib/actions";
import type { AuctionView } from "@/lib/chain";
import type { StoredBid } from "@/lib/vault";

const ME = "0x1";
const SEALED_AT = 1_700_000_000;
const WINDOW = 3600;

const auction = (over: Partial<AuctionView> = {}): AuctionView => ({
  terms: {
    auctionId: 1n, kind: AuctionKind.Vickrey, reservePrice: 1n, tick: 1n, numLevels: 10,
  } as AuctionView["terms"],
  status: Status.Sealed,
  seller: "0x9", auctioneer: "0x9",
  paymentToken: "0x2", paymentSymbol: "STRK", paymentDecimals: 18,
  lotToken: "0x3", lotSymbol: "LOT", lotDecimals: 18, lotAmount: 1n,
  bidDeadline: SEALED_AT - 10,
  disputeWindow: WINDOW,
  /* Exactly the state that produced the bug: settle has not run, so this is 0. */
  disputeDeadline: 0,
  sealedAtTime: SEALED_AT,
  bidCount: 1, bidRoot: 0n, clearingLevel: 0, winnerIndex: 0,
  collateral: 10n, bond: 1n, lotClaimed: false, poolFee: null,
  ...over,
});

const myBid = (over: Partial<StoredBid> = {}): StoredBid => ({
  auctionId: "1", index: 0, level: 3, claimSecret: "1", seed: "2",
  claimCommitment: "3", upAnchor: "4", downAnchor: "5", ...over,
});

const sendSeed = (a: AuctionView[], b: StoredBid[]) =>
  actionsFor(a, b, ME, SEALED_AT + 1).find((x) => x.kind === "send-seed");

describe("send-seed, the step that can be silently missed", () => {
  it("carries a deadline while sealed, when dispute_deadline is still zero", () => {
    const found = sendSeed([auction()], [myBid()]);
    expect(found).toBeDefined();
    // The regression: this was null, because `0 || null` is null.
    expect(found!.deadline).not.toBeNull();
    // The honest bound is the auctioneer's own: past it, anyone can abandon.
    expect(found!.deadline).toBe(SEALED_AT + WINDOW);
  });

  it("sorts above a later obligation instead of sinking below it", () => {
    /* A second auction this user runs, still Open, whose `seal` falls due *after* the
       seed bound. Sorted by deadline the seed comes first; with the bug it had no
       deadline at all and the sort drops those to the bottom.

       The comparison has to be against an action that genuinely has a deadline. An
       earlier version of this test used one that did not, so both compared equal, the
       stable sort preserved insertion order, and it passed against the bug it was
       written to catch. */
    const later = auction({
      terms: { ...auction().terms, auctionId: 2n },
      status: Status.Open,
      auctioneer: ME,
      bidDeadline: SEALED_AT + WINDOW * 10,
    });
    const all = actionsFor([auction(), later], [myBid()], ME, SEALED_AT + 1);
    const seed = all.findIndex((x) => x.kind === "send-seed");
    const seal = all.findIndex((x) => x.kind === "seal");
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seal).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(seal);
  });

  it("does not tell the bidder their escrow is lost", () => {
    const { detail } = sendSeed([auction()], [myBid()])!;
    // `redeem_forfeit` returns the escrow in full, so no phrasing may claim otherwise.
    expect(detail).not.toMatch(/forfeits your collateral/i);
    // and it has to say where the money actually comes back from.
    expect(detail).toMatch(/redeem forfeit/i);
    expect(detail).toMatch(/dispute/i);
  });

  it("disappears once the seed has been sent", () => {
    expect(sendSeed([auction()], [myBid({ revealedAt: Date.now() })])).toBeUndefined();
  });
});
