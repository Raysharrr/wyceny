import { describe, expect, it } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";
import {
  AUDIT_ACTIONS,
  CalculationNotReadyError,
  applyCalculationConfirm,
  applyFeaturesUpdate,
  applyInspectionOp,
  applySampleUpdate,
  applySubjectUpdate,
  type FeaturesUpdate,
  type SampleUpdate,
  type SubjectUpdate,
} from "../src/domain/valuation";
import { WIZARD_STEPS, calculationReady, maxReachedStep, resolveStep } from "../src/domain/wizard";
import { computeKcs, type Comparable, type Feature, type KcsInput } from "../src/domain/kcs";

const VID = "11111111-2222-3333-4444-555555555555";

/**
 * Full-inputs fixture (F-9 synthetic data): builds on `approvableInput` (12
 * rcn comparables + geocode, mirrors inspection-domain.test.ts) and attaches
 * a subject + kw snapshot with a fully populated provenance map (address,
 * area, weights, ratings, geocode, ewidencja, mpzp, kw) — so "preserves the
 * rest of provenance" assertions have every key to check against.
 */
function fullInputs(): KcsInput {
  const base = approvableInput("owner-1").inputs!;
  return {
    ...base,
    subject: { obreb: "Jeżyce", nrDzialki: "161" },
    subjectMeta: {
      x: 1,
      y: 2,
      teryt: "306401",
      fetchedAt: "t",
      source: "geopoz-gugik",
      mpzpAbsent: false,
    },
    kw: {
      source: "odpis_kw",
      kwLokalu: "PO1P/1/6",
      kwGruntu: "PO1P/2/7",
      kwInne: [],
      deweloperski: false,
      powUzytkowaKw: 50,
      udzial: null,
      sad: null,
      wydzial: null,
      dataDokumentu: null,
      dzial3: null,
      dzial4: null,
    },
    kwMeta: {
      model: "test-model",
      extractedAt: "2026-07-14T09:00:00.000Z",
      docTypeDetected: "odpis_kw",
      docTypeDeclared: "odpis_kw",
    },
    provenance: {
      ...base.provenance!,
      ewidencja: { source: "ewidencja", status: "confirmed" },
      mpzp: { source: "mpzp", status: "confirmed" },
      kw: { source: "odpis_kw", status: "confirmed" },
    },
  };
}

const draft = (overrides: Partial<Valuation> = {}): Valuation =>
  ({
    id: VID,
    status: "in_progress",
    ownerId: "owner-1",
    wr: null,
    address: "ul. Testowa 1, Poznań",
    area: 50,
    purpose: "sprzedaz",
    kwNumber: "PO1P/1/6",
    client: "Jan Testowy",
    inspectionDate: null,
    inputs: fullInputs(),
    ...overrides,
  }) as unknown as Valuation;

describe("applySampleUpdate", () => {
  it("replaces comparables+sampleMeta, nulls wr, drops stale geocode when none provided, keeps rest of provenance", () => {
    const v = draft({ wr: 500_000 });
    const newComparables: Comparable[] = [
      { pricePerM2: 9_000, source: "manual", status: "confirmed" },
      { pricePerM2: 9_500, source: "manual", status: "confirmed" },
      { pricePerM2: 10_500, source: "manual", status: "confirmed" },
    ];
    const update: SampleUpdate = { comparables: newComparables, sampleMeta: null };

    const updated = applySampleUpdate(v, update);

    expect(updated.wr).toBeNull();
    expect(updated.inputs!.comparables).toEqual(newComparables);
    expect(updated.inputs!.sampleMeta).toBeNull();
    expect(updated.inputs!.provenance!.geocode).toBeUndefined();
    expect(updated.inputs!.provenance!.address).toEqual(v.inputs!.provenance!.address);
    expect(updated.inputs!.provenance!.weights).toEqual(v.inputs!.provenance!.weights);
    expect(updated.inputs!.provenance!.ewidencja).toEqual(v.inputs!.provenance!.ewidencja);
    expect(updated.inputs!.provenance!.kw).toEqual(v.inputs!.provenance!.kw);
  });

  it("sets a fresh geocode entry when one is provided", () => {
    const v = draft();
    const newGeocode = { source: "geokoder" as const, status: "to_verify" as const };
    const update: SampleUpdate = {
      comparables: v.inputs!.comparables,
      sampleMeta: v.inputs!.sampleMeta,
      geocode: newGeocode,
    };

    const updated = applySampleUpdate(v, update);

    expect(updated.inputs!.provenance!.geocode).toEqual(newGeocode);
  });
});

