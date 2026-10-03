/**
 * The Resolved card claimed every collected lot was collected privately. The Sepolia lots
 * went to public addresses. Only the collecting transaction can say which it was.
 */
import { describe, expect, it } from "vitest";
import { lotLabel, lotRail } from "@/lib/lotRail";

const ANON = "0x06dfbdabc0c44c97c3227b8b5a829db9f0eb60e52c07dea13de02a049893f758";

describe("lotRail", () => {
  it("is private when the anonymizer emitted in the collecting transaction", () => {
    expect(lotRail([{ from_address: "0x5" }, { from_address: "0x6dfbdabc0c44c97c3227b8b5a829db9f0eb60e52c07dea13de02a049893f758" }], ANON))
      .toBe("private");
  });

  it("is public when it did not", () => {
    expect(lotRail([{ from_address: "0x5" }], ANON)).toBe("public");
  });

  it("does not guess when no anonymizer is configured", () => {
    expect(lotRail([{ from_address: "0x5" }], "")).toBeNull();
  });
});

describe("lotLabel", () => {
  it("never says privately unless the chain showed it", () => {
    expect(lotLabel(true, "public")).toBe("collected to a public address");
    expect(lotLabel(true, null)).toBe("collected");
    expect(lotLabel(true, undefined)).toBe("collected");
    expect(lotLabel(true, "private")).toBe("collected privately");
    expect(lotLabel(false, "private")).toBe("awaiting collection");
  });
});
