/**
 * Two tokens, two decimal scales, and a type system that will not let them cross.
 *
 * A two-token auction prices a lot in one ERC-20 against payment in another, and the two
 * have their own decimals. Every figure on the create screen belongs to exactly one of
 * them: the lot amount is in lot units, and the reserve, tick, cap, top and bond are all
 * payment units. Thirteen sites in that one file, each a chance to use the wrong scale.
 *
 * This project has already shipped that bug once — `formatUnits` hardcoded 18 decimals
 * across 31 call sites and rendered 250 USDC as `0`. It was invisible because a number
 * scaled by the wrong power of ten is still a number. Nothing looks wrong; it is just
 * wrong.
 *
 * So the scales are branded. `LotDecimals` and `PayDecimals` are both `number` at
 * runtime and mutually unassignable at compile time, and the same for the amounts. There
 * is no `toUnits(value, decimals)` any more, because that signature is exactly the one
 * that accepts either. A crossing is now a type error at the site that makes it, not a
 * wrong figure discovered by someone reading the screen carefully.
 *
 * The brands cost nothing at runtime: `lotDecimals(8)` is the identity function.
 */
declare const scale: unique symbol;

export type LotDecimals = number & { readonly [scale]: "lot" };
export type PayDecimals = number & { readonly [scale]: "pay" };
/** Smallest units of the lot token. */
export type LotAmount = bigint & { readonly [scale]: "lot" };
/** Smallest units of the payment token. */
export type PayAmount = bigint & { readonly [scale]: "pay" };

/* The only places a brand is applied. Everything downstream is checked. */
export const lotDecimals = (n: number) => n as LotDecimals;
export const payDecimals = (n: number) => n as PayDecimals;
export const lotAmount = (n: bigint) => n as LotAmount;
export const payAmount = (n: bigint) => n as PayAmount;

/**
 * Human string to smallest units. Truncates rather than rounds — a fractional part
 * longer than the token supports is the user asking for precision that does not exist,
 * and rounding it up would spend more than they typed.
 */
function units(s: string | undefined, decimals: number): bigint {
  const [w = "0", f = ""] = String(s ?? "0").trim().split(".");
  if (!/^\d*$/.test(w) || !/^\d*$/.test(f)) throw new Error(`not a number: ${s}`);
  return BigInt(w || "0") * 10n ** BigInt(decimals)
    + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export const toLotUnits = (s: string | undefined, d: LotDecimals) => units(s, d) as LotAmount;
export const toPayUnits = (s: string | undefined, d: PayDecimals) => units(s, d) as PayAmount;

/** Smallest units back to a human string, at that token's own scale. */
function render(raw: bigint, decimals: number, maxFrac: number): string {
  const base = 10n ** BigInt(decimals);
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = (v / base).toString();
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Always with the symbol. A bare figure cannot be checked against anything — "8" could
 * be eight of either token — and the whole point of separating the scales is that a
 * reader can see when one is wrong.
 */
export const showLot = (a: LotAmount, d: LotDecimals, symbol: string, maxFrac = d) =>
  `${render(a, d, maxFrac)} ${symbol}`;
export const showPay = (a: PayAmount, d: PayDecimals, symbol: string, maxFrac = d) =>
  `${render(a, d, maxFrac)} ${symbol}`;

/** Arithmetic that stays inside one scale. */
export const addPay = (a: PayAmount, b: PayAmount) => (a + b) as PayAmount;
export const mulPay = (a: PayAmount, n: bigint) => (a * n) as PayAmount;
export const subPay = (a: PayAmount, b: PayAmount) => (a - b) as PayAmount;
export const divPay = (a: PayAmount, n: bigint) => (a / n) as PayAmount;