describe("applyFeaturesUpdate", () => {
  it("replaces features, nulls wr, merges weights/ratings/featureDefs, leaves geocode/ewidencja untouched", () => {
    const v = draft({ wr: 500_000 });
    const newFeatures: Feature[] = [{ name: "standard", weight: 1, rating: "lepsza" }];
    const newProvenance: FeaturesUpdate["provenance"] = {
      weights: { source: "rzeczoznawca", status: "confirmed" },
      ratings: { source: "rzeczoznawca", status: "confirmed" },
      featureDefs: { source: "rzeczoznawca", status: "confirmed" },
    };
    const update: FeaturesUpdate = { features: newFeatures, provenance: newProvenance };

    const updated = applyFeaturesUpdate(v, update);

    expect(updated.wr).toBeNull();
    expect(updated.inputs!.features).toEqual(newFeatures);
    expect(updated.inputs!.provenance!.weights).toEqual(newProvenance.weights);
    expect(updated.inputs!.provenance!.ratings).toEqual(newProvenance.ratings);
    expect(updated.inputs!.provenance!.featureDefs).toEqual(newProvenance.featureDefs);
    expect(updated.inputs!.provenance!.geocode).toEqual(v.inputs!.provenance!.geocode);
    expect(updated.inputs!.provenance!.ewidencja).toEqual(v.inputs!.provenance!.ewidencja);
  });
});

describe("applySubjectUpdate", () => {
  it("replaces subject columns + inputs slice, nulls wr, sets provenance carried by the fragment, keeps geocode/weights", () => {
    const v = draft({ wr: 500_000 });
    const update: SubjectUpdate = {
      address: "ul. Nowa 2, Poznań",
      area: 60,
      purpose: "zabezpieczenie_kredytu",
      kwNumber: "PO1P/9/9",
      client: "Anna Testowa",
      subject: { obreb: "Winiary", nrDzialki: "200" },
      subjectMeta: null,
      kw: { ...v.inputs!.kw!, kwGruntu: "PO1P/3/3" },
      kwMeta: null,
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        area: { source: "rzeczoznawca", status: "confirmed" },
        ewidencja: { source: "rzeczoznawca", status: "confirmed" },
        mpzp: { source: "rzeczoznawca", status: "confirmed" },
        kw: { source: "odpis_kw", status: "to_verify" },
      },
    };

    const updated = applySubjectUpdate(v, update);

    expect(updated.address).toBe(update.address);
    expect(updated.area).toBe(60);
    expect(updated.purpose).toBe("zabezpieczenie_kredytu");
    expect(updated.kwNumber).toBe("PO1P/9/9");
    expect(updated.client).toBe("Anna Testowa");
    expect(updated.wr).toBeNull();
    expect(updated.inputs!.area).toBe(60);
    expect(updated.inputs!.subject).toEqual(update.subject);
    expect(updated.inputs!.kw).toEqual(update.kw);
    expect(updated.inputs!.provenance!.ewidencja).toEqual(update.provenance.ewidencja);
    expect(updated.inputs!.provenance!.mpzp).toEqual(update.provenance.mpzp);
    expect(updated.inputs!.provenance!.kw).toEqual(update.provenance.kw);
    expect(updated.inputs!.provenance!.geocode).toEqual(v.inputs!.provenance!.geocode);
    expect(updated.inputs!.provenance!.weights).toEqual(v.inputs!.provenance!.weights);
  });

  it("drops stale ewidencja/mpzp/kw provenance when the fragment carries none of them (subject detached)", () => {
    const v = draft();
    const update: SubjectUpdate = {
      address: "ul. Manualna 5, Poznań",
      area: 40,
      purpose: "informacyjny",
      kwNumber: null,
      client: "Piotr Manualny",
      subject: null,
      subjectMeta: null,
      kw: null,
      kwMeta: null,
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        area: { source: "rzeczoznawca", status: "confirmed" },
      },
    };

    const updated = applySubjectUpdate(v, update);

    expect(updated.inputs!.provenance!.ewidencja).toBeUndefined();
    expect(updated.inputs!.provenance!.mpzp).toBeUndefined();
    expect(updated.inputs!.provenance!.kw).toBeUndefined();
    expect(updated.inputs!.provenance!.geocode).toEqual(v.inputs!.provenance!.geocode);
    expect(updated.inputs!.provenance!.weights).toEqual(v.inputs!.provenance!.weights);
    expect(updated.inputs!.subject).toBeNull();
    expect(updated.inputs!.kw).toBeNull();
  });
});

