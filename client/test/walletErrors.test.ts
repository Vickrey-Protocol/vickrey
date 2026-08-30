/**
 * Reading a wallet error without destroying it, and without inventing meaning.
 *
 * The bug this exists to prevent: `String(e)` on a JSON-RPC error object yields
 * "[object Object]", so the numeric code — the only informative field the spec defines —
 * was gone before anyone saw it. A user reported "An error occurred (UNKNOWN_ERROR)" and
 * that was the entirety of the evidence available.
 */
import { describe, expect, it } from "vitest";
import { WALLET_ERRORS, readWalletError } from "../src/walletErrors.ts";

describe("the code survives however the wallet throws it", () => {
  it("reads a plain JSON-RPC object, which is not an Error", () => {
    const r = readWalletError({ code: 163, message: "An error occurred (UNKNOWN_ERROR)" });
    expect(r.code).toBe(163);
    expect(r.name).toBe("UNKNOWN_ERROR");
    expect(r.recognised).toBe(true);
  });

  it("never produces [object Object]", () => {
    for (const thrown of [
      { code: 118, message: "An error occurred (NOT_REGISTERED)" },
      { error: { code: 113 } },
      { weird: true },
      new Error("An error occurred (UNKNOWN_ERROR)"),
      "plain string",
      null,
    ]) {
      expect(readWalletError(thrown).raw).not.toContain("[object Object]");
      expect(readWalletError(thrown).say.length).toBeGreaterThan(0);
    }
  });

  it("finds a code nested one level down", () => {
    expect(readWalletError({ error: { code: 114, message: "x" } }).name)
      .toBe("INVALID_REQUEST_PAYLOAD");
  });

  it("falls back to the name in the message when no code is sent", () => {
    const r = readWalletError(new Error("An error occurred (NOT_REGISTERED)"));
    expect(r.code).toBe(118);
    expect(r.recognised).toBe(true);
  });
});

describe("every code in the spec is mapped to something sayable", () => {
  /* The spec's own message for every error is "An error occurred (NAME)" — the code name
     in brackets and nothing else. Passing that through is passing through nothing, so a
     mapped sentence must never merely restate it. */
  it("has every one the spec declares: 111-120, plus 162 and 163", () => {
    expect(Object.keys(WALLET_ERRORS)).toHaveLength(12);
  });

  it("says something the spec does not", () => {
    for (const [code, v] of Object.entries(WALLET_ERRORS)) {
      expect(v.say).not.toMatch(/An error occurred/);
      expect(v.say).not.toBe(v.name);
      expect(v.say.length).toBeGreaterThan(25);
      expect(readWalletError({ code: Number(code) }).say).toBe(v.say);
    }
  });
});

describe("an unrecognised error is not given a name", () => {
  it("says so, and shows the code", () => {
    const r = readWalletError({ code: 999, message: "An error occurred (SOMETHING_NEW)" });
    expect(r.recognised).toBe(false);
    expect(r.name).toBeNull();
    expect(r.say).toMatch(/do not recognise/i);
    expect(r.say).toContain("999");
  });

  it("does not borrow the nearest familiar sentence", () => {
    const r = readWalletError({ code: 999 });
    for (const known of Object.values(WALLET_ERRORS)) expect(r.say).not.toBe(known.say);
  });

  it("admits when there was no code at all", () => {
    const r = readWalletError({ message: "something went sideways" });
    expect(r.code).toBeNull();
    expect(r.say).toMatch(/no error code/i);
    expect(r.raw).toContain("something went sideways");
  });
});
