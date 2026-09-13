import type { KcsInput } from "../../src/domain/kcs";
import { comparableIdentity } from "../../src/domain/pairwise-state";
export function ppInputs(): KcsInput {
  const comparables = [0, 1, 2].map((i) => ({
    id: `00000000-0000-4000-8000-abc00000000${i}`,
    source: "manual" as const,
    status: "confirmed" as const,
    pricePerM2: 10000 + i * 100,
    area: 50,
  }));
  return {
    area: 50,
    method: "pp",
    methodConfirmed: true,
    comparables,
    features: [
      {
        key: "inne",
        name: "Widok",
        weight: 1,
        rating: "lepsza",
        ratingScale: "two",
        definitions: { lepsza: "Otwarty", gorsza: "Zamknięty" },
      },
    ],
    pairwise: {
      selectedComparableIds: comparables.map((c) => comparableIdentity(c)!),
      comparisons: Object.fromEntries(
        comparables.map((c) => [
          comparableIdentity(c)!,
          { inne: { rating: "lepsza", multiplier: 0 } },
        ]),
      ),
    },
  };
}
