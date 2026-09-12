import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeKcs, type FeatureRating, type KcsInput } from "../src/domain/kcs";

/**
 * Golden "Piastowskie" (T-12, S4; spec 2026-09-12 §7.1) — the only end-to-end
 * reference for a spółdzielcze własnościowe prawo do lokalu. It shows what the
 * engine DOES on the appraiser's own 15-row sample, not what the operat printed:
 *
 *   sheet (full precision)          ΣUi 1,0415049  → 447 121,20 → 447 100
 *   operat, Tabela 4 (ΣUi at 3 dp)  ΣUi 1,042      → 447 333,81 → 447 300
 *   this engine (ROUNDING)          ΣUi 1,041      → 446 904,31 → 446 900
 *
 * The −429,50 zł (−0,10 %) gap has ONE cause: `computeKcs` rounds vmin/vmax to
 * 3 dp BEFORE multiplying by the weights, while the sheet and the operat
 * multiply by V in full precision and round only ΣUi. F-1 (Kościelna) passes to
 * the złoty only because no feature there is rated "przeciętna". The engine is
 * deliberately NOT changed here (block decision 4) — follow-up T-26.
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

  it("reproduces WR = 446 900 zł under the engine's rounding convention", () => {
    const result = computeKcs(piastowskieInput());
    expect(result.csr).toBe(fixture.expected.csr);
    expect(result.sumUi).toBe(fixture.expected.sumUi);
    expect(result.unitValue).toBe(fixture.expected.unitValue);
    expect(result.wr).toBe(fixture.expected.wr);
  });

  // A DOCUMENTED deviation from the operat's 447 300 zł, not a proof of
  // correctness: see the header. The bound is tight enough to catch a wrong
  // rating enum ("najwyższa" would silently fall into the `w` branch and give
  // 429 300) and loose enough to admit the rounding-convention gap.
  it("stays within 0,15 % of the operat's printed 447 300 zł (rounding convention gap)", () => {
    const { wr } = computeKcs(piastowskieInput());
    expect(Math.abs(wr - fixture.operatWr) / fixture.operatWr).toBeLessThan(0.0015);
    expect(wr).not.toBe(fixture.operatWr);
  });
});
