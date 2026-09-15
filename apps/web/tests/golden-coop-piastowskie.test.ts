import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FEATURE_SCALE_RULE,
  computeKcs,
  type FeatureRating,
  type KcsInput,
} from "../src/domain/kcs";

/**
 * Golden "Piastowskie" (T-12, S4; spec 2026-09-12 §7.1) — the only end-to-end
 * reference for a spółdzielcze własnościowe prawo do lokalu, and the proof of
 * the ADR-016 rounding convention. The same 15-row sample, two rules:
 *
 *   without the marker (as issued)  ΣUi 1,041 → 10 311,59 → 446 900
 *   with `featureScaleRule` (T-26)  ΣUi 1,042 → 10 321,50 → 447 300 = operat
 *
 * The operat prints every Ui of Tabela 3 at 3 dp and adds up the printed
 * column, so rounding each Ui before the sum reproduces it TO THE ZŁOTY. The
 * legacy test below stays: a snapshot saved before the rule must keep printing
 * the amount it was issued with (Kościelna gives 1 044 400 under both rules —
 * no feature there lands on a third decimal).
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
  expectedOnScale: { csr: number; sumUi: number; unitValue: number; wr: number };
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

  it("without the marker keeps the amount it was issued with: WR = 446 900 zł", () => {
    const result = computeKcs(piastowskieInput());
    expect(result.csr).toBe(fixture.expected.csr);
    expect(result.sumUi).toBe(fixture.expected.sumUi);
    expect(result.unitValue).toBe(fixture.expected.unitValue);
    expect(result.wr).toBe(fixture.expected.wr);
  });

  // F-1 under the ADR-016 rule (T-26 closed): Ui rounded per row reproduces the
  // operat Aneta issued, to the złoty. The features carry no `definitions` —
  // the marker turns on the ROUNDING.ui step in the engine, the position
  // mapping lives one level up in `computeKcsOnScale`.
  it("reproduces the operat's printed 447 300 zł under featureScaleRule", () => {
    const result = computeKcs({ ...piastowskieInput(), featureScaleRule: FEATURE_SCALE_RULE });
    expect(result.csr).toBe(fixture.expectedOnScale.csr);
    expect(result.sumUi).toBe(fixture.expectedOnScale.sumUi);
    expect(result.unitValue).toBe(fixture.expectedOnScale.unitValue);
    expect(result.wr).toBe(fixture.expectedOnScale.wr);
    expect(result.wr).toBe(fixture.operatWr);
  });

  // I-11: what Tabela 3 prints is what ΣUi is made of.
  it("sums the printed Ui rows into ΣUi", () => {
    const result = computeKcs({ ...piastowskieInput(), featureScaleRule: FEATURE_SCALE_RULE });
    const printed = result.ui.reduce((sum, share) => sum + share.value, 0);
    expect(Math.round(printed * 1000) / 1000).toBe(result.sumUi);
  });
});
