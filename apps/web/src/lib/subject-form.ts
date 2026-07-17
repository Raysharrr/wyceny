import type { z } from "zod";
import type { SubjectProposal } from "@/ports/subject";
import type { subjectSchema } from "@/lib/valuation-form-schema";

/**
 * Pure helpers for the "Dane przedmiotu" form section (Task 5). Kept free of
 * React/RHF so `EMPTY_SUBJECT`/`proposalToSubjectValues` are unit-testable
 * without mounting the form.
 */

export type SubjectFormValues = z.input<typeof subjectSchema>;

// All numerics `undefined`, never `""` or `0` — the coerce trap: zod's
// `z.coerce.number().optional()` treats `undefined` as "not provided" but
// coerces `""` to `0`, which then fails `.positive()`/`.min()` checks.
export const EMPTY_SUBJECT: SubjectFormValues = {
  parcelId: "",
  obreb: "",
  arkusz: "",
  nrDzialki: "",
  powEwidHa: undefined,
  uzytek: "",
  budynekRodzaj: "",
  kondygnacjeNadziemne: undefined,
  kondygnacjePodziemne: undefined,
  rokBudowy: undefined,
  mpzpAbsent: undefined,
  mpzpSymbol: "",
  mpzpNazwa: "",
  mpzpUchwala: "",
  mpzpData: "",
  mpzpPubl: "",
  przeznaczenieStudium: "",
};

type SubjectFieldValues = Partial<Record<keyof SubjectFormValues, unknown>>;

/**
 * True when every field is empty/undefined/false — an untouched "Dane
 * przedmiotu" section still submits a truthy object (RHF always seeds
 * `defaultValues.subject` with `EMPTY_SUBJECT`, it has no concept of "no
 * value" for a section), so the action boundary can't tell "untouched" from
 * "filled" by truthiness alone. Used to avoid persisting an empty snapshot
 * and stamping ewidencja/mpzp provenance for data nobody touched.
 */
export function isEmptySubject(subject: SubjectFieldValues | null | undefined): boolean {
  if (!subject) return true;
  return Object.values(subject).every(
    (value) => value === undefined || value === "" || value === false,
  );
}

/**
 * Flattens a `SubjectProposal` (nested parcel/building/mpzp from the
 * EGiB/MPZP auto-fetch) into the flat `subject` form shape. Starts from
 * `EMPTY_SUBJECT` so a proposal missing `building`/`mpzp` leaves those
 * fields empty rather than `undefined`-vs-`""` inconsistent. `rokBudowy` is
 * never set here — it isn't publicly available from EGiB/MPZP and stays
 * manual-entry only.
 */
export function proposalToSubjectValues(p: SubjectProposal): SubjectFormValues {
  return {
    ...EMPTY_SUBJECT,
    parcelId: p.parcel.parcelId,
    obreb: p.parcel.obreb,
    arkusz: p.parcel.arkusz,
    nrDzialki: p.parcel.nrDzialki,
    powEwidHa: p.parcel.powEwidHa ?? undefined,
    uzytek: p.parcel.uzytek,
    budynekRodzaj: p.building?.rodzaj ?? "",
    kondygnacjeNadziemne: p.building?.kondygnacjeNadziemne ?? undefined,
    kondygnacjePodziemne: p.building?.kondygnacjePodziemne ?? undefined,
    mpzpAbsent: p.mpzp === null,
    mpzpSymbol: p.mpzp?.symbol ?? "",
    mpzpNazwa: p.mpzp?.nazwaPlanu ?? "",
    mpzpUchwala: p.mpzp?.uchwala ?? "",
    mpzpData: p.mpzp?.dataUchwaly ?? "",
    mpzpPubl: p.mpzp?.publikator ?? "",
  };
}
