import type { z } from "zod";
import type { PropertyRight } from "@/domain/property-right";
import type { KcsInput } from "@/domain/kcs";
import type { KwGruntSnapshot, KwSnapshot } from "@/domain/kw-snapshot";
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
  pietro: undefined,
  // `null`, not a default branch: nothing but the appraiser may say what
  // determines the designation (M-10). `isEmptySubject` below treats it as
  // empty, so an untouched section still counts as untouched.
  przeznaczenieRodzaj: null,
  przeznaczenieNazwa: "",
  przeznaczenieUchwala: "",
  przeznaczenieData: "",
  przeznaczenieSymbol: "",
  przeznaczeniePublikator: "",
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
    (value) => value === undefined || value === null || value === "" || value === false,
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
    // A plan found IS the MPZP branch — the fetch read it off the city's plan
    // layer, so there is nothing for the appraiser to decide. A plan NOT found
    // leaves the choice open (plan ogólny or studium): the fetch knows the MPZP
    // is absent, not what stands in its place.
    przeznaczenieRodzaj: p.mpzp ? "mpzp" : null,
    przeznaczenieNazwa: p.mpzp?.nazwaPlanu ?? "",
    przeznaczenieUchwala: p.mpzp?.uchwala ?? "",
    przeznaczenieData: p.mpzp?.dataUchwaly ?? "",
    przeznaczenieSymbol: p.mpzp?.symbol ?? "",
    przeznaczeniePublikator: p.mpzp?.publikator ?? "",
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
    // `!= null`, not truthiness: parter is 0 and must come back as "0".
    pietro: snapshot.pietro != null ? String(snapshot.pietro) : undefined,
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
function coerceLegacyKw(kw: Partial<KwSnapshot>): Required<KwSnapshot> {
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
    // ADR-018: every field this function forgets is a field that survives the
    // save and then vanishes on the way back in — the appraiser re-opens step 1
    // and the examination they recorded is gone.
    //
    // Under a plain `KwSnapshot` return type the enumeration was only a
    // checklist — the fields below are OPTIONAL, so forgetting one still
    // satisfied the type, and `tresc` was in fact missing from it when the
    // round-trip was first measured (b1-kw-read). `Required<KwSnapshot>` above
    // turns that checklist into a compile error: the return type now demands
    // every optional field, at the cost of one word.
    dataBadania: kw.dataBadania ?? null,
    nrLokalu: kw.nrLokalu ?? null,
    akt: kw.akt ?? null,
    // The transcribed dzialy. Losing these on re-entry would not blank a field
    // the appraiser can see — it would silently stop §8.2 quoting the book.
    tresc: kw.tresc ?? null,
    transkrypcja: kw.transkrypcja ?? null,
  };
}

/**
 * Karta gruntu w kształcie karty lokalu (ADR-021). `Required<>` z tego samego
 * powodu co wyżej: cztery nowe pola są opcjonalne na typie, więc bez tego
 * pominięcie któregoś byłoby cichą utratą treści księgi gruntu przy ponownym
 * wejściu w krok 1 — dokładnie klasa błędu z b1-kw-read.
 */
export function coerceLegacyKwGrunt(kwGrunt: Partial<KwGruntSnapshot>): Required<KwGruntSnapshot> {
  return {
    source: kwGrunt.source ?? "ekw_reczne",
    nrKsiegi: kwGrunt.nrKsiegi ?? null,
    dataBadania: kwGrunt.dataBadania ?? null,
    dzial3: kwGrunt.dzial3 ?? null,
    dzial4: kwGrunt.dzial4 ?? null,
    sad: kwGrunt.sad ?? null,
    wydzial: kwGrunt.wydzial ?? null,
    tresc: kwGrunt.tresc ?? null,
    transkrypcja: kwGrunt.transkrypcja ?? null,
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
  propertyRight: PropertyRight;
  kwNumber: string | null;
  client: string | null;
  inputs: KcsInput | null;
}): Partial<FormInput> {
  return {
    address: v.address,
    area: String(v.area),
    purpose: (v.purpose ?? "") as never,
    propertyRight: v.propertyRight,
    hasBasement: v.inputs?.hasBasement ?? false,
    kwNumber: v.kwNumber ?? "",
    client: v.client ?? "",
    subject: v.inputs?.subject
      ? { ...EMPTY_SUBJECT, ...subjectSnapshotToForm(v.inputs.subject) }
      : { ...EMPTY_SUBJECT },
    subjectMeta: v.inputs?.subjectMeta ?? undefined,
    kw: v.inputs?.kw ? coerceLegacyKw(v.inputs.kw) : undefined,
    // The grunt's book and the encumbrance decision are saved by
    // `applySubjectUpdate` but were not read back here — re-entering step 1
    // wiped a book that had been examined and a decision that had been made,
    // and step 7 re-raised B-06/B-07 with nothing on screen to explain why.
    kwGrunt: v.inputs?.kwGrunt ? coerceLegacyKwGrunt(v.inputs.kwGrunt) : undefined,
    encumbranceTreatment: v.inputs?.encumbranceTreatment ?? undefined,
    kwMeta: v.inputs?.kwMeta ?? undefined,
  };
}

/** Wejście jednego przepisania: pliki albo tekst z przeglądarki KW (ADR-021). */
export type KwWejscie = { kanal: "pdf"; files: File[] } | { kanal: "tekst"; tekst: string };

/**
 * Co da się odczytać z danego wejścia dla danej księgi. Czysta reguła, bo to
 * ona decyduje, czy `runKwExtraction` ma w ogóle co robić:
 *
 * - pola czyta `/kw-extract` i tylko dla księgi LOKALU z PDF-a (grunt bierze
 *   swoje pola z nagłówka przepisanej treści),
 * - treść przepisuje `/kw-transcribe` wszędzie poza ścieżką aktu — akt nie ma
 *   pięciu działów, więc nie ma czego przepisywać.
 *
 * Gdy oba są fałszywe — jedyny taki przypadek to tekst wklejony na ścieżce
 * aktu — odczyt jest NIEDOZWOLONY. Bez tej straży formularz doszedłby do
 * zapisu migawki i skasował stub deweloperski razem z `deweloperski: true`
 * (finding F7). Dziś z UI nieosiągalne; Task 4 przepisuje kartę, więc reguła
 * mieszka tutaj, a nie w układzie panelu.
 */
export function planOdczytuKw(
  wejscie: KwWejscie,
  book: "lokal" | "grunt",
  source: "akt" | "odpis_kw" | "ekw_wklej",
): { czytaPola: boolean; transcribes: boolean; dozwolony: boolean } {
  const akt = book === "lokal" && source === "akt";
  const czytaPola = book === "lokal" && wejscie.kanal === "pdf";
  const transcribes = !akt;
  return { czytaPola, transcribes, dozwolony: czytaPola || transcribes };
}
