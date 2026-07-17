import { describe, expect, it } from "vitest";
import { subjectSchema, valuationFormSchema } from "../src/lib/valuation-form-schema";

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
  purpose: "sprzedaz",
  kwNumber: "KW-TEST-1",
  client: "p. Jan Testowy",
  inspectionDate: "2026-07-01",
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

describe("valuationFormSchema — document fields (Slice 4)", () => {
  const base = {
    address: "ul. Testowa 1",
    area: 50,
    comparables: [{ pricePerM2: 10000 }, { pricePerM2: 11000 }, { pricePerM2: 12000 }],
    features: [{ name: "cecha", weightPct: 100, rating: "przecietna" }],
  };

  it("requires the four document fields with Polish messages", () => {
    const missing = valuationFormSchema.safeParse(base);
    expect(missing.success).toBe(false);

    const full = valuationFormSchema.safeParse({
      ...base,
      purpose: "sprzedaz",
      kwNumber: "KW-TEST-1",
      client: "p. Jan Testowy",
      inspectionDate: "2026-07-01",
    });
    expect(full.success).toBe(true);
  });

  it("rejects an unknown purpose", () => {
    const parsed = valuationFormSchema.shape.purpose.safeParse("wynajem");
    expect(parsed.success).toBe(false);
  });

  it("surfaces the Polish message (not zod v4's English default) for a missing/empty/unknown purpose", () => {
    // zod v4's z.enum routes every non-matching value — including an absent
    // key — through `invalid_value`, which honours the schema's `message`
    // option. Asserted for all three shapes the field can arrive in
    // (absent key, "" from the select's placeholder option, and a bogus
    // string) so a future zod upgrade that changes this routing is caught.
    for (const input of [undefined, "", "wynajem"]) {
      const parsed = valuationFormSchema.shape.purpose.safeParse(input);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe("Wybierz cel wyceny.");
    }
  });
});

describe("valuationFormSchema — RCN provenance (F-5)", () => {
  const sampleMeta = {
    lat: 52.4064,
    lon: 16.9252,
    fetchedAt: "2026-07-14T09:00:00.000Z",
    source: "rcn-wfs-gugik",
    query: { bbox: [52.39, 16.9, 52.42, 16.95], count: 5000, sort: "dok_data D" },
  };

  it("accepts provenance fields on a comparable (source + transactionId)", () => {
    const comparables = [
      ...valid.comparables.slice(0, 2),
      { ...valid.comparables[2], source: "rcn", transactionId: "abc-123" },
    ];
    expect(valuationFormSchema.safeParse({ ...valid, comparables }).success).toBe(true);
  });

  it("rejects an unknown source value", () => {
    const comparables = [
      ...valid.comparables.slice(0, 2),
      { ...valid.comparables[2], source: "bogus" },
    ];
    expect(valuationFormSchema.safeParse({ ...valid, comparables }).success).toBe(false);
  });

  it("keeps validating a manual comparable without provenance fields (backward compatible)", () => {
    expect(valuationFormSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an optional sampleMeta object", () => {
    expect(valuationFormSchema.safeParse({ ...valid, sampleMeta }).success).toBe(true);
  });

  it("still validates when sampleMeta is absent", () => {
    expect(valuationFormSchema.safeParse(valid).success).toBe(true);
  });
});

describe("subjectSchema — mpzpData (Fix B)", () => {
  it("rejects a Polish free-text date with the Polish message", () => {
    const r = subjectSchema.safeParse({ mpzpData: "26.02.2019" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("Podaj datę w formacie RRRR-MM-DD.");
    }
  });

  it("accepts an ISO YYYY-MM-DD date", () => {
    expect(subjectSchema.safeParse({ mpzpData: "2019-02-26" }).success).toBe(true);
  });

  it("accepts an empty or absent mpzpData", () => {
    expect(subjectSchema.safeParse({ mpzpData: "" }).success).toBe(true);
    expect(subjectSchema.safeParse({}).success).toBe(true);
  });
});
