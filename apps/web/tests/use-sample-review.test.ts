import { describe, it, expect } from "vitest";
import { matchLegacyRow, rcnRow } from "../src/app/valuations/[id]/steps/use-sample-review";

/**
 * `matchLegacyRow` (wave 4, C1 root cause #2; refined wave 5): the pure
 * matching helper `rebuildComparables` falls back to for LEGACY rows (no
 * `lokalId` on the form row — a draft saved before that field existed).
 * Never trusts position. A SINGLE row for a `transactionId` is reused
 * as-is (edits included); 2+ rows for one `transactionId` (a genuine
 * multi-lokal act) are disambiguated by identical date/area/pricePerM2
 * content, rounded exactly like `rcnRow`.
 */
describe("matchLegacyRow", () => {
  const candidate = {
    transactionId: "T1",
    date: "2026-05-10",
    area: 50.634,
    pricePerM2: 7505.428,
  };

  it("matches the single legacy row for this transactionId, content identical", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    expect(row.area).toBe("50.63");
    expect(row.pricePerM2).toBe("7505.43");
    expect(matchLegacyRow(candidate, [row])).toBe(row);
  });

  it("a SINGLE legacy row for a transactionId is reused AS-IS even with an EDITED/mismatched price — wave 5: a single-lokal act cannot be confused with another lokal, so there is no other row to guess wrong", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    const edited = { ...row, pricePerM2: "12345" };
    expect(matchLegacyRow(candidate, [edited])).toBe(edited);
  });

  it("2+ legacy rows share one transactionId, one is edited: content matches the candidate whose fresh content it still equals (the UNEDITED row); the EDITED row's own candidate finds nothing and regenerates — accepted trade-off, only for a genuine multi-lokal act", () => {
    const candA = { transactionId: "T1", date: "2026-05-10", area: 50.63, pricePerM2: 7505.43 };
    const candB = { transactionId: "T1", date: "2026-05-10", area: 38.19, pricePerM2: 7541.24 };
    const rowA = rcnRow({ ...candA, lokalId: "" }); // unedited — still matches candA's own content
    const rowBEdited = { ...rcnRow({ ...candB, lokalId: "" }), pricePerM2: "99999" }; // B's row, edited
    // A's candidate finds its own unedited row, unaffected by B's edit.
    expect(matchLegacyRow(candA, [rowA, rowBEdited])).toBe(rowA);
    // B's candidate no longer content-matches its OWN (now edited) row.
    expect(matchLegacyRow(candB, [rowA, rowBEdited])).toBeUndefined();
  });

  it("returns undefined (ambiguous) when 2+ legacy rows share transactionId + identical content — never guesses which one", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    expect(matchLegacyRow(candidate, [row, { ...row }])).toBeUndefined();
  });

  it("ignores a legacy row for a DIFFERENT transactionId even with identical content — zero rows for THIS transactionId, not one", () => {
    const row = rcnRow({ ...candidate, transactionId: "T-OTHER", lokalId: "" });
    expect(matchLegacyRow(candidate, [row])).toBeUndefined();
  });
});
