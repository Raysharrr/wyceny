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
 * and never from the worker. rcn rows enter to_verify (the appraiser must
 * bulk-confirm them on the detail page); manual entry by the appraiser is
 * confirmed by definition (AI-first: humans only confirm what they didn't
 * type themselves).
 */
export function assignProvenance(
  values: Pick<
    ValuationFormValues,
    "comparables" | "features" | "sampleMeta" | "subject" | "subjectMeta" | "kw" | "kwMeta" | "area"
  >,
): {
  comparables: Comparable[];
  provenance: InputsProvenance;
} {
  const comparables: Comparable[] = values.comparables.map((c) => ({
    ...c,
    source: c.source ?? "manual",
    status: c.source === "rcn" ? "to_verify" : "confirmed",
  }));

  const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;

  // The area field is doc-sourced (to_verify) only when a kw extract is
  // attached AND its powUzytkowaKw exactly matches the submitted area — i.e.
  // the appraiser accepted the document's value rather than typing their own.
  const areaFromDocument =
    values.kw != null &&
    values.kw.powUzytkowaKw != null &&
    Number(values.area) === values.kw.powUzytkowaKw;

  // Preset detection (Slice 7, brainstorm decision 5): server-side comparison
  // against the expected preset — the client cannot fake a manual edit. The
  // powierzchnia threshold is recomputed here from the SUBMITTED comparables,
  // so a median-prefilled definition still counts as the app's proposal.
  const median = medianAreaM2(values.comparables.map((c) => c.area));
  const presetWeights = matchesPresetWeights(values.features);
  const presetDefs = matchesPresetDefinitions(values.features, median);

  const provenance: InputsProvenance = {
    address: confirmed,
    area: areaFromDocument ? { source: values.kw!.source, status: "to_verify" } : confirmed,
    weights: presetWeights ? ({ source: "preset", status: "to_verify" } as const) : confirmed,
    ratings: confirmed,
    featureDefs: presetDefs ? ({ source: "preset", status: "to_verify" } as const) : confirmed,
    ...(values.sampleMeta ? { geocode: { source: "geokoder", status: "to_verify" } as const } : {}),
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

  return { comparables, provenance };
}
