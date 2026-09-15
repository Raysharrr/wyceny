import { describe, expect, it } from "vitest";
import { FEATURE_SCALE_RULE } from "../src/domain/feature-rules";
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
  it("draft without the marker: described rating stays, undescribed → null, wr → null", () => {
    const read = readFeatureScale(valuation({}));
    expect(read.wr).toBeNull();
    expect(read.inputs!.features.map((f) => f.rating)).toEqual(["przecietna", null]);
    expect(read.inputs!.featureScaleRule).toBeUndefined();
  });

  it("the cleared rating is an explicit null, so jsonb keeps the key", () => {
    const read = readFeatureScale(valuation({}));
    expect(JSON.parse(JSON.stringify(read.inputs!.features[1]))).toHaveProperty("rating", null);
  });

  it("draft saved under the rule is returned unchanged", () => {
    const current = valuation({}, { featureScaleRule: FEATURE_SCALE_RULE });
    expect(readFeatureScale(current)).toBe(current);
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

  it("the step-4 save stamps the marker", () => {
    const saved = applyFeaturesUpdate(readFeatureScale(valuation({})), {
      features: LEGACY_FEATURES.map((f) => ({ ...f, rating: "lepsza" })),
      provenance: {
        weights: { source: "rzeczoznawca", status: "confirmed" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
        featureDefs: { source: "rzeczoznawca", status: "confirmed" },
      },
    });
    expect(saved.inputs!.featureScaleRule).toBe(FEATURE_SCALE_RULE);
    expect(readFeatureScale(saved)).toBe(saved);
  });
});
