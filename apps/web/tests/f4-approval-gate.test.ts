import { describe, expect, it } from "vitest";
import {
  approvalGate,
  REQUIRED_SAMPLE_SIZE,
  type InputsProvenance,
} from "../src/domain/provenance";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
};

function manualRows(n: number) {
  return Array.from({ length: n }, () => ({
    source: "manual" as const,
    status: "confirmed" as const,
  }));
}

describe("F-4: approvalGate (aggregate invariant, default-deny)", () => {
  it("passes with >=12 confirmed rows and a fully confirmed scalar map (no sample fetch)", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result).toEqual({ ok: true });
  });

  it("blocks when any comparable is to_verify, naming the row", () => {
    const rows = manualRows(12);
    rows[2] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({
      comparables: rows,
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].path).toBe("comparables[2]");
      expect(result.blockers[0].label).toContain("do weryfikacji");
    }
  });

  it("blocks a comparable with MISSING status as none (default-deny)", () => {
    const rows: Array<{ source?: "rcn" | "manual"; status?: never }> = manualRows(11) as never;
    rows.push({ source: "manual" });
    const result = approvalGate({
      comparables: rows as never,
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers[0].path).toBe("comparables[11]");
      expect(result.blockers[0].label).toContain("brak prowenancji");
    }
  });

  it(`blocks below ${REQUIRED_SAMPLE_SIZE} transactions even when everything is confirmed`, () => {
    const result = approvalGate({
      comparables: manualRows(11),
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].path).toBe("comparables");
      expect(result.blockers[0].label).toContain("co najmniej 12");
    }
  });

  it("blocks when the scalar provenance map is missing entirely (default-deny: 4 blockers)", () => {
    const result = approvalGate({ comparables: manualRows(12), sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.map((b) => b.path)).toEqual([
        "provenance.address",
        "provenance.area",
        "provenance.weights",
        "provenance.ratings",
      ]);
    }
  });

  it("requires a confirmed geocode entry when sampleMeta is present", () => {
    const withMeta = { lat: 52.4, lon: 16.9 };
    const noGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: confirmedScalars,
    });
    expect(noGeocode.ok).toBe(false);
    if (!noGeocode.ok) expect(noGeocode.blockers[0].path).toBe("provenance.geocode");

    const toVerifyGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "to_verify" } },
    });
    expect(toVerifyGeocode.ok).toBe(false);

    const confirmedGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "confirmed" } },
    });
    expect(confirmedGeocode).toEqual({ ok: true });
  });

  it("does NOT require geocode when there was no sample fetch (sampleMeta absent/null)", () => {
    expect(approvalGate({ comparables: manualRows(12), provenance: confirmedScalars })).toEqual({
      ok: true,
    });
  });

  it("collects ALL blockers at once (count + rows + scalars)", () => {
    const rows = manualRows(3);
    rows[0] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({ comparables: rows, sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 1 count blocker + 1 row blocker + 4 scalar blockers
      expect(result.blockers).toHaveLength(6);
    }
  });

  it("blocks approval when subject fetched but not confirmed", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { obreb: "Jeżyce" },
      provenance: {
        ...confirmedScalars,
        ewidencja: { source: "ewidencja", status: "to_verify" },
        mpzp: { source: "mpzp", status: "to_verify" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.blockers.map((b) => b.path);
      expect(paths).toContain("provenance.ewidencja");
      expect(paths).toContain("provenance.mpzp");
    }
  });

  it("blocks when subject present but provenance entries missing (default-deny)", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { obreb: "X" },
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
  });

  it("passes with subject groups confirmed", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      subject: { obreb: "Jeżyce" },
      provenance: {
        ...confirmedScalars,
        ewidencja: { source: "ewidencja", status: "confirmed" },
        mpzp: { source: "mpzp", status: "confirmed" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("does not gate subject when subject absent (legacy)", () => {
    expect(
      approvalGate({ comparables: manualRows(12), sampleMeta: null, provenance: confirmedScalars }),
    ).toEqual({ ok: true });
  });
});

describe("kw group (Slice 6)", () => {
  function passingInput() {
    return { comparables: manualRows(12), sampleMeta: null, provenance: confirmedScalars };
  }

  const kwOk = {
    source: "akt" as const,
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    deweloperski: false,
  };

  it("blocks when kw snapshot present but provenance kw missing (default-deny)", () => {
    const result = approvalGate({ ...passingInput(), kw: kwOk });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.some((b) => b.path === "provenance.kw")).toBe(true);
    }
  });

  it("blocks on to_verify, passes on confirmed", () => {
    const base = passingInput();
    const toVerify = approvalGate({
      ...base,
      kw: kwOk,
      provenance: { ...base.provenance, kw: { source: "akt", status: "to_verify" } },
    });
    expect(toVerify.ok).toBe(false);
    const confirmed = approvalGate({
      ...base,
      kw: kwOk,
      provenance: { ...base.provenance, kw: { source: "akt", status: "confirmed" } },
    });
    expect(confirmed.ok).toBe(true);
  });

  it("blocks missing kwGruntu and missing kwLokalu (non-developer)", () => {
    const base = passingInput();
    const prov = {
      ...base.provenance,
      kw: { source: "akt" as const, status: "confirmed" as const },
    };
    const noGrunt = approvalGate({ ...base, provenance: prov, kw: { ...kwOk, kwGruntu: null } });
    expect(noGrunt.ok).toBe(false);
    const noLokal = approvalGate({ ...base, provenance: prov, kw: { ...kwOk, kwLokalu: null } });
    expect(noLokal.ok).toBe(false);
  });

  it("developer variant: missing kwLokalu is fine when deweloperski", () => {
    const base = passingInput();
    const result = approvalGate({
      ...base,
      provenance: { ...base.provenance, kw: { source: "akt", status: "confirmed" } },
      kw: { ...kwOk, kwLokalu: null, deweloperski: true },
    });
    expect(result.ok).toBe(true);
  });

  it("no kw snapshot -> no kw blockers (manual path regression)", () => {
    expect(approvalGate(passingInput()).ok).toBe(true);
  });
});

describe("featureDefs group (Slice 7)", () => {
  it("featureDefs to_verify blocks with a Polish label; legacy provenance without the key does not", () => {
    const blocked = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: { ...confirmedScalars, featureDefs: { source: "preset", status: "to_verify" } },
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockers.map((b) => b.path)).toContain("provenance.featureDefs");
      expect(blocked.blockers.find((b) => b.path === "provenance.featureDefs")!.label).toBe(
        "Definicje skali ocen — do weryfikacji.",
      );
    }

    // legacy: no featureDefs key at all → no blocker
    expect(
      approvalGate({ comparables: manualRows(12), sampleMeta: null, provenance: confirmedScalars })
        .ok,
    ).toBe(true);
  });
});
