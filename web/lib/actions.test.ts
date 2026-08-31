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
import { actionsFor, auctioneerActions, bidderActions } from "@/lib/actions";
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
    /* A second auction this user runs, sealed later, so its `settle` falls due after the
       seed bound. Sorted by deadline the seed comes first; with the bug it had no
       deadline at all and the sort drops those to the bottom.

       The comparison has to be against an action that genuinely has a deadline. An
       earlier version of this test used one that did not, so both compared equal, the
       stable sort preserved insertion order, and it passed against the bug it was
       written to catch. */
    const later = auction({
      terms: { ...auction().terms, auctionId: 2n },
      auctioneer: ME,
      sealedAtTime: SEALED_AT + WINDOW * 10,
    });
    const all = actionsFor([auction(), later], [myBid()], ME, SEALED_AT + 1);
    const seed = all.findIndex((x) => x.kind === "send-seed");
    const settle = all.findIndex((x) => x.kind === "settle" && x.auctionId === 2n);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(settle).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(settle);
  });

  it("does not tell the bidder their escrow is lost", () => {
    const { detail, consequence } = sendSeed([auction()], [myBid()])!;
    const text = `${detail} ${consequence}`;
    // `redeem_forfeit` returns the escrow in full, so no phrasing may claim otherwise.
    expect(text).not.toMatch(/forfeits your collateral/i);
    // and it has to say where the money actually comes back from — both branches.
    expect(consequence).toMatch(/redeem forfeit/i);
    expect(consequence).toMatch(/dispute/i);
  });

  it("marks its deadline as a bound, because the auctioneer may settle sooner", () => {
    expect(sendSeed([auction()], [myBid()])!.deadlineKind).toBe("bound");
  });

  it("disappears once the seed has been sent", () => {
    expect(sendSeed([auction()], [myBid({ revealedAt: Date.now() })])).toBeUndefined();
  });
});

/**
 * The queue's other rule: everything in it must be callable *now*.
 *
 * `seal` reverts before the bid deadline, `finalize` reverts until the dispute window has
 * closed, and `dispute` reverts once it has. Each was listed the moment the status
 * matched, so the queue offered calls the chain would reject.
 */
describe("nothing is offered before the chain will accept it", () => {
  const asAuctioneer = (over: Partial<AuctionView>) => auction({ auctioneer: ME, ...over });
  const kinds = (a: AuctionView, now: number) =>
    actionsFor([a], [myBid()], ME, now).map((x) => x.kind);

  it("withholds seal until the bid deadline has passed", () => {
    const open = asAuctioneer({ status: Status.Open, bidDeadline: SEALED_AT + 100 });
    expect(kinds(open, SEALED_AT)).not.toContain("seal");
    expect(kinds(open, SEALED_AT + 100)).toContain("seal");
  });

  it("withholds finalize until the dispute window has closed", () => {
    const settled = asAuctioneer({
      status: Status.Settled, disputeDeadline: SEALED_AT + 100,
    });
    expect(kinds(settled, SEALED_AT)).not.toContain("finalize");
    expect(kinds(settled, SEALED_AT + 100)).toContain("finalize");
  });

  it("withdraws dispute once the window has closed, though the status has not moved", () => {
    const settled = auction({ status: Status.Settled, disputeDeadline: SEALED_AT + 100 });
    expect(kinds(settled, SEALED_AT)).toContain("dispute");
    // Still `Settled` — nobody has finalized — but the call would now revert.
    expect(kinds(settled, SEALED_AT + 100)).not.toContain("dispute");
  });

  it("gives the auctioneer's settle the deadline that abandon enforces", () => {
    const sealed = asAuctioneer({});
    const settle = actionsFor([sealed], [], ME, SEALED_AT + 1)
      .find((x) => x.kind === "settle")!;
    expect(settle.deadline).toBe(SEALED_AT + WINDOW);
    expect(settle.deadlineKind).toBe("hard");
    expect(settle.consequence).toMatch(/bond/i);
  });
});

describe("counts mean what their label says", () => {
  it("does not count an auctioneer's work as the user's bids", () => {
    /* The reported symptom: sidebar said "My bids 2" for an address holding no bids. */
    const mine = asBidless();
    const all = actionsFor(mine, [], ME, SEALED_AT + 1);
    expect(all.length).toBeGreaterThan(0);
    expect(bidderActions(all)).toHaveLength(0);
    expect(auctioneerActions(all)).toHaveLength(all.length);
  });
});

function asBidless(): AuctionView[] {
  return [auction({ auctioneer: ME })];
}

