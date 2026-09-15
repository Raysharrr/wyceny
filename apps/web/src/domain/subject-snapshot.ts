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
  /**
   * Storey of the valued flat, parter = 0 (ADR-016 reg. 5, FH.2). Manual like
   * `rokBudowy`: EGiB records the BUILDING's storey count, never which one the
   * flat sits on. Feeds the step-4 threshold suggestion; optional and
   * additive, so every snapshot saved before FH.2 parses unchanged.
   */
  pietro?: number | null;
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
  /** GEOPOZ ID_BUDYNKU (ULDK parcel id as fallback); optional/nullable — older snapshots predate it. */
  buildingId?: string | null;
};
