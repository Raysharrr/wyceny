import type { Comparable } from "@/domain/kcs";
import {
  matchesPresetDefinitions,
  matchesPresetWeights,
  medianAreaM2,
} from "@/domain/feature-presets";
import type { InputsProvenance } from "@/domain/provenance";
import type { ValuationFormValues } from "@/lib/valuation-form-schema";

/**
 * The ADR-010 ACL: provenance statuses are assigned HERE, server-side,
 * derived from the trusted source tag — never accepted from the client
 * and never from the worker. rcn rows enter to_verify (since T7 the step's
 * own save confirms them, while the data is on screen); manual entry by the
 * appraiser is confirmed by definition (AI-first: humans only confirm what
 * they didn't type themselves).
 */
export function assignSubjectProvenance(
  values: Pick<ValuationFormValues, "area" | "subject" | "subjectMeta" | "kw" | "kwMeta">,
): Pick<InputsProvenance, "address" | "area"> &
  Partial<Pick<InputsProvenance, "ewidencja" | "mpzp" | "kw">> {
  const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
  // The area field is doc-sourced (to_verify) only when a kw extract is
  // attached AND its powUzytkowaKw exactly matches the submitted area — i.e.
  // the appraiser accepted the document's value rather than typing their own.
  const areaFromDocument =
    values.kw != null &&
    values.kw.powUzytkowaKw != null &&
    Number(values.area) === values.kw.powUzytkowaKw;
  return {
    address: confirmed,
    area: areaFromDocument ? { source: values.kw!.source, status: "to_verify" } : confirmed,
    ...(values.subject
      ? {
          ewidencja: values.subjectMeta
            ? ({ source: "ewidencja", status: "to_verify" } as const)
            : confirmed,
          mpzp: values.subjectMeta ? ({ source: "mpzp", status: "to_verify" } as const) : confirmed,
        }
      : {}),
    ...(values.kw ? { kw: { source: values.kw.source, status: "to_verify" } as const } : {}),
  };
}

/**
 * Step-3's ACL. Returns the comparables ALONE: since T7 this step assigns no
 * provenance entry at all. `geocode` describes the address, so step 1 stamps
 * it (`applySubjectUpdate`) and step 1 confirms it — re-deriving it here made
 * a corrected transaction price cost the appraiser a geocoding confirmation
 * they had already given.
 */
export function assignSampleProvenance(
  values: Pick<ValuationFormValues, "comparables">,
): Comparable[] {
  return values.comparables.map((c) => {
    // The source is DERIVED, not taken on the client's word — the same rule
    // the prose fingerprints and the FR-6 gate flag already follow: a check
    // the caller can talk its way out of is not a check. Only the RCN fetch
    // hands out a transactionId (the form has no input for one), so an id is
    // evidence the server can verify and the label is not.
    //
    // Trust moves one way only. An id PROMOTES a row to rcn (re-verification
    // required); its absence never DEMOTES an rcn label to manual, or a row
    // saved before ids existed would confirm itself on the next save.
    //
    // This rule sees only the REQUEST, so it cannot catch a row that arrives
    // with the id stripped AND the label rewritten. `promoteStoredRcnRows`
    // (domain/valuation.ts) closes that from the other side, against the
    // snapshot the write transaction holds locked — the comparison needs a
    // row this layer cannot read without a race.
    const source = c.transactionId ? "rcn" : (c.source ?? "manual");
    return { ...c, source, status: source === "rcn" ? "to_verify" : "confirmed" };
  });
}

export function assignFeaturesProvenance(
  features: ValuationFormValues["features"],
  comparableAreas: Array<number | undefined>,
): Pick<InputsProvenance, "weights" | "ratings" | "featureDefs"> {
  const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
  // Preset detection (Slice 7, brainstorm decision 5): server-side comparison
  // against the expected preset — the client cannot fake a manual edit. The
  // powierzchnia threshold is recomputed here from the SUBMITTED comparables,
  // so a median-prefilled definition still counts as the app's proposal.
  const median = medianAreaM2(comparableAreas);
  return {
    weights: matchesPresetWeights(features)
      ? ({ source: "preset", status: "to_verify" } as const)
      : confirmed,
    ratings: confirmed,
    featureDefs: matchesPresetDefinitions(features, median)
      ? ({ source: "preset", status: "to_verify" } as const)
      : confirmed,
  };
}

/**
 * The whole-form ACL from the single-screen era (the wizard calls the three
 * scoped functions above instead, one per step). It keeps stamping `geocode`
 * off `sampleMeta` because on ONE screen the address and the sample were read
 * together; in the wizard that entry is step 1's, and `applySubjectUpdate`
 * stamps it there.
 */
export function assignProvenance(
  values: Pick<
    ValuationFormValues,
    "comparables" | "features" | "sampleMeta" | "subject" | "subjectMeta" | "kw" | "kwMeta" | "area"
  >,
): { comparables: Comparable[]; provenance: InputsProvenance } {
  return {
    comparables: assignSampleProvenance(values),
    provenance: {
      ...assignSubjectProvenance(values),
      ...assignFeaturesProvenance(
        values.features,
        values.comparables.map((c) => c.area),
      ),
      ...(values.sampleMeta
        ? { geocode: { source: "geokoder", status: "to_verify" } as const }
        : {}),
    },
  };
}
