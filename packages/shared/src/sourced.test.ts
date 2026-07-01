import { describe, it, expect } from "vitest";
import { sourced, isBlocking } from "./sourced";

describe("sourced", () => {
  it("wraps a value with provenance, default status confirmed", () => {
    const s = sourced(71.63, "appraiser");
    expect(s.value).toBe(71.63);
    expect(s.provenance).toEqual({ source: "appraiser", status: "confirmed" });
  });
  it("isBlocking is true for to_verify/none, false for confirmed", () => {
    expect(isBlocking(sourced(0, "geokoder", "to_verify"))).toBe(true);
    expect(isBlocking(sourced(0, "none", "none"))).toBe(true);
    expect(isBlocking(sourced(1, "appraiser", "confirmed"))).toBe(false);
  });
});
