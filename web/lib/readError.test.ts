import { describe, expect, it } from "vitest";
import { plainReadError } from "@/lib/readError";

describe("a failed read, in plain words", () => {
  it("names a rate limit as a busy network", () => {
    expect(plainReadError(`Unexpected token 'R', "Rate limit exceeded\n" is not valid JSON`))
      .toBe("The network is busy right now. Try again in a moment.");
  });
  it("names a dropped connection", () => {
    expect(plainReadError("TypeError: Failed to fetch")).toMatch(/didn't answer/);
  });
  it("passes anything else through", () => {
    expect(plainReadError("auction 9 does not exist")).toBe("auction 9 does not exist");
    expect(plainReadError(null)).toBe("");
  });
});
