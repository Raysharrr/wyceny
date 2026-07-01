export type ProvenanceStatus = "confirmed" | "to_verify" | "none";
export type Provenance = { source: string; status: ProvenanceStatus };
export type Sourced<T> = { value: T; provenance: Provenance };

export function sourced<T>(value: T, source: string, status: ProvenanceStatus = "confirmed"): Sourced<T> {
  return { value, provenance: { source, status } };
}
export function isBlocking(s: Sourced<unknown>): boolean {
  return s.provenance.status !== "confirmed";
}