describe("applyCalculationConfirm", () => {
  it("sets wr from computeKcs when the draft has >=3 comparables and >=1 feature", () => {
    const v = draft();
    const updated = applyCalculationConfirm(v);
    expect(updated.wr).toBe(computeKcs(v.inputs!).wr);
  });

  it("throws CalculationNotReadyError with fewer than 3 comparables", () => {
    const v = draft({
      inputs: { ...fullInputs(), comparables: fullInputs().comparables.slice(0, 2) },
    });
    expect(() => applyCalculationConfirm(v)).toThrow(CalculationNotReadyError);
  });

  it("throws CalculationNotReadyError with zero features", () => {
    const v = draft({ inputs: { ...fullInputs(), features: [] } });
    expect(() => applyCalculationConfirm(v)).toThrow(CalculationNotReadyError);
  });
});

describe("apply* guard rails (assertDraft + missing-inputs, shared with confirm* siblings)", () => {
  const signed = draft({ status: "signed" });
  const noInputs = draft({ inputs: null });

  const sampleUpdate: SampleUpdate = { comparables: [], sampleMeta: null };
  const featuresUpdate: FeaturesUpdate = {
    features: [],
    provenance: {
      weights: { source: "rzeczoznawca", status: "confirmed" },
      ratings: { source: "rzeczoznawca", status: "confirmed" },
    },
  };
  const subjectUpdate: SubjectUpdate = {
    address: "ul. Guard 1",
    area: 1,
    purpose: "informacyjny",
    kwNumber: null,
    client: "Guard Testowy",
    subject: null,
    subjectMeta: null,
    kw: null,
    kwMeta: null,
    provenance: {
      address: { source: "rzeczoznawca", status: "confirmed" },
      area: { source: "rzeczoznawca", status: "confirmed" },
    },
  };

  it("applySubjectUpdate refuses non-draft and missing inputs", () => {
    expect(() => applySubjectUpdate(signed, subjectUpdate)).toThrow(/not a draft/);
    expect(() => applySubjectUpdate(noInputs, subjectUpdate)).toThrow(/no inputs/);
  });
  it("applySampleUpdate refuses non-draft and missing inputs", () => {
    expect(() => applySampleUpdate(signed, sampleUpdate)).toThrow(/not a draft/);
    expect(() => applySampleUpdate(noInputs, sampleUpdate)).toThrow(/no inputs/);
  });
  it("applyFeaturesUpdate refuses non-draft and missing inputs", () => {
    expect(() => applyFeaturesUpdate(signed, featuresUpdate)).toThrow(/not a draft/);
    expect(() => applyFeaturesUpdate(noInputs, featuresUpdate)).toThrow(/no inputs/);
  });
  it("applyCalculationConfirm refuses non-draft and missing inputs", () => {
    expect(() => applyCalculationConfirm(signed)).toThrow(/not a draft/);
    expect(() => applyCalculationConfirm(noInputs)).toThrow(/no inputs/);
  });
});

