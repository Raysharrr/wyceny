import { describe, expect, it } from "vitest";
import {
  assignProvenance,
  assignFeaturesProvenance,
  assignSampleProvenance,
  assignSubjectProvenance,
} from "../src/lib/assign-provenance";
import { DEFAULT_FEATURES } from "../src/lib/valuation-form-schema";
import { powierzchniaDefinitions } from "../src/domain/feature-presets";

const sampleMeta = {
  lat: 52.4,
  lon: 16.9,
  fetchedAt: "2026-07-14T09:00:00.000Z",
  source: "rcn-wfs-gugik",
  query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
};

describe("assignProvenance (the ADR-010 ACL — statuses are born here, server-side only)", () => {
  it("rcn rows enter as to_verify, manual rows as confirmed/rzeczoznawca", () => {
    const { comparables } = assignProvenance({
      comparables: [
        { pricePerM2: 10_000, source: "rcn", transactionId: "tx-1" },
        { pricePerM2: 11_000, source: "manual" },
        { pricePerM2: 12_000 }, // no source tag = manual entry
      ],
      sampleMeta,
      area: 50,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
    });
    expect(comparables[0].status).toBe("to_verify");
    expect(comparables[1].status).toBe("confirmed");
    expect(comparables[2].status).toBe("confirmed");
    expect(comparables[2].source).toBe("manual");
  });

  it("overrides any client-claimed status (tampering is ignored)", () => {
    const { comparables } = assignProvenance({
      comparables: [
        { pricePerM2: 10_000, source: "rcn", transactionId: "tx-1", status: "confirmed" } as never,
      ],
      sampleMeta,
      area: 50,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
    });
    expect(comparables[0].status).toBe("to_verify");
  });

  it("scalars are rzeczoznawca/confirmed; geocode present+to_verify only with sampleMeta", () => {
    // Edited weight (not the untouched preset) so `weights` stays
    // rzeczoznawca/confirmed — this test is about the OTHER scalars/geocode,
    // not preset detection (that has its own describe block below).
    const editedFeatures = DEFAULT_FEATURES.map((f, i) =>
      i === 0 ? { ...f, weightPct: 39 } : { ...f },
    );
    const withFetch = assignProvenance({
      comparables: [],
      sampleMeta,
      area: 50,
      features: editedFeatures,
    });
    expect(withFetch.provenance.address).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.weights).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.geocode).toEqual({ source: "geokoder", status: "to_verify" });

    const manualOnly = assignProvenance({
      comparables: [],
      sampleMeta: undefined,
      area: 50,
      features: editedFeatures,
    });
    expect(manualOnly.provenance.geocode).toBeUndefined();
  });

  it("marks subject groups to_verify when subjectMeta present (auto-fetched)", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      sampleMeta: undefined,
      area: 50,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
      subject: { obreb: "Jeżyce", nrDzialki: "161" },
      subjectMeta: {
        x: 1,
        y: 2,
        teryt: "306401",
        fetchedAt: "t",
        source: "geopoz-gugik",
        mpzpAbsent: false,
      },
    });
    expect(provenance.ewidencja).toEqual({ source: "ewidencja", status: "to_verify" });
    expect(provenance.mpzp).toEqual({ source: "mpzp", status: "to_verify" });
  });

  it("marks subject groups confirmed for manual entry (no subjectMeta)", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      sampleMeta: undefined,
      area: 50,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
      subject: { obreb: "Jeżyce" },
      subjectMeta: undefined,
    });
    expect(provenance.ewidencja).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(provenance.mpzp).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("omits subject provenance when subject absent", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      sampleMeta: undefined,
      area: 50,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
      subject: undefined,
      subjectMeta: undefined,
    });
    expect(provenance.ewidencja).toBeUndefined();
    expect(provenance.mpzp).toBeUndefined();
  });
});

describe("kw provenance (Slice 6)", () => {
  const kwBase = {
    source: "akt" as const,
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    kwInne: [],
    deweloperski: false,
    powUzytkowaKw: null as number | null,
    udzial: null,
    sad: null,
    wydzial: null,
    dataDokumentu: null,
    dzial3: null,
    dzial4: null,
  };

  it("kw extract -> kw group to_verify; area matching extract -> doc-sourced to_verify", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      area: 69.56,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
      kw: { ...kwBase, source: "odpis_kw", powUzytkowaKw: 69.56 },
    });
    expect(provenance.kw).toEqual({ source: "odpis_kw", status: "to_verify" });
    expect(provenance.area).toEqual({ source: "odpis_kw", status: "to_verify" });
  });

  it("area differing from extract stays rzeczoznawca/confirmed", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      area: 70,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
      kw: { ...kwBase, powUzytkowaKw: 69.56 },
    });
    expect(provenance.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("no kw -> no kw provenance entry (regression)", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      area: 50,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
    });
    expect(provenance.kw).toBeUndefined();
  });
});

