import type { Comparable } from "@/domain/kcs";
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
  values: Pick<ValuationFormValues, "comparables" | "sampleMeta" | "subject" | "subjectMeta">,
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
  const provenance: InputsProvenance = {
    address: confirmed,
    area: confirmed,
    weights: confirmed,
    ratings: confirmed,
    ...(values.sampleMeta ? { geocode: { source: "geokoder", status: "to_verify" } as const } : {}),
    ...(values.subject
      ? {
          ewidencja: values.subjectMeta
            ? ({ source: "ewidencja", status: "to_verify" } as const)
            : confirmed,
          mpzp: values.subjectMeta ? ({ source: "mpzp", status: "to_verify" } as const) : confirmed,
        }
      : {}),
  };

  return { comparables, provenance };
}
