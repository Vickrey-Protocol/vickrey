/**
 * Every figure resolves at its own token's scale.
 *
 * The objection this answers: thirteen sites in the create form use a decimal scale, and
 * a two-token auction gives them two to choose from. One crossed site mis-scales a real
 * amount by a factor of a hundred, silently, because a number scaled wrongly is still a
 * number.
 *
 * The scales here are 8 (lot) and 6 (payment), deliberately, and neither is 18. With 18
 * on one side a crossing often produces a plausible-looking figure or an exact
 * coincidence; with 8 against 6 every crossing is off by exactly 100 and unmistakable.
 *
 * The strongest guard is the type system — `toPayUnits` will not accept `LotDecimals`,
 * so a crossing does not compile. These tests cover what the compiler cannot: that the
 * runtime arithmetic is right, and that a deliberate crossing (forced past the compiler
 * with a cast, the way a `@ts-expect-error` or an `any` would) produces a visibly
 * different answer rather than a coincidentally equal one.
 */
import { describe, expect, it } from "vitest";
import {
  addPay, lotDecimals, payDecimals, showLot, showPay, toLotUnits, toPayUnits,
  type LotDecimals, type PayDecimals,
} from "@/lib/amounts";

/** A lot in an 8-decimal token, priced in a 6-decimal token. */
const LOT_D = lotDecimals(8);
const PAY_D = payDecimals(6);
const LOT_SYM = "VLOT";
const PAY_SYM = "TUSD";

describe("units land at the right scale", () => {
  it("parses a lot amount at 8 decimals", () => {
    expect(toLotUnits("1", LOT_D)).toBe(100_000_000n);
    expect(toLotUnits("2.5", LOT_D)).toBe(250_000_000n);
  });

  it("parses a payment amount at 6 decimals", () => {
    expect(toPayUnits("1", PAY_D)).toBe(1_000_000n);
    expect(toPayUnits("2.5", PAY_D)).toBe(2_500_000n);
  });

  it("makes a crossing off by exactly 100, never a coincidence", () => {
    /* Forced past the compiler the way an `any` or a stray cast would. In real code this
       line does not compile, which is the actual guard. */
    const crossed = toLotUnits("1", PAY_D as unknown as LotDecimals);
    expect(crossed).toBe(1_000_000n);
    expect(crossed).not.toBe(toLotUnits("1", LOT_D));
    expect(Number(toLotUnits("1", LOT_D) / crossed)).toBe(100);
  });

  it("truncates rather than rounding up past the token's precision", () => {
    /* Rounding up would spend more than the user typed. */
    expect(toPayUnits("1.9999999", PAY_D)).toBe(1_999_999n);
  });
});

describe("every displayed figure carries its own symbol and scale", () => {
  /* The create screen's figures, each with the scale it must use. If any site in the
     form is crossed, the figure it renders stops matching the row here. */
  const reserve = toPayUnits("1.5", PAY_D);
  const tick = toPayUnits("0.25", PAY_D);
  const levels = 8n;
  const cap = addPay(reserve, (tick * (levels - 1n)) as typeof tick);
  const bond = toPayUnits("0.25", PAY_D);
  const lot = toLotUnits("3.5", LOT_D);

  const rows: Array<[string, string]> = [
    ["lot amount", showLot(lot, LOT_D, LOT_SYM)],
    ["reserve", showPay(reserve, PAY_D, PAY_SYM)],
    ["tick", showPay(tick, PAY_D, PAY_SYM)],
    ["cap / escrow", showPay(cap, PAY_D, PAY_SYM)],
    ["bond", showPay(bond, PAY_D, PAY_SYM)],
  ];

  it("renders each at its own scale, with the right symbol", () => {
    expect(Object.fromEntries(rows)).toEqual({
      "lot amount": "3.5 VLOT",
      "reserve": "1.5 TUSD",
      "tick": "0.25 TUSD",
      "cap / escrow": "3.25 TUSD",
      "bond": "0.25 TUSD",
    });
  });

  it("never labels a payment figure with the lot's symbol", () => {
    for (const [name, text] of rows) {
      const isLot = name === "lot amount";
      expect(text.endsWith(isLot ? LOT_SYM : PAY_SYM), `${name}: ${text}`).toBe(true);
    }
  });

  it("a crossed render is visibly wrong, not plausibly right", () => {
    /* The cap at the payment scale is 3.25; read at the lot scale it is 0.0325. Two
       orders of magnitude, which is what choosing 8 and 6 buys. */
    const asLot = showLot(cap as unknown as ReturnType<typeof toLotUnits>, LOT_D, LOT_SYM);
    expect(asLot).toBe("0.0325 VLOT");
    expect(asLot).not.toBe(showPay(cap, PAY_D, PAY_SYM));
  });
});
