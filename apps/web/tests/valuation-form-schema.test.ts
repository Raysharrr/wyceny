import { describe, expect, it } from "vitest";
import { valuationFormSchema } from "../src/lib/valuation-form-schema";

const valid = {
  address: "ul. Kościelna 33A, Poznań",
  area: 71.63,
  comparables: [
    { date: "2024-07", area: 63.27, pricePerM2: 14698.91 },
    { date: "2024-06", area: 61.35, pricePerM2: 12061.94 },
    { date: "2024-04", area: 76.41, pricePerM2: 12629.24 },
  ],
  features: [
    { name: "standard wykończenia", weightPct: 40, rating: "lepsza" },
    { name: "położenie na piętrze", weightPct: 30, rating: "lepsza" },
    { name: "lokalizacja", weightPct: 10, rating: "przecietna" },
    { name: "powierzchnia użytkowa", weightPct: 10, rating: "gorsza" },
    { name: "pomieszczenia przynależne", weightPct: 4, rating: "przecietna" },
    { name: "dodatkowe", weightPct: 6, rating: "przecietna" },
  ],
};

describe("valuationFormSchema", () => {
  it("accepts a valid payload", () => {
    expect(valuationFormSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects fewer than 3 comparables", () => {
    const r = valuationFormSchema.safeParse({
      ...valid,
      comparables: valid.comparables.slice(0, 2),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-positive price", () => {
    const r = valuationFormSchema.safeParse({
      ...valid,
      comparables: [...valid.comparables.slice(0, 2), { pricePerM2: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects weights that do not sum to 100%", () => {
    const features = valid.features.map((f, i) => (i === 0 ? { ...f, weightPct: 50 } : f));
    expect(valuationFormSchema.safeParse({ ...valid, features }).success).toBe(false);
  });

  it("accepts weights within the ±0.1 p.p. tolerance", () => {
    const features = valid.features.map((f, i) => (i === 0 ? { ...f, weightPct: 40.05 } : f));
    expect(valuationFormSchema.safeParse({ ...valid, features }).success).toBe(true);
  });
});