describe("feature preset provenance (Slice 7, server-side detection)", () => {
  const base = {
    comparables: [{ pricePerM2: 10_000 }, { pricePerM2: 11_000 }, { pricePerM2: 12_000 }],
    area: 50,
  };

  it("untouched preset bag → weights and featureDefs are preset/to_verify", () => {
    const { provenance } = assignProvenance({
      ...base,
      features: DEFAULT_FEATURES.map((f) => ({ ...f })),
    });
    expect(provenance.weights).toEqual({ source: "preset", status: "to_verify" });
    expect(provenance.featureDefs).toEqual({ source: "preset", status: "to_verify" });
    expect(provenance.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("edited weight → weights rzeczoznawca/confirmed (featureDefs independent)", () => {
    const features = DEFAULT_FEATURES.map((f, i) =>
      i === 0 ? { ...f, weightPct: 39 } : i === 1 ? { ...f, weightPct: 31 } : { ...f },
    );
    const { provenance } = assignProvenance({ ...base, features });
    expect(provenance.weights).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(provenance.featureDefs).toEqual({ source: "preset", status: "to_verify" });
  });

  it("added/removed feature → weights rzeczoznawca/confirmed", () => {
    const removed = DEFAULT_FEATURES.slice(1).map((f, i) =>
      i === 0 ? { ...f, weightPct: 70 } : { ...f },
    );
    expect(assignProvenance({ ...base, features: removed }).provenance.weights.source).toBe(
      "rzeczoznawca",
    );
  });

  it("edited definition → featureDefs rzeczoznawca/confirmed", () => {
    const features = DEFAULT_FEATURES.map((f, i) =>
      i === 0 ? { ...f, definitions: { ...f.definitions, lepsza: "własny opis" } } : { ...f },
    );
    expect(assignProvenance({ ...base, features }).provenance.featureDefs).toEqual({
      source: "rzeczoznawca",
      status: "confirmed",
    });
  });

  it("median-prefilled powierzchnia definitions still count as preset", () => {
    const comparables = [
      { pricePerM2: 10000, area: 50 },
      { pricePerM2: 10100, area: 60 },
      { pricePerM2: 10200, area: 70 },
    ];
    const features = DEFAULT_FEATURES.map((f) =>
      f.key === "powierzchnia-uzytkowa"
        ? { ...f, definitions: powierzchniaDefinitions(60) }
        : { ...f },
    );
    const { provenance } = assignProvenance({ ...base, comparables, features });
    expect(provenance.featureDefs).toEqual({ source: "preset", status: "to_verify" });
  });
});

describe("scoped provenance (Slice 11a)", () => {
  it("assignSubjectProvenance: no subject/kw → only address+area confirmed", () => {
    const p = assignSubjectProvenance({
      area: 54.3,
      subject: undefined,
      subjectMeta: undefined,
      kw: undefined,
      kwMeta: undefined,
    });
    expect(p).toEqual({
      address: { source: "rzeczoznawca", status: "confirmed" },
      area: { source: "rzeczoznawca", status: "confirmed" },
    });
  });
  it("assignSampleProvenance: rcn rows to_verify, manual confirmed, geocode only with sampleMeta", () => {
    const r = assignSampleProvenance({
      comparables: [
        { pricePerM2: 12000, source: "rcn", transactionId: "t1" },
        { pricePerM2: 13000 },
      ],
      sampleMeta: undefined,
    });
    expect(r.comparables[0]!.status).toBe("to_verify");
    expect(r.comparables[1]!.status).toBe("confirmed");
    expect(r.geocode).toBeUndefined();
  });
  it("assignFeaturesProvenance: preset weights → to_verify", () => {
    const p = assignFeaturesProvenance(DEFAULT_FEATURES, []);
    expect(p.weights).toEqual({ source: "preset", status: "to_verify" });
    expect(p.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });
});
