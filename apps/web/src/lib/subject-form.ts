import type { z } from "zod";
import type { KcsInput } from "@/domain/kcs";
import type { KwSnapshot } from "@/domain/kw-snapshot";
import type { SubjectSnapshot } from "@/domain/subject-snapshot";
import type { SubjectProposal } from "@/ports/subject";
import type { subjectSchema, valuationFormSchema } from "@/lib/valuation-form-schema";

/**
 * Pure helpers for the "Dane przedmiotu" form section (Task 5). Kept free of
 * React/RHF so `EMPTY_SUBJECT`/`proposalToSubjectValues` are unit-testable
 * without mounting the form.
 */

export type SubjectFormValues = z.input<typeof subjectSchema>;

// Only used by `step1DefaultsFromInputs` below — not exported.
type FormInput = z.input<typeof valuationFormSchema>;

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

// Maps a persisted SubjectSnapshot's numeric fields (plain numbers) to the
// strings the step-1 form's coerced-number inputs expect — same rationale as
// `toInputValue`, applied once at the defaults layer instead of per-render.
function subjectSnapshotToForm(snapshot: SubjectSnapshot): Partial<SubjectFormValues> {
  return {
    ...snapshot,
    powEwidHa: snapshot.powEwidHa != null ? String(snapshot.powEwidHa) : undefined,
    kondygnacjeNadziemne:
      snapshot.kondygnacjeNadziemne != null ? String(snapshot.kondygnacjeNadziemne) : undefined,
    kondygnacjePodziemne:
      snapshot.kondygnacjePodziemne != null ? String(snapshot.kondygnacjePodziemne) : undefined,
    rokBudowy: snapshot.rokBudowy != null ? String(snapshot.rokBudowy) : undefined,
  };
}

/**
 * Coerces a persisted `kw` snapshot to the current `KwSnapshot` shape.
 * Production drafts created before Slice 11a were saved when `kwInne` and
 * `deweloperski` didn't exist yet — a legacy snapshot spread into
 * `kwState`'s `useState` initializer below (`...defaults.kw.kwInne`) throws a
 * `TypeError` on a non-iterable `undefined`, and even past that, `kwSchema`
 * requires both fields as non-optional, so the form would stay unsaveable.
 * Coercing at this defaults boundary fixes both render and save with no data
 * migration and no change to `normalizeKw`/the mutation/schema layer.
 */
function coerceLegacyKw(kw: Partial<KwSnapshot>): KwSnapshot {
  return {
    source: kw.source ?? "odpis_kw",
    kwLokalu: kw.kwLokalu ?? null,
    kwGruntu: kw.kwGruntu ?? null,
    kwInne: kw.kwInne ?? [],
    deweloperski: kw.deweloperski ?? false,
    powUzytkowaKw: kw.powUzytkowaKw ?? null,
    udzial: kw.udzial ?? null,
    sad: kw.sad ?? null,
    wydzial: kw.wydzial ?? null,
    dataDokumentu: kw.dataDokumentu ?? null,
    dzial3: kw.dzial3 ?? null,
    dzial4: kw.dzial4 ?? null,
  };
}

/**
 * Builds `SubjectForm`'s `defaults` prop from a persisted valuation record
 * (Task 7 supplies `v` from the draft loaded for edit mode).
 */
export function step1DefaultsFromInputs(v: {
  address: string;
  area: number;
  purpose: string | null;
  kwNumber: string | null;
  client: string | null;
  inputs: KcsInput | null;
}): Partial<FormInput> {
  return {
    address: v.address,
    area: String(v.area),
    purpose: (v.purpose ?? "") as never,
    kwNumber: v.kwNumber ?? "",
    client: v.client ?? "",
    subject: v.inputs?.subject
      ? { ...EMPTY_SUBJECT, ...subjectSnapshotToForm(v.inputs.subject) }
      : { ...EMPTY_SUBJECT },
    subjectMeta: v.inputs?.subjectMeta ?? undefined,
    kw: v.inputs?.kw ? coerceLegacyKw(v.inputs.kw) : undefined,
    kwMeta: v.inputs?.kwMeta ?? undefined,
  };
}
