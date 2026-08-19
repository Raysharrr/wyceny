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
import {
  WIZARD_STEPS,
  calculationReady,
  maxReachedStep,
  resolveStep,
  stepForBlockerPath,
} from "../src/domain/wizard";
import { computeKcs, type Comparable, type Feature, type KcsInput } from "../src/domain/kcs";
import { approvalGate, type GateInput, type InputsProvenance } from "../src/domain/provenance";
import { documentFieldBlockers } from "../src/domain/document-model";

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

/** A provenance map as it looks before anything geocoded the draft. */
function withoutGeocode(p: InputsProvenance): InputsProvenance {
  const copy = { ...p };
  delete copy.geocode;
  return copy;
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
  it("replaces comparables+sampleMeta, nulls wr, keeps the whole provenance map", () => {
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
    expect(updated.inputs!.provenance).toEqual(v.inputs!.provenance);
  });

  /**
   * T7 (routed from the T6 review): step 3 owns the transactions and nothing
   * else. Re-stamping `geocode` here meant one corrected transaction price
   * wiped a geocoding confirmation given on step 1 — exactly the annoyance
   * T6 existed to remove, surviving in the one key T6 did not cover.
   */
  it("leaves a geocode confirmation alone — a corrected price is not a new geocoding", () => {
    const base = draft();
    const confirmedGeocode = { source: "geokoder" as const, status: "confirmed" as const };
    const v = draft({
      inputs: {
        ...base.inputs!,
        provenance: { ...base.inputs!.provenance!, geocode: confirmedGeocode },
      },
    });

    const updated = applySampleUpdate(v, {
      comparables: v.inputs!.comparables.map((c, i) => (i === 0 ? { ...c, pricePerM2: 9_999 } : c)),
      sampleMeta: v.inputs!.sampleMeta ?? null,
    });

    expect(updated.inputs!.provenance!.geocode).toEqual(confirmedGeocode);
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
    // The address moved, so the geocoding it resolved to is a different point
    // and goes back for verification with the rest of the step-1 group (T7).
    expect(updated.inputs!.provenance!.geocode).toEqual({
      source: "geokoder",
      status: "to_verify",
    });
    expect(updated.inputs!.provenance!.weights).toEqual(v.inputs!.provenance!.weights);
  });

  // The counterpart of the test above, and the reason `wr` is no longer nulled
  // unconditionally: the F-4 gate can send an appraiser back to this step for
  // a reason that has nothing to do with the amount — a draft geocoded by the
  // step-3 RCN fetch has to return here for its `geocode` entry — and the
  // detour used to cost them the confirmed calculation, plus a paid prose
  // regeneration when the facts hash moved with it.
  it("keeps a confirmed wr when the area did not move, even as everything else changes", () => {
    const v = draft({ wr: 500_000 });
    const update: SubjectUpdate = {
      address: "ul. Testowa 1, Poznań",
      // Whatever the fixture holds — the ONE field of this step `computeKcs`
      // reads, so leaving it alone is what the amount's survival hangs on.
      area: v.inputs!.area,
      purpose: "zabezpieczenie_kredytu",
      kwNumber: "PO1P/9/9",
      client: "Anna Testowa",
      subject: v.inputs!.subject,
      subjectMeta: v.inputs!.subjectMeta,
      kw: v.inputs!.kw,
      kwMeta: v.inputs!.kwMeta,
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        area: { source: "rzeczoznawca", status: "confirmed" },
      },
    };

    const updated = applySubjectUpdate(v, update);

    expect(updated.wr).toBe(500_000);
    // The fields that DID change still land — the amount surviving is not the
    // save quietly doing nothing.
    expect(updated.purpose).toBe("zabezpieczenie_kredytu");
    expect(updated.client).toBe("Anna Testowa");
    expect(updated.kwNumber).toBe("PO1P/9/9");
  });

  it("nulls wr as soon as the area moves, however small the move", () => {
    const v = draft({ wr: 500_000 });
    const update: SubjectUpdate = {
      address: "ul. Testowa 1, Poznań",
      area: v.inputs!.area + 0.01,
      purpose: "sprzedaz",
      kwNumber: "PO1P/1/6",
      client: "Jan Testowy",
      subject: v.inputs!.subject,
      subjectMeta: v.inputs!.subjectMeta,
      kw: v.inputs!.kw,
      kwMeta: v.inputs!.kwMeta,
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        area: { source: "rzeczoznawca", status: "confirmed" },
      },
    };

    expect(applySubjectUpdate(v, update).wr).toBeNull();
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
    // Detaching the subject removes the step-1 fetch, but the sample's own
    // geocoding is still on file (sampleMeta), so the entry stays — and the
    // moved address sends it back for verification.
    expect(updated.inputs!.provenance!.geocode).toEqual({
      source: "geokoder",
      status: "to_verify",
    });
    expect(updated.inputs!.provenance!.weights).toEqual(v.inputs!.provenance!.weights);
    expect(updated.inputs!.subject).toBeNull();
    expect(updated.inputs!.kw).toBeNull();
  });

  /**
   * T7: `geocode` is a step-1 key — stamped here, confirmed by
   * `confirmSubjectProvenance`. It exists once something has actually
   * geocoded this draft's address: the step-1 EGiB/MPZP fetch
   * (`subjectMeta`) or the step-3 RCN fetch (`sampleMeta` — the worker
   * resolves the same address to a point). The second disjunct is what keeps
   * the F-4 gate REACHABLE: the gate demands the entry whenever `sampleMeta`
   * is set, so a draft that skipped the step-1 fetch would otherwise be
   * blocked on an entry no step could create.
   */
  const unchangedSubjectUpdate = (v: Valuation): SubjectUpdate => ({
    address: v.address,
    area: v.inputs!.area,
    purpose: "sprzedaz",
    kwNumber: v.kwNumber,
    client: v.client!,
    subject: v.inputs!.subject ?? null,
    subjectMeta: v.inputs!.subjectMeta ?? null,
    kw: v.inputs!.kw ?? null,
    kwMeta: v.inputs!.kwMeta ?? null,
    provenance: {
      address: { source: "rzeczoznawca", status: "confirmed" },
      area: { source: "rzeczoznawca", status: "confirmed" },
      ewidencja: { source: "ewidencja", status: "to_verify" },
      mpzp: { source: "mpzp", status: "to_verify" },
      kw: { source: "odpis_kw", status: "to_verify" },
    },
  });

  it("keeps the geocode confirmation when the address stands", () => {
    const base = draft();
    const v = draft({
      inputs: {
        ...base.inputs!,
        provenance: {
          ...base.inputs!.provenance!,
          geocode: { source: "geokoder", status: "confirmed" },
        },
      },
    });

    const updated = applySubjectUpdate(v, unchangedSubjectUpdate(v));

    expect(updated.inputs!.provenance!.geocode).toEqual({
      source: "geokoder",
      status: "confirmed",
    });
  });

  it("stamps an entry for a draft whose only geocoding arrived with the sample", () => {
    const base = draft();
    const provenance = withoutGeocode(base.inputs!.provenance!);
    const v = draft({
      inputs: { ...base.inputs!, subject: null, subjectMeta: null, provenance },
    });
    expect(v.inputs!.sampleMeta).not.toBeNull();

    const updated = applySubjectUpdate(v, {
      ...unchangedSubjectUpdate(v),
      subject: null,
      subjectMeta: null,
    });

    expect(updated.inputs!.provenance!.geocode).toEqual({
      source: "geokoder",
      status: "to_verify",
    });
  });

  it("stamps no entry when nothing has geocoded the draft", () => {
    const base = draft();
    const provenance = withoutGeocode(base.inputs!.provenance!);
    const v = draft({
      inputs: {
        ...base.inputs!,
        subject: null,
        subjectMeta: null,
        sampleMeta: null,
        provenance,
      },
    });

    const updated = applySubjectUpdate(v, {
      ...unchangedSubjectUpdate(v),
      subject: null,
      subjectMeta: null,
    });

    expect(updated.inputs!.provenance!.geocode).toBeUndefined();
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
    // 15 since ADR-014 added prose_generated (T5) and prose_confirmed (T6).
    expect(AUDIT_ACTIONS).toHaveLength(15);
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

/**
 * T8: step 7 stopped confirming, so every blocker it lists has to say WHERE
 * the appraiser fixes it. The mapping lives in the domain because it is the
 * same knowledge the wizard's step order already encodes, and because the
 * approve action and the step-7 card must not answer it differently.
 */
describe("stepForBlockerPath", () => {
  /** A draft that trips every group the F-4 gate knows how to block on. */
  function maximallyBlockedInput(): GateInput {
    return {
      comparables: [{ source: "rcn", status: "to_verify" }],
      sampleMeta: { lat: 1, lon: 2 },
      subject: { obreb: "Nowogród" },
      kw: { source: "odpis_kw", kwLokalu: null, kwGruntu: null, deweloperski: false },
      // `featureDefs` is gated only when the snapshot carries the key, so it
      // has to be present here or the enumeration would silently skip it.
      provenance: {
        featureDefs: { source: "preset", status: "to_verify" },
      } as InputsProvenance,
    };
  }

  function blockerPaths(input: GateInput, options?: Parameters<typeof approvalGate>[1]): string[] {
    const gate = approvalGate(input, options);
    return gate.ok ? [] : gate.blockers.map((b) => b.path);
  }

  /**
   * The guard that matters: a path nobody mapped renders a blocker with no way
   * out, which is the T8 failure mode in miniature. Enumerated from the gate
   * and the document check themselves rather than hand-listed, so a new
   * blocker cannot be added without either a mapping or a red test.
   */
  it("names a step for every path the gate and the document check can emit", () => {
    const emptyDocument = {
      purpose: null,
      kwNumber: null,
      client: null,
      inspectionDate: null,
      wr: null,
    } as Parameters<typeof documentFieldBlockers>[0];
    const paths = new Set([
      // prose absent -> the snapshot-level blocker
      ...blockerPaths(maximallyBlockedInput(), { requireProse: true }),
      // prose present but unread -> one blocker per section
      ...blockerPaths(
        { ...maximallyBlockedInput(), prose: { sections: {}, factsHashes: {} } },
        { requireProse: true },
      ),
      ...documentFieldBlockers(emptyDocument).map((b) => b.path),
    ]);

    // Sanity: the enumeration really did reach every group — sample size + one
    // transaction (2), the four scalars + featureDefs + geocode + EGiB + MPZP +
    // KW (9), the two KW numbers (2), the prose snapshot + its six sections
    // (7), the five document fields (5). A drop here means a group stopped
    // being exercised, and the loop below would then pass vacuously.
    expect(paths.size).toBe(25);
    for (const path of paths) {
      expect(stepForBlockerPath(path), `no step for blocker path "${path}"`).toBeDefined();
    }
  });

  it.each([
    ["provenance.address", 1, "Przedmiot"],
    ["provenance.area", 1, "Przedmiot"],
    ["provenance.geocode", 1, "Przedmiot"],
    ["provenance.ewidencja", 1, "Przedmiot"],
    ["provenance.mpzp", 1, "Przedmiot"],
    ["provenance.kw", 1, "Przedmiot"],
    ["kw.kwGruntu", 1, "Przedmiot"],
    ["kw.kwLokalu", 1, "Przedmiot"],
    ["purpose", 1, "Przedmiot"],
    ["kwNumber", 1, "Przedmiot"],
    ["client", 1, "Przedmiot"],
    ["inspectionDate", 2, "Oględziny"],
    ["comparables", 3, "Próba"],
    ["comparables[11]", 3, "Próba"],
    ["provenance.weights", 4, "Cechy"],
    ["provenance.ratings", 4, "Cechy"],
    ["provenance.featureDefs", 4, "Cechy"],
    ["wr", 5, "Kalkulacja"],
    ["prose", 6, "Opisy"],
    ["prose.uzasadnienie", 6, "Opisy"],
  ])("%s belongs to step %i (%s)", (path, n, label) => {
    expect(stepForBlockerPath(path)).toEqual({ n, label });
  });

  /**
   * No guessing. `inputs` is a real path (`approveValuation` throws it for a
   * draft with no snapshot) that no step can fix by itself, and an unmapped
   * `provenance.*` key must not inherit a sibling's step — a link to a screen
   * that cannot clear the blocker costs the appraiser a round trip and teaches
   * them to distrust the next one.
   */
  it("returns undefined for a path it does not own, rather than a nearby step", () => {
    expect(stepForBlockerPath("inputs")).toBeUndefined();
    expect(stepForBlockerPath("provenance")).toBeUndefined();
    expect(stepForBlockerPath("provenance.somethingNew")).toBeUndefined();
    expect(stepForBlockerPath("")).toBeUndefined();
  });
});
