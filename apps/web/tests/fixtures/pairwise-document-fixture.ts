import { FEATURE_PRESETS } from "../../src/domain/feature-presets";
import { comparableIdentity } from "../../src/domain/pairwise-state";
import type { ValuationInput } from "../../src/domain/valuation-input";
export function pairwiseReference(which: "a" | "b"): ValuationInput {
  const a = which === "a";
  const totals = a ? [510000, 1068000, 694000] : [350000, 359000, 300000];
  const areas = a ? [51.2, 108.81, 71.3] : [49.9, 50.7, 42.2];
  const weights = a ? [0.4, 0.4, 0.1, 0.1] : [0.2, 0.2, 0.3, 0.2, 0.1];
  const multipliers = a
    ? [
        [0, 1, 1],
        [-0.5, 0.5, 0],
        [1, 0, 1],
        [1, 0, 1],
      ]
    : [
        [0, -1, -1],
        [-1, 0, 0],
        [0, 0, -1],
        [0, 1, 1],
        [1, 0, 0],
      ];
  const comparables = totals.map((total, i) => ({
    id: ["a", "b", "c"][i],
    source: "manual" as const,
    date: `2026-0${i + 1}-15`,
    area: areas[i],
    pricePerM2: total / areas[i],
  }));
  return {
    method: "pp",
    area: a ? 74.63 : 48.1,
    comparables,
    features: weights.map((weight, i) => ({
      key: FEATURE_PRESETS.lokal[i].key,
      name: FEATURE_PRESETS.lokal[i].name,
      weight,
      rating: "przecietna",
    })),
    pairwise: {
      selectedComparableIds: comparables.map((c) => comparableIdentity(c)!),
      comparisons: Object.fromEntries(
        comparables.map((c, col) => [
          comparableIdentity(c),
          Object.fromEntries(
            weights.map((_, row) => [
              FEATURE_PRESETS.lokal[row].key,
              {
                rating: "przecietna",
                multiplier: multipliers[row][col],
                ...(multipliers[row][col] !== 0
                  ? { overrideReason: "Współczynnik przyjęty w arkuszu referencyjnym" }
                  : {}),
              },
            ]),
          ),
        ]),
      ),
    },
  };
}
