/**
 * A wallet timeout rerouted a mainnet bid to the public rail without a word. Only an
 * answer that says "unsupported" may disable the private rail.
 */
import { describe, expect, it } from "vitest";
import { strk20Verdict } from "@/components/WalletProvider";

describe("what a wallet error proves about the private rail", () => {
  it("no code at all (a timeout, a hang) changes nothing", () => {
    expect(strk20Verdict("unknown", null)).toBe("unknown");
    expect(strk20Verdict("working", null)).toBe("working");
  });

  it("the wallet's catch-all and unrecognised codes change nothing", () => {
    expect(strk20Verdict("working", 163)).toBe("working");
    expect(strk20Verdict("unknown", 999)).toBe("unknown");
  });

  it("an insufficient balance proves the rail works", () => {
    expect(strk20Verdict("unknown", 119)).toBe("working");
  });

  it("only unsupported-network or API answers disable it", () => {
    for (const c of [112, 117, 162]) expect(strk20Verdict("working", c)).toBe("failed");
  });
});
