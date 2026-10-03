/**
 * "Placed" and "safe to retry" are claims about the chain, so only the chain may make
 * them. These pin each verdict against a scripted chain.
 */
import { describe, expect, it } from "vitest";
import { confirmBid, type Probe } from "@/lib/bidConfirm";

const mine = { commitment: 7n, downAnchor: 9n };
const fast = { windowMs: 30, everyMs: 5 };

const probe = (over: Partial<Probe>): Probe => ({
  indexOf: async () => null,
  bidAt: async () => ({ commitment: 7n, downAnchor: 9n }),
  stillOpen: async () => true,
  ...over,
});

describe("confirmBid", () => {
  it("says placed only when the bid at that index is ours", async () => {
    expect(await confirmBid(probe({ indexOf: async () => 3 }), mine, fast))
      .toEqual({ kind: "placed", index: 3 });
  });

  it("finds a bid that lands after the wallet gave up", async () => {
    let calls = 0;
    const v = await confirmBid(probe({ indexOf: async () => (++calls > 2 ? 4 : null) }), mine,
      { windowMs: 200, everyMs: 5 });
    expect(v).toEqual({ kind: "placed", index: 4 });
  });

  it("says safe to retry only after a whole clean window, auction still open", async () => {
    expect(await confirmBid(probe({}), mine, fast)).toEqual({ kind: "absent" });
  });

  it("says not placed when bidding has closed", async () => {
    expect(await confirmBid(probe({ stillOpen: async () => false }), mine, fast)).toEqual({ kind: "closed" });
  });

  it("never concludes absent from a window in which a read failed", async () => {
    let calls = 0;
    const v = await confirmBid(probe({
      indexOf: async () => { if (++calls === 1) throw new Error("rpc down"); return null; },
    }), mine, fast);
    expect(v.kind).toBe("unknown");
  });

  it("reports a revert from the receipt straight away", async () => {
    const v = await confirmBid(probe({ receipt: async () => ({ reverted: "BIDDING_CLOSED" }) }), mine, fast);
    expect(v).toEqual({ kind: "reverted", reason: "BIDDING_CLOSED" });
  });

  it("does not call someone else's bid ours", async () => {
    const v = await confirmBid(probe({
      indexOf: async () => 1, bidAt: async () => ({ commitment: 8n, downAnchor: 9n }) }), mine, fast);
    expect(v.kind).toBe("unknown");
  });
});
