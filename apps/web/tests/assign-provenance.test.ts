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
    });
    expect(comparables[0].status).toBe("to_verify");
  });

  it("scalars are rzeczoznawca/confirmed; geocode present+to_verify only with sampleMeta", () => {
    const withFetch = assignProvenance({ comparables: [], sampleMeta });
    expect(withFetch.provenance.address).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.weights).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.geocode).toEqual({ source: "geokoder", status: "to_verify" });

    const manualOnly = assignProvenance({ comparables: [], sampleMeta: undefined });
    expect(manualOnly.provenance.geocode).toBeUndefined();
  });
});
