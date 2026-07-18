import { describe, expect, it } from "vitest";
import { assignProvenance } from "../src/lib/assign-provenance";

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
    });
    expect(comparables[0].status).toBe("to_verify");
  });

  it("scalars are rzeczoznawca/confirmed; geocode present+to_verify only with sampleMeta", () => {
    const withFetch = assignProvenance({ comparables: [], sampleMeta, area: 50 });
    expect(withFetch.provenance.address).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.weights).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.geocode).toEqual({ source: "geokoder", status: "to_verify" });

    const manualOnly = assignProvenance({ comparables: [], sampleMeta: undefined, area: 50 });
    expect(manualOnly.provenance.geocode).toBeUndefined();
  });

  it("marks subject groups to_verify when subjectMeta present (auto-fetched)", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      sampleMeta: undefined,
      area: 50,
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
      kw: { ...kwBase, source: "odpis_kw", powUzytkowaKw: 69.56 },
    });
    expect(provenance.kw).toEqual({ source: "odpis_kw", status: "to_verify" });
    expect(provenance.area).toEqual({ source: "odpis_kw", status: "to_verify" });
  });

  it("area differing from extract stays rzeczoznawca/confirmed", () => {
    const { provenance } = assignProvenance({
      comparables: [],
      area: 70,
      kw: { ...kwBase, powUzytkowaKw: 69.56 },
    });
    expect(provenance.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("no kw -> no kw provenance entry (regression)", () => {
    const { provenance } = assignProvenance({ comparables: [], area: 50 });
    expect(provenance.kw).toBeUndefined();
  });
});
