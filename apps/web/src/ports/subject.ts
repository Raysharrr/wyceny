/**
 * Port for the worker's subject-data proposal (parcel/building/MPZP details
 * auto-fetched from EGiB + MPZP registries to seed the "Dane przedmiotu"
 * section of a valuation).
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10).
 */
export interface SubjectParcel {
  parcelId: string;
  obreb: string;
  arkusz: string;
  nrDzialki: string;
  // Worker's `_to_float` returns None when EGiB omits the field — unlike
  // the string fields above, which the worker defaults to "".
  powEwidHa: number | null;
  uzytek: string;
}

export interface SubjectBuilding {
  rodzaj: string;
  // Worker's `_to_int` returns None when EGiB omits the field.
  kondygnacjeNadziemne: number | null;
  kondygnacjePodziemne: number | null;
}

export interface SubjectMpzp {
  symbol: string;
  nazwaPlanu: string;
  uchwala: string;
  dataUchwaly: string;
  publikator: string;
}

export interface SubjectMeta {
  x: number;
  y: number;
  teryt: string;
  fetchedAt: string;
  source: string;
  mpzpAbsent: boolean;
}

export interface SubjectProposal {
  parcel: SubjectParcel;
  building: SubjectBuilding | null;
  mpzp: SubjectMpzp | null;
  meta: SubjectMeta;
}

/**
 * Result of a fetch attempt. `outOfCoverage` distinguishes the worker's
 * non-retryable 422 (address outside the supported EGiB/MPZP area — user
 * should fill data manually) from a retryable failure, which is thrown.
 */
export type SubjectFetchResult =
  { kind: "ok"; proposal: SubjectProposal } | { kind: "outOfCoverage"; message: string };

export interface PortSubjectData {
  /**
   * Fetches a proposed subject-data snapshot (parcel/building/MPZP) for the
   * given address, sourced from EGiB + MPZP via the worker's GEOPOZ/GUGIK
   * integration.
   */
  fetchSubject(address: string): Promise<SubjectFetchResult>;
}
