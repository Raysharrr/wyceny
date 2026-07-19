/**
 * Sourced<T> — the provenance Shared Kernel (ADR-010). Strictly bounded:
 * this file holds provenance types + two helpers and MUST NOT grow beyond
 * provenance. `status` is assigned only at the web-side ACL boundary; the
 * worker/source can never inject "confirmed".
 */
export type ProvenanceSource =
  | "geokoder"
  | "ewidencja"
  | "mpzp"
  | "odpis_kw"
  | "akt"
  | "rcn"
  | "ogledziny"
  | "rzeczoznawca"
  | "preset";

export type ProvenanceStatus = "confirmed" | "to_verify" | "none";

export type Provenance = { source: ProvenanceSource; status: ProvenanceStatus };

export type Sourced<T> = { value: T; provenance: Provenance };

// No default status — "no silent defaults" (AC-3) applies to the kernel itself.
export function sourced<T>(
  value: T,
  source: ProvenanceSource,
  status: ProvenanceStatus,
): Sourced<T> {
  return { value, provenance: { source, status } };
}

export function isBlocking(s: Sourced<unknown>): boolean {
  return s.provenance.status !== "confirmed";
}
