import { describe, expect, it } from "vitest";
import { missingFields, parseTerms, termsText } from "@/lib/terms";

const f = { what: "A print", condition: "", how: "Post", within: "7 days", counts: "Tracked", reach: "@me" };

describe("terms text", () => {
  it("is labelled lines, skipping empty optional fields", () => {
    expect(termsText(f)).toBe(
      "What it is: A print\nHow it's delivered: Post\nDelivered within: 7 days\n"
      + "What counts as delivered: Tracked\nHow to reach the seller: @me");
  });

  it("round-trips for display", () => {
    expect(parseTerms(termsText(f))[0]).toEqual({ label: "What it is", value: "A print" });
  });

  it("keeps a line it cannot parse rather than dropping it", () => {
    expect(parseTerms("free text")).toEqual([{ label: "", value: "free text" }]);
  });

  it("names the required fields that are empty", () => {
    expect(missingFields({ ...f, how: " ", reach: "" })).toEqual(["how", "reach"]);
  });
});
