import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeKcs, type FeatureRating, type KcsInput } from "../src/domain/kcs";

/**
 * Golden "Piastowskie" (T-12, S4; spec 2026-09-12 §7.1) — the only end-to-end
 * reference for a spółdzielcze własnościowe prawo do lokalu, and the proof of
 * the operat's Ui rounding: the document prints every Ui of Tabela 3 at 3 dp
 * and the appraiser adds up the printed column, so the engine does the same and
 * reproduces her 447 300 zł TO THE ZŁOTY (ΣUi 1,042 · 10 321,50 zł/m²).
 *
 * Until 2026-09-15 the engine summed unrounded Ui and gave 446 900 zł; that
 * −429,50 zł gap was follow-up T-26, now closed. Kościelna is unaffected — no
 * Ui there lands on a fourth decimal that would move the sum.
 *
 * ⚠ DEDUP vs GOLDEN: rows 3 and 4 of the fixture are the registry duplicate
 * (Lp. 194/197 — identical down to the flat number). `coopDedupeKey` merges
 * them, so the SAME sample through the import path gives 14 rows and 446 600.
 * The appraiser computed WITH the duplicate, so this golden stands on a frozen
 * 15-row fixture and never goes through import. Do not "fix" either number.
 */
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/coop-piastowskie.json", import.meta.url)), "utf8"),
) as {
  subjectArea: number;
  rows: { date: string; area: number; priceTotal: number }[];
  features: { name: string; weight: number; rating: FeatureRating }[];
  expected: { csr: number; sumUi: number; unitValue: number; wr: number };
  operatWr: number;
};

function piastowskieInput(): KcsInput {
  return {
    area: fixture.subjectArea,
    // Column M = L/H of the sheet: full precision, never pre-rounded.
    comparables: fixture.rows.map((r) => ({
      date: r.date,
      area: r.area,
      pricePerM2: r.priceTotal / r.area,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: fixture.features,
  };
}

describe("KCS engine — Piastowskie coop reference operat (T-12)", () => {
  it("keeps the 15 rows the appraiser pasted (duplicate included)", () => {
    expect(fixture.rows).toHaveLength(15);
    expect(fixture.rows[2]).toEqual(fixture.rows[3]);
  });

  // F-1 (T-26 closed): reproduces the operat Aneta issued, to the złoty.
  it("reproduces the operat's printed 447 300 zł", () => {
    const result = computeKcs(piastowskieInput());
    expect(result.csr).toBe(fixture.expected.csr);
    expect(result.sumUi).toBe(fixture.expected.sumUi);
    expect(result.unitValue).toBe(fixture.expected.unitValue);
    expect(result.wr).toBe(fixture.expected.wr);
    expect(result.wr).toBe(fixture.operatWr);
  });

  // I-11: what Tabela 3 prints is what ΣUi is made of.
  it("sums the printed Ui rows into ΣUi", () => {
    const result = computeKcs(piastowskieInput());
    expect(result.ui.map((share) => share.value)).toEqual([0.4, 0.214, 0.321, 0.107]);
    const printed = result.ui.reduce((sum, share) => sum + share.value, 0);
    expect(Math.round(printed * 1000) / 1000).toBe(result.sumUi);
  });
});
