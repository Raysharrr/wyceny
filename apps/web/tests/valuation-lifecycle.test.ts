import { describe, expect, it } from "vitest";
import {
  ApprovalBlockedError,
  approveValuation,
  confirmFeaturesProvenance,
  confirmKwProvenance,
  confirmSampleProvenance,
  confirmSubjectProvenance,
} from "../src/domain/valuation";
import type { Valuation } from "../src/ports/valuation";
import type { KcsInput } from "../src/domain/kcs";
import type { InputsProvenance } from "../src/domain/provenance";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
};

function draftWith(inputs: KcsInput | null, overrides: Partial<Valuation> = {}): Valuation {
  return {
    id: "v-1",
    address: "ul. Testowa 1, Poznań",
    area: 50,
    wr: 500_000,
    inputs,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    // Document fields present by default so the gate-passing tests also clear
    // the document-field blockers (spec §4). The legacy-draft test overrides
    // them to null to prove approval blocks on a missing purpose/kw/etc.
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "p. Jan Testowy",
    inspectionDate: "2026-07-01",
    ownerId: "owner-1",
    status: "in_progress",
    approvedAt: null,
    createdAt: new Date("2026-07-14T10:00:00Z"),
    ...overrides,
  };
}

function rcnInputs(): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
      status: "to_verify" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    sampleMeta: {
      lat: 52.4,
      lon: 16.9,
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "rcn-wfs-gugik",
      query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
    },
    provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "to_verify" } },
  };
}

