/**
 * SubjectSnapshot — the auto-fetched EGiB/MPZP subject-property snapshot
 * (parcel, building, zoning). Standalone domain type: no import from
 * `ports/subject.ts` (F-10 — domain files import no adapters/ports/I-O).
 * All fields optional: manual entry never fetched a subject, and the
 * worker may return partial data for out-of-coverage parcels.
 *
 * Keep in sync with subjectSchema in lib/valuation-form-schema.ts.
 */
export type SubjectSnapshot = {
  parcelId?: string;
  obreb?: string;
  arkusz?: string;
  nrDzialki?: string;
  powEwidHa?: number;
  uzytek?: string;
  budynekRodzaj?: string;
  kondygnacjeNadziemne?: number;
  kondygnacjePodziemne?: number;
  rokBudowy?: number;
  mpzpAbsent?: boolean;
  mpzpSymbol?: string;
  mpzpNazwa?: string;
  mpzpUchwala?: string;
  mpzpData?: string;
  mpzpPubl?: string;
  przeznaczenieStudium?: string;
};

/** The RCN-fetch provenance for the subject snapshot (F-5) — mirrors SampleMeta. */
export type SubjectMetaSnapshot = {
  x: number;
  y: number;
  teryt: string;
  fetchedAt: string;
  source: string;
  mpzpAbsent: boolean;
};
