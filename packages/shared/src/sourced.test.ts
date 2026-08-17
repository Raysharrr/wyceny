import { describe, it, expect } from "vitest";
import { sourced, isBlocking, type ProvenanceSource } from "./sourced";

// Exhaustive map over the closed source enum: adding a member to
// ProvenanceSource without listing it here is a TYPECHECK error, and dropping
// one breaks the count assertion below. This is the enum's regression guard —
// the union is a Shared Kernel contract, not an ad-hoc list.
const ALL_SOURCES: Record<ProvenanceSource, true> = {
  geokoder: true,
  ewidencja: true,
  mpzp: true,
  odpis_kw: true,
  akt: true,
  rcn: true,
  ogledziny: true,
  rzeczoznawca: true,
  preset: true,
  ai: true,
};

describe("sourced", () => {
  it("the provenance source enum is closed and complete (ADR-010 + ADR-014 `ai`)", () => {
    expect(Object.keys(ALL_SOURCES).sort()).toEqual([
      "ai",
      "akt",
      "ewidencja",
      "geokoder",
      "mpzp",
      "odpis_kw",
      "ogledziny",
      "preset",
      "rcn",
      "rzeczoznawca",
    ]);
  });

  it("`ai` roundtrips like any other source and blocks until confirmed (ADR-014)", () => {
    const s = sourced("Lokal mieszkalny o powierzchni użytkowej 45,70 m2.", "ai", "to_verify");
    expect(s.provenance).toEqual({ source: "ai", status: "to_verify" });
    expect(isBlocking(s)).toBe(true);
    // once the appraiser edits/accepts it, provenance flips to the human
    expect(isBlocking(sourced(s.value, "rzeczoznawca", "confirmed"))).toBe(false);
  });

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
