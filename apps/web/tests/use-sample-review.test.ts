import { describe, it, expect } from "vitest";
import { matchLegacyRow, rcnRow } from "../src/app/valuations/[id]/steps/use-sample-review";

/**
 * `matchLegacyRow` (wave 4, C1 root cause #2; refined wave 5, wave 6): the
 * pure matching helper `rebuildComparables` falls back to for LEGACY rows
 * (no `lokalId` on the form row — a draft saved before that field
 * existed). Never trusts position.
 *
 * A SINGLE legacy row for a `transactionId` is reused as-is (edits
 * included) ONLY when there's also exactly ONE candidate of that
 * `transactionId` in the effective proposal (`candidatesForTx`) — one row
 * with 2+ candidates of the same act is still ambiguous. Whenever either
 * side has 2+, content (date/area/pricePerM2, rounded like `rcnRow`)
 * decides. The caller (`rebuildComparables`) also CONSUMES a claimed row
 * from a shared pool before the next candidate is checked, so the tests
 * here that model "2 candidates sharing rows" pass the SAME array to both
 * calls but never assert both calls in a way that would hide a
 * double-claim — each assertion below reflects what `rebuildComparables`
 * would actually see call-by-call.
 */
describe("matchLegacyRow", () => {
  const candidate = {
    transactionId: "T1",
    date: "2026-05-10",
    area: 50.634,
    pricePerM2: 7505.428,
  };

  it("matches the single legacy row for this transactionId (one candidate, one row), content identical", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    expect(row.area).toBe("50.63");
    expect(row.pricePerM2).toBe("7505.43");
    expect(matchLegacyRow(candidate, [row], 1)).toBe(row);
  });

  it("a SINGLE legacy row is reused AS-IS even with an EDITED/mismatched price, when it's ALSO the only candidate of that act (wave 5) — a single-lokal act cannot be confused with another lokal", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    const edited = { ...row, pricePerM2: "12345" };
    expect(matchLegacyRow(candidate, [edited], 1)).toBe(edited);
  });

  it("a SINGLE legacy row does NOT get the shortcut when 2 candidates share that transactionId (wave 6) — content decides instead, correctly matching the candidate the row actually belongs to", () => {
    const row = rcnRow({ ...candidate, lokalId: "" }); // this row IS candidate's own (unedited) data
    const otherCandidateSameAct = { ...candidate, area: 38.19, pricePerM2: 7541.24 };
    // `candidatesForTx: 2` — the shortcut is disabled; content still
    // correctly places the row with the candidate it matches.
    expect(matchLegacyRow(candidate, [row], 2)).toBe(row);
    // The OTHER candidate of the same act finds nothing in that same
    // single-row pool (content doesn't match) — regenerates, never
    // receives candidate's row.
    expect(matchLegacyRow(otherCandidateSameAct, [row], 2)).toBeUndefined();
  });

  it("2 legacy rows / 2 candidates with DISTINCT content each match their OWN row", () => {
    const candA = { transactionId: "T1", date: "2026-05-10", area: 50.63, pricePerM2: 7505.43 };
    const candB = { transactionId: "T1", date: "2026-05-10", area: 38.19, pricePerM2: 7541.24 };
    const rowA = rcnRow({ ...candA, lokalId: "" });
    const rowB = rcnRow({ ...candB, lokalId: "" });
    expect(matchLegacyRow(candA, [rowA, rowB], 2)).toBe(rowA);
    expect(matchLegacyRow(candB, [rowA, rowB], 2)).toBe(rowB);
  });

  it("2+ legacy rows share one transactionId, one is edited: content matches the candidate whose fresh content it still equals (the UNEDITED row); the EDITED row's own candidate finds nothing and regenerates — accepted trade-off, only for a genuine multi-lokal act", () => {
    const candA = { transactionId: "T1", date: "2026-05-10", area: 50.63, pricePerM2: 7505.43 };
    const candB = { transactionId: "T1", date: "2026-05-10", area: 38.19, pricePerM2: 7541.24 };
    const rowA = rcnRow({ ...candA, lokalId: "" }); // unedited — still matches candA's own content
    const rowBEdited = { ...rcnRow({ ...candB, lokalId: "" }), pricePerM2: "99999" }; // B's row, edited
    // A's candidate finds its own unedited row, unaffected by B's edit.
    expect(matchLegacyRow(candA, [rowA, rowBEdited], 2)).toBe(rowA);
    // B's candidate no longer content-matches its OWN (now edited) row.
    expect(matchLegacyRow(candB, [rowA, rowBEdited], 2)).toBeUndefined();
  });

  it("returns undefined (ambiguous) when 2 legacy rows share transactionId + IDENTICAL content and 2 candidates share it too — never guesses which one, both regenerate", () => {
    const row = rcnRow({ ...candidate, lokalId: "" });
    const rows = [row, { ...row }];
    expect(matchLegacyRow(candidate, rows, 2)).toBeUndefined();
    expect(matchLegacyRow(candidate, rows, 2)).toBeUndefined();
  });

  it("ignores a legacy row for a DIFFERENT transactionId even with identical content — zero rows for THIS transactionId, not one", () => {
    const row = rcnRow({ ...candidate, transactionId: "T-OTHER", lokalId: "" });
    expect(matchLegacyRow(candidate, [row], 1)).toBeUndefined();
  });
});
