import { describe, it, expect } from "vitest";
import { matchLegacyRow, rcnRow } from "../src/app/valuations/[id]/steps/use-sample-review";

/**
 * `matchLegacyRow` (wave 4, C1 root cause #2): the pure content-matching
 * helper `rebuildComparables` falls back to for LEGACY rows (no `lokalId`
 * on the form row — a draft saved before that field existed). Never trusts
 * position — only transactionId + identical date/area/pricePerM2, rounded
 * exactly like `rcnRow`.
 */
describe("matchLegacyRow", () => {
  const candidate = {
    transactionId: "T1",
    date: "2026-05-10",
    area: 50.634,
    pricePerM2: 7505.428,
  };

  it("matches the single legacy row with the same transactionId + identical content (rounded like rcnRow)", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    expect(row.area).toBe("50.63");
    expect(row.pricePerM2).toBe("7505.43");
    expect(matchLegacyRow(candidate, [row])).toBe(row);
  });

  it("returns undefined when no legacy row's content matches", () => {
    const other = rcnRow({
      transactionId: "T1",
      date: "2026-01-01",
      area: 10,
      pricePerM2: 1,
      lokalId: "",
    });
    expect(matchLegacyRow(candidate, [other])).toBeUndefined();
  });

  it("returns undefined when the transactionId matches but the content doesn't", () => {
    const other = rcnRow({ ...candidate, area: 99, lokalId: "" });
    expect(matchLegacyRow(candidate, [other])).toBeUndefined();
  });

  it("returns undefined (ambiguous) when 2+ legacy rows share transactionId + identical content — never guesses which one", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    expect(matchLegacyRow(candidate, [row, { ...row }])).toBeUndefined();
  });

  it("an EDITED legacy row's content no longer matches — accepted trade-off, caller regenerates fresh", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    const edited = { ...row, pricePerM2: "9999" };
    expect(matchLegacyRow(candidate, [edited])).toBeUndefined();
  });

  it("ignores a legacy row for a DIFFERENT transactionId even with identical content", () => {
    const row = rcnRow({ ...candidate, transactionId: "T-OTHER", lokalId: "" });
    expect(matchLegacyRow(candidate, [row])).toBeUndefined();
  });
});
