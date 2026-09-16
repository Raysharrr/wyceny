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
  /**
   * What determines the designation (M-10, D-34). Replaces the `mpzpAbsent`
   * boolean: after the 2023 planning reform "no MPZP" is not one state but two
   * — a gmina with a plan ogólny (Poznań since 14.01.2026) and one still
   * reading its studium under art. 64.2. Nullable on purpose: nothing may
   * guess it, B-02 refuses to approve until the appraiser picks one, and
   * pre-M-10 drafts keep opening with nothing selected.
   */
  przeznaczenieRodzaj?: PrzeznaczenieRodzaj | null;
  /** MPZP: nazwa planu. Plan ogólny/studium: gmina in the genitive ("Gminy Swarzędz"). */
  przeznaczenieNazwa?: string;
  /** Resolution without its leading noun: "Nr X/1/2020 Rady Miasta Poznania". */
  przeznaczenieUchwala?: string;
  przeznaczenieData?: string;
  /** Symbol with its description: "4MW/U – tereny zabudowy mieszkaniowej wielorodzinnej". */
  przeznaczenieSymbol?: string;
  /** Plan ogólny only: "obowiązujący od 14 stycznia 2026 r. (opublikowany …)". */
  przeznaczeniePublikator?: string;
};

/** The three designation sources the reference operats use — and no others (M-10). */
export type PrzeznaczenieRodzaj = "mpzp" | "plan_ogolny" | "studium";

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
