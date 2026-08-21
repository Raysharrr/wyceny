import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURES,
  subjectSchema,
  valuationFormSchema,
} from "../src/lib/valuation-form-schema";
import { sampleSelectionSchema, streetViewSchema } from "../src/lib/valuation-form-schema";

const valid = {
  address: "ul. Kościelna 33A, Poznań",
  area: 71.63,
  comparables: [
    { date: "2024-07", area: 63.27, pricePerM2: 14698.91 },
    { date: "2024-06", area: 61.35, pricePerM2: 12061.94 },
    { date: "2024-04", area: 76.41, pricePerM2: 12629.24 },
  ],
  features: [
    { key: "standard-wykonczenia", name: "standard wykończenia", weightPct: 40, rating: "lepsza" },
    { key: "polozenie-na-pietrze", name: "położenie na piętrze", weightPct: 30, rating: "lepsza" },
    { key: "lokalizacja", name: "lokalizacja", weightPct: 10, rating: "przecietna" },
    {
      key: "powierzchnia-uzytkowa",
      name: "powierzchnia użytkowa",
      weightPct: 10,
      rating: "gorsza",
    },
    {
      key: "pomieszczenia-przynalezne",
      name: "pomieszczenia przynależne",
      weightPct: 4,
      rating: "przecietna",
    },
    { key: "dodatkowe", name: "dodatkowe", weightPct: 6, rating: "przecietna" },
  ],
  purpose: "sprzedaz",
  kwNumber: "KW-TEST-1",
  client: "p. Jan Testowy",
  inspectionDate: "2026-07-01",
};

/** Fresh deep copy — new tests mutate `values.features`, must not leak into `valid`. */
function validPayload(): typeof valid {
  return structuredClone(valid);
}

