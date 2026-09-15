import { describe, expect, it } from "vitest";
import { computeKcsOnScale } from "../src/domain/feature-rules";
import type { Feature, KcsInput } from "../src/domain/kcs";
import { applyFeaturesUpdate, readFeatureScale } from "../src/domain/valuation";
import type { Valuation } from "../src/ports/valuation";

/**
 * ADR-016 „Migracja danych” (spec §12a runda 2): a draft saved before the
 * rule has no marker. On read its ratings on a DESCRIBED level stay (they wait
 * for a new confirmation, B-11), ratings on an undescribed level are cleared
 * (B-08) and `wr` is dropped. Approved and signed valuations are left alone.
 * No SQL — `inputs` is jsonb.
 */

const TWO_LEVELS = { lepsza: "opis lepszej", przecietna: "opis przeciętnej" };

/** Every rating on a described level — a draft the rule has nothing to clear. */
const RATED_FEATURES: Feature[] = [
  { name: "Lokalizacja", weight: 0.5, rating: "przecietna", definitions: TWO_LEVELS },
  { name: "Powierzchnia użytkowa", weight: 0.5, rating: "lepsza", definitions: TWO_LEVELS },
];

const LEGACY_FEATURES: Feature[] = [
  { name: "Lokalizacja", weight: 0.5, rating: "przecietna", definitions: TWO_LEVELS },
  {
    name: "Powierzchnia użytkowa",
    weight: 0.5,
    rating: "przecietna",
    definitions: { lepsza: "poniżej 47 m²", gorsza: "47 m² i więcej" },
  },
];

function valuation(over: Partial<Valuation>, inputs: Partial<KcsInput> = {}): Valuation {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    address: "ul. Testowa 1, Poznań",
    area: 44.23,
    wr: 466_800,
    inputs: {
      comparables: [{ pricePerM2: 10000 }, { pricePerM2: 11000 }, { pricePerM2: 12000 }],
      area: 44.23,
      features: LEGACY_FEATURES,
      ...inputs,
    },
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: "sprzedaz",
    propertyRight: "wlasnosc_lokalu",
    kwNumber: null,
    client: "Klient Testowy",
    inspectionDate: "2026-09-01",
    ownerId: "u1",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    mapsFrozenFor: null,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...over,
  } as Valuation;
}

describe("readFeatureScale — legacy draft read (ADR-016)", () => {
  it("legacy draft: described rating stays, undescribed → null, wr → null", () => {
    const read = readFeatureScale(valuation({}));
    expect(read.wr).toBeNull();
    expect(read.inputs!.features.map((f) => f.rating)).toEqual(["przecietna", null]);
  });

  it("the cleared rating is an explicit null, so jsonb keeps the key", () => {
    const read = readFeatureScale(valuation({}));
    expect(JSON.parse(JSON.stringify(read.inputs!.features[1]))).toHaveProperty("rating", null);
  });

  // The whole migration is read off the data: a complete draft whose `wr` is
  // what the engine returns for its own snapshot is already correct, and comes
  // back untouched — same object, so no needless re-render.
  it("a draft whose wr follows from its snapshot is returned unchanged", () => {
    const current = valuation({}, { features: RATED_FEATURES });
    const priced = { ...current, wr: computeKcsOnScale(current.inputs!).wr };
    expect(readFeatureScale(priced)).toBe(priced);
  });

  // ...and the same draft with an amount computed under the old rule loses it,
  // which is what sends the appraiser back to step 5 (no marker needed).
  it("a complete draft whose wr predates the rule loses the amount", () => {
    const stale = valuation({ wr: 466_800 }, { features: RATED_FEATURES });
    const read = readFeatureScale(stale);
    expect(read.wr).toBeNull();
    expect(read.inputs!.features.map((f) => f.rating)).toEqual(["przecietna", "lepsza"]);
  });

  it("a draft that was never priced stays without an amount", () => {
    const unpriced = valuation({ wr: null }, { features: RATED_FEATURES });
    expect(readFeatureScale(unpriced)).toBe(unpriced);
  });

  it("approved and signed valuations are returned unchanged", () => {
    for (const status of ["approved", "signed"] as const) {
      const issued = valuation({ status });
      expect(readFeatureScale(issued)).toBe(issued);
    }
  });

  it("a draft without inputs or without features is returned unchanged", () => {
    const bare = valuation({ inputs: null });
    expect(readFeatureScale(bare)).toBe(bare);
    const noFeatures = valuation({}, { features: [] });
    expect(readFeatureScale(noFeatures)).toBe(noFeatures);
  });

  it("the step-4 save drops the amount, so step 5 confirms it again", () => {
    const saved = applyFeaturesUpdate(readFeatureScale(valuation({})), {
      features: LEGACY_FEATURES.map((f) => ({ ...f, rating: "lepsza" as const })),
      provenance: {
        weights: { source: "rzeczoznawca", status: "confirmed" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
        featureDefs: { source: "rzeczoznawca", status: "confirmed" },
      },
    });
    expect(saved.wr).toBeNull();
    expect(readFeatureScale(saved)).toBe(saved);
  });
});