describe("confirmSampleProvenance", () => {
  it("flips rcn rows and geocode to confirmed, leaves scalars untouched", () => {
    const v = confirmSampleProvenance(draftWith(rcnInputs()));
    expect(v.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    expect(v.inputs!.provenance!.geocode).toEqual({ source: "geokoder", status: "confirmed" });
    expect(v.inputs!.provenance!.address.status).toBe("confirmed");
    expect(v.status).toBe("in_progress");
  });

  it("does not touch manual rows (already confirmed) and is idempotent", () => {
    const first = confirmSampleProvenance(draftWith(rcnInputs()));
    const second = confirmSampleProvenance(first);
    expect(second.inputs).toEqual(first.inputs);
  });

  it("throws when the valuation is not a draft", () => {
    const approved = { ...draftWith(rcnInputs()), status: "approved" as const };
    expect(() => confirmSampleProvenance(approved)).toThrow(/draft/i);
  });

  it("throws when there is no inputs snapshot", () => {
    expect(() => confirmSampleProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

function subjectInputs(): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    subject: { obreb: "Jeżyce", nrDzialki: "161" },
    subjectMeta: {
      x: 1,
      y: 2,
      teryt: "306401",
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "geopoz-gugik",
      mpzpAbsent: false,
    },
    provenance: {
      ...confirmedScalars,
      ewidencja: { source: "ewidencja", status: "to_verify" },
      mpzp: { source: "mpzp", status: "to_verify" },
    },
  };
}

describe("confirmSubjectProvenance", () => {
  it("flips ewidencja and mpzp to confirmed", () => {
    const v = confirmSubjectProvenance(draftWith(subjectInputs()));
    expect(v.inputs!.provenance!.ewidencja).toEqual({ source: "ewidencja", status: "confirmed" });
    expect(v.inputs!.provenance!.mpzp).toEqual({ source: "mpzp", status: "confirmed" });
  });

  it("no-op on legacy inputs without subject", () => {
    const legacy = draftWith(rcnInputs());
    const v = confirmSubjectProvenance(legacy);
    expect(v.inputs).toEqual(legacy.inputs);
  });

  it("throws when the valuation is not a draft (mirrors confirmSampleProvenance's guard — F-7)", () => {
    const approved = { ...draftWith(subjectInputs()), status: "approved" as const };
    expect(() => confirmSubjectProvenance(approved)).toThrow(/draft/i);
  });

  it("throws when there is no inputs snapshot (mirrors confirmSampleProvenance's guard)", () => {
    expect(() => confirmSubjectProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

function kwInputs(provenanceOverrides: Partial<InputsProvenance> = {}): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    provenance: { ...confirmedScalars, ...provenanceOverrides },
  };
}

describe("confirmKwProvenance (Slice 6)", () => {
  it("flips kw and document-sourced area to confirmed, leaves others", () => {
    const v = draftWith(
      kwInputs({
        kw: { source: "akt", status: "to_verify" },
        area: { source: "akt", status: "to_verify" },
      }),
    );
    const out = confirmKwProvenance(v);
    expect(out.inputs!.provenance!.kw!.status).toBe("confirmed");
    expect(out.inputs!.provenance!.area.status).toBe("confirmed");
  });

  it("does not touch manual area provenance", () => {
    const v = draftWith(
      kwInputs({
        kw: { source: "odpis_kw", status: "to_verify" },
      }),
    );
    const out = confirmKwProvenance(v);
    expect(out.inputs!.provenance!.area.source).toBe("rzeczoznawca");
  });

  it("throws on non-draft and on missing inputs (F-7 guards)", () => {
    const approved = {
      ...draftWith(kwInputs({ kw: { source: "akt", status: "to_verify" } })),
      status: "approved" as const,
    };
    expect(() => confirmKwProvenance(approved)).toThrow();
    expect(() => confirmKwProvenance(draftWith(null))).toThrow();
  });
});

describe("confirmFeaturesProvenance (Slice 7)", () => {
  it("flips weights + featureDefs to confirmed, draft-only", () => {
    const draft = draftWith(
      kwInputs({
        weights: { source: "preset", status: "to_verify" },
        featureDefs: { source: "preset", status: "to_verify" },
      }),
    );
    const updated = confirmFeaturesProvenance(draft);
    expect(updated.inputs!.provenance!.weights).toEqual({ source: "preset", status: "confirmed" });
    expect(updated.inputs!.provenance!.featureDefs).toEqual({
      source: "preset",
      status: "confirmed",
    });
  });

  it("on legacy provenance (no featureDefs) flips weights only", () => {
    const draft = draftWith(kwInputs({ weights: { source: "preset", status: "to_verify" } }));
    const updated = confirmFeaturesProvenance(draft);
    expect(updated.inputs!.provenance!.featureDefs).toBeUndefined();
    expect(updated.inputs!.provenance!.weights.status).toBe("confirmed");
  });

  it("throws on non-draft and on missing inputs (F-7 guards)", () => {
    const approved = {
      ...draftWith(kwInputs({ weights: { source: "preset", status: "to_verify" } })),
      status: "approved" as const,
    };
    expect(() => confirmFeaturesProvenance(approved)).toThrow(/draft/i);
    expect(() => confirmFeaturesProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

describe("approveValuation", () => {
  const now = new Date("2026-07-14T12:00:00Z");

  it("blocks (ApprovalBlockedError with blockers) while anything is to_verify", () => {
    try {
      approveValuation(draftWith(rcnInputs()), now);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.length).toBeGreaterThan(0);
    }
  });

  it("approves after confirmation: status approved + approvedAt set", () => {
    const confirmed = confirmSampleProvenance(draftWith(rcnInputs()));
    const approved = approveValuation(confirmed, now);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe(now);
  });

  it("blocks a snapshot-less draft", () => {
    expect(() => approveValuation(draftWith(null), now)).toThrow(ApprovalBlockedError);
  });

  it("throws for non-draft status (write-once after approval)", () => {
    const approved = {
      ...confirmSampleProvenance(draftWith(rcnInputs())),
      status: "approved" as const,
    };
    expect(() => approveValuation(approved, now)).toThrow(/draft/i);
  });

  it("blocks a legacy draft missing document fields, naming purpose (spec §4)", () => {
    const legacy = confirmSampleProvenance(
      draftWith(rcnInputs(), {
        purpose: null,
        kwNumber: null,
        client: null,
        inspectionDate: null,
      }),
    );
    try {
      approveValuation(legacy, now);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.map((b) => b.path)).toContain("purpose");
    }
  });

  it("persists docUrl + docxUrl when passed, alongside status approved", () => {
    const confirmed = confirmSampleProvenance(draftWith(rcnInputs()));
    const approved = approveValuation(confirmed, now, {
      docUrl: "/api/docs/operat-x.pdf",
      docxUrl: "/api/docs/operat-x.docx",
    });
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe(now);
    expect(approved.docUrl).toBe("/api/docs/operat-x.pdf");
    expect(approved.docxUrl).toBe("/api/docs/operat-x.docx");
  });
});