describe("permissionless steps are offered to whoever can take them", () => {
  /* `seal` and `finalize` have no caller check in the contract, and the manage panel
     already offered both to anyone. The queue gated them behind being the auctioneer, so
     a bidder waiting on a stalled auction was never told they could move it themselves —
     which is precisely the guarantee the permissionlessness exists to provide. */
  const theirs = { auctioneer: "0x9" };

  it("offers seal to a bidder when the auctioneer has not done it", () => {
    const a = auction({ ...theirs, status: Status.Open, bidDeadline: SEALED_AT });
    const seal = actionsFor([a], [myBid()], ME, SEALED_AT + 1).find((x) => x.kind === "seal");
    expect(seal).toBeDefined();
    expect(seal!.role).toBe("bidder");
    expect(seal!.consequence).toMatch(/permissionless/i);
  });

  it("offers finalize to a bidder once the window has closed", () => {
    const a = auction({ ...theirs, status: Status.Settled, disputeDeadline: SEALED_AT });
    const fin = actionsFor([a], [myBid()], ME, SEALED_AT + 1).find((x) => x.kind === "finalize");
    expect(fin).toBeDefined();
    expect(fin!.role).toBe("bidder");
  });

  it("still keeps settle to the auctioneer, which is the one step with a caller check", () => {
    const a = auction({ ...theirs });
    expect(actionsFor([a], [myBid()], ME, SEALED_AT + 1).map((x) => x.kind))
      .not.toContain("settle");
  });

  it("does not offer either to someone with no stake in the auction", () => {
    const a = auction({ ...theirs, status: Status.Open, bidDeadline: SEALED_AT });
    expect(actionsFor([a], [], ME, SEALED_AT + 1)).toHaveLength(0);
  });
});

describe("the winner is told about the surplus, not only the lot", () => {
  /* `claim-refund` was guarded by `!won`, so a winner got "Claim your lot" and nothing
     else. `finalize` has already taken the clearing price out of their escrow, so the
     remainder is theirs and was sitting in the contract unmentioned — the exact failure
     of a screen that reads as finished when it is half done. */
  const finalized = () => auction({ status: Status.Finalized, winnerIndex: 0, lotClaimed: true });
  const key = "1:0";

  it("offers the surplus once the chain says it is unclaimed", () => {
    const states = new Map([[key, { index: 0, escrow: 5n, disposition: 3, claimed: false }]]);
    const kinds = actionsFor([finalized()], [myBid()], ME, SEALED_AT, states as never)
      .map((x) => x.kind);
    expect(kinds).toContain("claim-refund");
  });

  it("withdraws it once collected, rather than offering a call that would revert", () => {
    const states = new Map([[key, { index: 0, escrow: 0n, disposition: 3, claimed: true }]]);
    const kinds = actionsFor([finalized()], [myBid()], ME, SEALED_AT, states as never)
      .map((x) => x.kind);
    expect(kinds).not.toContain("claim-refund");
  });

  it("says the lot does not collect it", () => {
    const states = new Map([[key, { index: 0, escrow: 5n, disposition: 3, claimed: false }]]);
    const a = actionsFor([finalized()], [myBid()], ME, SEALED_AT, states as never)
      .find((x) => x.kind === "claim-refund")!;
    expect(a.consequence).toMatch(/claiming the lot does not collect this/i);
  });
});

describe("the party whose assets are locked is told they can act", () => {
  /* `seal` is permissionless from the bid deadline, so an auction left Open holds the lot
     with no path out until *somebody* acts — and nothing compels anyone. The queue offered
     it to the auctioneer and to bidders, and never to the seller, who is the one whose lot
     is sitting in the contract. Permission was right; incentive was not addressed. */
  const openPastDeadline = (over = {}) => auction({
    status: Status.Open, bidDeadline: SEALED_AT, auctioneer: "0x9", seller: "0x9", ...over,
  });

  it("offers seal to the seller of their own auction", () => {
    const a = openPastDeadline({ seller: ME });
    const seal = actionsFor([a], [], ME, SEALED_AT + 1).find((x) => x.kind === "seal");
    expect(seal).toBeDefined();
    expect(seal!.role).toBe("seller");
  });

  it("offers abandon and finalize to the seller too", () => {
    const sealed = auction({ auctioneer: "0x9", seller: ME, sealedAtTime: SEALED_AT,
      disputeWindow: WINDOW });
    expect(actionsFor([sealed], [], ME, SEALED_AT + WINDOW + 1).map((x) => x.kind))
      .toContain("abandon");
    const settled = auction({ auctioneer: "0x9", seller: ME, status: Status.Settled,
      disputeDeadline: SEALED_AT });
    expect(actionsFor([settled], [], ME, SEALED_AT + 1).map((x) => x.kind))
      .toContain("finalize");
  });

  it("marks an action holding assets with no clock as blocking", () => {
    const seal = actionsFor([openPastDeadline({ seller: ME })], [], ME, SEALED_AT + 1)
      .find((x) => x.kind === "seal")!;
    expect(seal.blocking).toBe(true);
    expect(seal.deadline).toBeNull();
  });

  it("ranks a blocking action above undated work that is merely waiting", () => {
    /* Otherwise "seal this or nobody's money moves" sorts alongside "collect your refund
       whenever", which is where it used to land. */
    const stuck = openPastDeadline({ seller: ME });
    const done = auction({
      terms: { ...auction().terms, auctionId: 2n },
      status: Status.Finalized, winnerIndex: 99, seller: "0x9", auctioneer: "0x9",
    });
    const all = actionsFor([done, stuck], [myBid({ auctionId: "2" })], ME, SEALED_AT + 1);
    const seal = all.findIndex((x) => x.kind === "seal");
    const refund = all.findIndex((x) => x.kind === "claim-refund");
    expect(seal).toBeGreaterThanOrEqual(0);
    expect(refund).toBeGreaterThanOrEqual(0);
    expect(seal).toBeLessThan(refund);
  });
});