describe("valuationFormSchema", () => {
  it("accepts a valid payload", () => {
    expect(valuationFormSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a feature key outside the pool", () => {
    const values = validPayload();
    values.features = [
      { key: "wlasna-cecha", name: "własna", weightPct: 100, rating: "przecietna" },
    ];
    expect(valuationFormSchema.safeParse(values).success).toBe(false);
  });

  it("rejects duplicate feature keys", () => {
    const values = validPayload();
    values.features = [
      { key: "lokalizacja", name: "lokalizacja", weightPct: 50, rating: "przecietna" },
      { key: "lokalizacja", name: "lokalizacja", weightPct: 50, rating: "lepsza" },
    ];
    const result = valuationFormSchema.safeParse(values);
    expect(result.success).toBe(false);
  });

  it("accepts optional per-level definitions and DEFAULT_FEATURES parses", () => {
    const values = validPayload();
    values.features = DEFAULT_FEATURES.map((f) => ({ ...f }));
    expect(valuationFormSchema.safeParse(values).success).toBe(true);
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
    features: [{ key: "dodatkowe", name: "cecha", weightPct: 100, rating: "przecietna" }],
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
    point: { x: 355300.15, y: 505330.31, source: "subject" as const },
    maxRadiusM: 3000,
    counts: { fetched: 15000, deduped: 1200, noPos: 0 },
    fetchedAt: "2026-07-14T09:00:00.000Z",
    source: "rcn-wfs-gugik" as const,
    query: {
      bbox: [52.39, 16.9, 52.42, 16.95],
      count: 5000,
      sort: "dok_data D",
      pages: 3,
      truncated: false,
    },
  };

  it("accepts provenance fields on a comparable (source + transactionId)", () => {
    const comparables = [
      ...valid.comparables.slice(0, 2),
      { ...valid.comparables[2], source: "rcn", transactionId: "abc-123" },
    ];
    expect(valuationFormSchema.safeParse({ ...valid, comparables }).success).toBe(true);
  });

  it("accepts a lokalId on a comparable (multi-lokal act, final wave); still validates without one", () => {
    const withLokalId = [
      ...valid.comparables.slice(0, 2),
      {
        ...valid.comparables[2],
        source: "rcn",
        transactionId: "abc-123",
        lokalId: "306401_1.0039.AR_22.13-82.1_BUD.1_LOK",
      },
    ];
    expect(valuationFormSchema.safeParse({ ...valid, comparables: withLokalId }).success).toBe(
      true,
    );
    // No lokalId at all — legacy/manual rows keep validating.
    const withoutLokalId = [
      ...valid.comparables.slice(0, 2),
      { ...valid.comparables[2], source: "rcn", transactionId: "abc-123" },
    ];
    expect(valuationFormSchema.safeParse({ ...valid, comparables: withoutLokalId }).success).toBe(
      true,
    );
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

describe("kw section (Slice 6)", () => {
  const kwValid = {
    source: "akt" as const,
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    kwInne: [],
    deweloperski: false,
    powUzytkowaKw: 69.56,
    udzial: "1234/56789",
    sad: "Sąd Rejonowy",
    wydzial: "VI Wydział Ksiąg Wieczystych",
    dataDokumentu: "2026-05-11",
    dzial3: null,
    dzial4: null,
  };

  it("accepts a form with kw extract and NO kwNumber", () => {
    const parsed = valuationFormSchema.safeParse({
      ...valid,
      kwNumber: undefined,
      kw: kwValid,
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires kwNumber when no kw extract (manual path)", () => {
    const parsed = valuationFormSchema.safeParse({ ...valid, kwNumber: undefined });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join(".") === "kwNumber")).toBe(true);
    }
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

describe("sampleSelectionSchema — v3 additive fields (Slice 3)", () => {
  const base = {
    version: 3,
    proposed: [],
    alternates: [],
    flags: {},
    rejectedCounts: {},
    radiusUsedM: 500,
    radiusWalk: [],
    counts: { pool: 1, inRadius: 1, afterHygiene: 1, afterBand: 1, proposed: 0 },
    params: { subjectArea: 50, todayMonth: "2026-08" },
  };
  it("accepts a pre-Slice-3 snapshot (no rejected / manualRejections)", () => {
    expect(sampleSelectionSchema.safeParse(base).success).toBe(true);
  });
  it("accepts compact rejected rows and manual rejections; rejects an unknown reason", () => {
    const ok = sampleSelectionSchema.safeParse({
      ...base,
      rejected: [
        {
          transactionId: "T1",
          lokalId: "L1",
          reason: "no_price",
          allReasons: ["no_price"],
          date: "2026-01-02",
          area: 50,
          pricePerM2: 0,
          distanceM: 10,
          pos: null,
        },
      ],
      manualRejections: [
        {
          transactionId: "T2",
          lokalId: "L2",
          reason: "building_older",
          note: "kamienica 1905",
          at: "2026-08-21T10:00:00Z",
        },
      ],
    });
    expect(ok.success).toBe(true);
    const bad = sampleSelectionSchema.safeParse({
      ...base,
      manualRejections: [{ transactionId: "T2", lokalId: "L2", reason: "ugly", at: "x" }],
    });
    expect(bad.success).toBe(false);
  });
  it("accepts manualInclusions and reviewed (Slice 3c); parses back without stripping them (nested candidate included)", () => {
    const candidate = {
      transactionId: "T3",
      date: "2026-05-10",
      area: 50,
      pricePerM2: 12000,
      priceTotal: 600000,
      egib: {
        teryt: "306401_1",
        obreb: "0021",
        arkusz: "10",
        dzialka: "27",
        budynek: "3",
        lokal: "3",
      },
      lokalId: "L3",
      distanceM: 500,
      floor: 2,
      rooms: 3,
      market: "wtorny" as const,
      share: "1/1",
      transType: "wolnyRynek",
      function: "mieszkalna",
      seller: "osobaFizyczna",
      pos: { x: 123.45, y: 678.9 },
    };
    const parsed = sampleSelectionSchema.safeParse({
      ...base,
      manualInclusions: [
        { transactionId: "T3", lokalId: "L3", at: "2026-08-21T10:00:00Z", candidate },
      ],
      reviewed: [{ transactionId: "T1", lokalId: "L1", at: "2026-08-21T10:00:00Z" }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.manualInclusions).toHaveLength(1);
    expect(parsed.data.reviewed).toHaveLength(1);
    // Nested-strip guard: egib and pos are objects nested inside candidateSchema —
    // confirms zod isn't silently dropping their fields on the way through.
    expect(parsed.data.manualInclusions![0].candidate).toEqual(candidate);

    const bad = sampleSelectionSchema.safeParse({
      ...base,
      manualInclusions: [{ transactionId: "T3", lokalId: "L3", at: "x" }], // missing candidate
    });
    expect(bad.success).toBe(false);
  });
  it("still pins version 3", () => {
    expect(sampleSelectionSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
  });
  it("streetViewSchema: record of frozen entries, nulls allowed", () => {
    expect(
      streetViewSchema.safeParse({
        "0039.22.13/82.1": {
          panoId: null,
          captureDate: null,
          thumbnailKey: null,
          heading: null,
          lat: 52.39,
          lng: 16.87,
        },
      }).success,
    ).toBe(true);
  });
  it("streetViewSchema: storeysHint round-trips (present as a number, present as null, and absent for entries frozen before the field existed)", () => {
    const withHint = streetViewSchema.parse({
      "0039.22.13/82.1": {
        panoId: "P1",
        captureDate: "2023-07",
        thumbnailKey: "streetview-0039.22.13~82.1.jpg",
        heading: 90,
        lat: 52.39,
        lng: 16.87,
        storeysHint: 7,
      },
    });
    expect(withHint["0039.22.13/82.1"].storeysHint).toBe(7);
    const withNullHint = streetViewSchema.parse({
      "0039.22.13/82.2": {
        panoId: null,
        captureDate: null,
        thumbnailKey: null,
        heading: null,
        lat: 52.39,
        lng: 16.87,
        storeysHint: null,
      },
    });
    expect(withNullHint["0039.22.13/82.2"].storeysHint).toBeNull();
    const withoutHint = streetViewSchema.parse({
      "0039.22.13/82.3": {
        panoId: null,
        captureDate: null,
        thumbnailKey: null,
        heading: null,
        lat: 52.39,
        lng: 16.87,
      },
    });
    expect(withoutHint["0039.22.13/82.3"].storeysHint).toBeUndefined();
  });
});
