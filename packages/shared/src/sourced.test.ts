import { describe, it, expect } from "vitest";
import { sourced, isBlocking } from "./sourced";

describe("sourced", () => {
  it("wraps a value with explicit provenance (status is required — no silent defaults, ADR-010)", () => {
    const s = sourced(71.63, "rzeczoznawca", "confirmed");
    expect(s.value).toBe(71.63);
    expect(s.provenance).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("isBlocking is true for to_verify/none, false for confirmed", () => {
    expect(isBlocking(sourced(0, "geokoder", "to_verify"))).toBe(true);
    expect(isBlocking(sourced(0, "rcn", "none"))).toBe(true);
    expect(isBlocking(sourced(1, "rzeczoznawca", "confirmed"))).toBe(false);
  });
});
