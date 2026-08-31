/**
 * A reason shown is not a reason enforced.
 *
 * The private rail's own button was correctly disabled once a real STRK20 call had
 * failed, and said why. The submit button beside it consulted none of that, and the
 * selected rail was never reset — so a rail chosen before the failure stayed chosen
 * after it, and "Bid privately" stayed live all the way back into the same wallet error.
 *
 * Same family as a queue offering calls the chain would reject: the interface knew, said
 * so, and let the action through anyway.
 */
import { describe, expect, it } from "vitest";
import { railUsable, submitBlocked } from "@/lib/rails";

const gate = (o: Partial<Parameters<typeof submitBlocked>[0]> = {}) =>
  submitBlocked({ rail: "public", canPrivate: true, busy: false, connected: true, ...o });

describe("a rail we have proven broken cannot be submitted on", () => {
  it("blocks submit when the private rail is selected and unavailable", () => {
    expect(gate({ rail: "private", canPrivate: false })).toBe(true);
  });

  it("still allows the public rail when the private one is unavailable", () => {
    /* The whole point of detecting the failure: the bid is still placeable. */
    expect(gate({ rail: "public", canPrivate: false })).toBe(false);
  });

  it("allows the private rail when nothing has disproved it", () => {
    expect(gate({ rail: "private", canPrivate: true })).toBe(false);
  });

  it("still blocks on the ordinary reasons", () => {
    expect(gate({ busy: true })).toBe(true);
    expect(gate({ connected: false })).toBe(true);
  });
});

describe("railUsable is the single fact both buttons read", () => {
  it("is false only for an unavailable private rail", () => {
    expect(railUsable("private", false)).toBe(false);
    expect(railUsable("private", true)).toBe(true);
    expect(railUsable("public", false)).toBe(true);
    expect(railUsable("public", true)).toBe(true);
  });
});