describe("applyInspectionOp set_date", () => {
  it("sets inspectionDate from the op, mapping the empty string to null, without touching inputs", () => {
    const v = draft();
    const updated = applyInspectionOp(v, { kind: "set_date", date: "2026-07-20" });
    expect(updated.inspectionDate).toBe("2026-07-20");
    expect(updated.inputs).toBe(v.inputs);

    const cleared = applyInspectionOp(v, { kind: "set_date", date: "" });
    expect(cleared.inspectionDate).toBeNull();
  });
});

describe("AUDIT_ACTIONS gained the four wizard actions", () => {
  it("contains subject_updated, sample_updated, features_updated, calculation_confirmed", () => {
    expect(AUDIT_ACTIONS).toContain("subject_updated");
    expect(AUDIT_ACTIONS).toContain("sample_updated");
    expect(AUDIT_ACTIONS).toContain("features_updated");
    expect(AUDIT_ACTIONS).toContain("calculation_confirmed");
    expect(AUDIT_ACTIONS).toHaveLength(13);
  });
});

describe("WIZARD_STEPS", () => {
  it("has 7 steps with the exact Polish labels", () => {
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual([
      "Przedmiot",
      "Oględziny",
      "Próba",
      "Cechy",
      "Kalkulacja",
      "Opisy",
      "Operat",
    ]);
    expect(WIZARD_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("maxReachedStep", () => {
  it("partial draft (no comparables, no features) -> 3", () => {
    const v = {
      status: "in_progress" as const,
      wr: null,
      inputs: { ...fullInputs(), comparables: [], features: [] },
    };
    expect(maxReachedStep(v)).toBe(3);
  });
  it("draft with comparables but no features -> 4", () => {
    const v = {
      status: "in_progress" as const,
      wr: null,
      inputs: { ...fullInputs(), features: [] },
    };
    expect(maxReachedStep(v)).toBe(4);
  });
  it("draft with features -> 5", () => {
    const v = { status: "in_progress" as const, wr: null, inputs: fullInputs() };
    expect(maxReachedStep(v)).toBe(5);
  });
  it("wr set -> 7 regardless of comparables/features", () => {
    const v = { status: "in_progress" as const, wr: 500_000, inputs: fullInputs() };
    expect(maxReachedStep(v)).toBe(7);
  });
  it("status approved -> 7", () => {
    const v = { status: "approved" as const, wr: null, inputs: fullInputs() };
    expect(maxReachedStep(v)).toBe(7);
  });
});

describe("resolveStep", () => {
  it("undefined param resolves to max", () => {
    expect(resolveStep(undefined, 5)).toBe(5);
  });
  it("a valid numeric param within range resolves to itself", () => {
    expect(resolveStep("2", 5)).toBe(2);
  });
  it("out-of-range, non-numeric, and zero params fall back to/clamp at max", () => {
    expect(resolveStep("9", 5)).toBe(5);
    expect(resolveStep("x", 5)).toBe(5);
    expect(resolveStep("0", 5)).toBe(5);
  });
});

describe("calculationReady", () => {
  it("null inputs -> false", () => {
    expect(calculationReady(null)).toBe(false);
  });
  it("fewer than 3 comparables -> false", () => {
    expect(
      calculationReady({ ...fullInputs(), comparables: fullInputs().comparables.slice(0, 2) }),
    ).toBe(false);
  });
  it("3+ comparables and at least 1 feature -> true", () => {
    expect(
      calculationReady({ ...fullInputs(), comparables: fullInputs().comparables.slice(0, 3) }),
    ).toBe(true);
  });
});
