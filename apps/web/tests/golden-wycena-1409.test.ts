import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeKcs, type FeatureRating, type KcsInput } from "../src/domain/kcs";

/**
 * Golden "14.09" (ADR-016, P5) — the valuation Aneta reported: her operat
 * prints ΣUi 1,022 and WR 467 300 zł, the engine gave 1,021 / 466 800 zł. Two
 * causes, both fixed by ADR-016: Ui follows the rating's POSITION in the
 * described scale (`feature-rules.ts`), and every Ui is rounded before the sum
 * (this file, ROUNDING.ui).
 *
 * Aggregates only (F-9): the 20 unit prices are synthetic numbers that hit the
 * operat's Cmin/Cmax/Cśr, not the transactions themselves. The ratings are
 * already the engine's keys (the position mapping is tested in
 * `feature-rules.test.ts`), so this golden calls `computeKcs` directly — like
 * `golden-wr` and `golden-coop-piastowskie`.
 */
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/wycena-1409-agregaty.json", import.meta.url)),
    "utf8",
  ),
) as {
  subjectArea: number;
  pricesPerM2: number[];
  features: { name: string; weight: number; rating: FeatureRating }[];
  expected: { csr: number; sumUi: number; unitValue: number; wr: number };
  operatWr: number;
};

function input1409(): KcsInput {
  return {
    area: fixture.subjectArea,
    comparables: fixture.pricesPerM2.map((pricePerM2) => ({
      pricePerM2,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: fixture.features,
  };
}

describe("KCS engine — 14.09 reference operat (ADR-016)", () => {
  it("reproduces the operat's 467 300 zł", () => {
    const result = computeKcs(input1409());
    expect(result.csr).toBe(fixture.expected.csr);
    expect(result.vmin).toBe(0.875);
    expect(result.vmax).toBe(1.154);
    expect(result.sumUi).toBe(fixture.expected.sumUi);
    expect(result.unitValue).toBe(fixture.expected.unitValue);
    expect(result.wr).toBe(fixture.operatWr);
  });

  // I-11: the Ui the operat prints are the Ui that make up ΣUi — the rows that
  // move the amount are lokalizacja and pomieszczenia, 0,0875 summed as 0,088.
  it("sums the printed Ui rows into ΣUi", () => {
    const { ui, sumUi } = computeKcs(input1409());
    expect(ui.map((share) => share.value)).toEqual([0.4, 0.346, 0.088, 0.1, 0.088]);
    expect(Math.round(ui.reduce((sum, share) => sum + share.value, 0) * 1000) / 1000).toBe(sumUi);
  });
});
