"use client";

import { useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, MapPin, User } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { Resolver } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AddressSuggestInput } from "@/components/wizard/address-suggest-input";
import { FootNav } from "@/components/wizard/foot-nav";
import { SectionCard } from "@/components/wizard/section-card";
import { createDraft, saveSubjectAction } from "@/app/actions/wizard";
import { step1Schema } from "@/app/actions/wizard-schemas";
import { getMapPreview } from "@/app/actions/get-map-preview";
import { getAddressSuggestions } from "@/app/actions/get-address-suggestions";
import { getSubjectData } from "@/app/actions/get-subject-data";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { PURPOSE_LABEL } from "@/domain/document-model";
import { extractKw } from "@/lib/kw-extract-client";
import { transcribeKw, type KwTranscribeResult } from "@/lib/kw-transcribe-client";
import {
  dzialyZTresci,
  numerKsiegiZTresci,
  polaGruntuZTresci,
  polaZTresci,
} from "@/domain/kw-z-tresci";
import { rodzajNiezgodny, type KartaKsiegi } from "@/domain/kw-niezgodnosci";
import { jestKsiegaGruntu } from "@/domain/kw-tresc";
import { MAX_TEKST_BAJTOW } from "@/domain/kw-wklej";
import type { KwSnapshot, KwWerdykt } from "@/domain/kw-snapshot";
import {
  EMPTY_SUBJECT,
  planOdczytuKw,
  proposalToSubjectValues,
  type KwWejscie,
} from "@/lib/subject-form";
import { cn } from "@/lib/utils";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import {
  EMPTY_KW_FIELDS,
  KwSection,
  localToday,
  type KwFetchState,
  type KwKanalUi,
  type KwSource,
  type KwTranscribeState,
} from "./kw-section";
import { PROPERTY_RIGHT_LABEL } from "@/domain/property-right";
import {
  MapPreview,
  SubjectSection,
  type MapPreviewState,
  type SubjectFetchState,
} from "./subject-section";

// KW uploads bypass Vercel's body limit by going straight to the worker
// (see mint-kw-token.ts). Defaults to the local worker for dev/e2e.
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8000";

// Typed on the FULL schema (SubjectSection/KwSection demand Control<FormInput,
// unknown, FormOutput> and RHF's Control is invariant — advisor BLOCKER-3),
// validated by the STEP-1 schema only. Fields outside step 1 are never
// registered here, and the server action re-validates with step1Schema, so
// the cast is contained to this one line.
type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

/** Która księga jedzie danym torem — obie mają te same kanały (ADR-021 R2). */
/** Która karta — ta sama para co `KartaKsiegi`, jeden słownik na obie. */
export type KwBook = KartaKsiegi;
export type { KwWejscie };

/** Odrzucenia klientowe przed siecią (D9) — limity kontraktu workera. */
const MAX_PLIKOW = 5;
const MAX_BAJTOW = 32 * 1024 * 1024;
const step1Resolver = zodResolver(step1Schema) as unknown as Resolver<
  FormInput,
  unknown,
  FormOutput
>;

// zod's coerced-number fields (`z.coerce.number()`) have an `input` type of
// `unknown` (they genuinely accept anything and coerce it) — so RHF's
// `field.value` for area has type `unknown`, not `string`. This turns it
// into the string an <input> needs, without stringifying `undefined`/`null`
// into the literal words "undefined"/"null". Mirrors `new-valuation-form.tsx`.
function toInputValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

// Display-only formatting for the sidebar tile + FootNav mid (Slice 12
// review nit): the raw watched area value is a string from the RHF
// coerced-number input, so rendering it verbatim ("54.3 m²") leaks the
// dot-decimal HTML number format into PL-locale copy. `null` means
// non-numeric/empty — callers fall back to their existing "—"/absence
// behavior exactly as before.
function formatAreaDisplay(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num.toLocaleString("pl-PL");
}

/**
 * Step-1 ("Dane przedmiotu") wizard form (Slice 11a, Task 6) — narrowed to
 * the address/area/purpose/client/subject/KW fields (comparables, features
 * and inspectionDate belong to later steps). Since Task 12 this is the only
 * create-valuation entry point (the legacy single-page form was removed).
 *
 * No `valuationId` = create mode (submit -> `createDraft`, which redirects
 * on success — never returns). With `valuationId` = edit mode (submit ->
 * `saveSubjectAction`, then `router.push` to step 2).
 */
export function SubjectForm({
  valuationId,
  defaults,
  calculationConfirmed = false,
}: {
  valuationId?: string;
  defaults?: Partial<FormInput>;
  /**
   * Whether this draft already carries a confirmed calculation (`wr != null`).
   * Drives the warning above the form: `applySubjectUpdate` nulls `wr` on
   * every step-1 save, so submitting costs the appraiser step 5 — and step 7
   * disappears from the stepper until they redo it (`maxReachedStep` falls
   * from 7 to 5). Since T8 the step-7 blockers link people here on purpose,
   * so that cost has to be stated on the screen they land on.
   */
  calculationConfirmed?: boolean;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [subjectFetch, setSubjectFetch] = useState<SubjectFetchState>({ status: "idle" });
  // Live §8.1 map preview (Task 8) — kicked off fire-and-forget right after
  // the subject fetch lands "done". NOT persisted: the operat's frozen copy
  // is fetched independently at approve (spec decision 1).
  const [mapPreview, setMapPreview] = useState<MapPreviewState>({ status: "idle" });
  // KW "Stan prawny" section. The UI `kwSource` (akt|odpis_kw|ekw_wklej) is the
  // section key — distinct from the snapshot's own `kw.source`. A snapshot
  // saved before ADR-021 (`ekw_reczne`) opens on the default channel: its data
  // stays in the fields, only the dzialy cannot be touched any other way than
  // by transcribing the book again.
  const [kwSource, setKwSource] = useState<KwSource>(() => {
    const saved = defaults?.kw?.source;
    return saved === "akt" || saved === "odpis_kw" ? saved : "ekw_wklej";
  });
  const [kwGruntSource, setKwGruntSource] = useState<KwKanalUi>(() =>
    defaults?.kwGrunt?.source === "odpis_kw" ? "odpis_kw" : "ekw_wklej",
  );
  const [kwState, setKwState] = useState<KwFetchState>(() => {
    if (!defaults?.kw) return { status: "idle" };
    const kwCount = [defaults.kw.kwLokalu, defaults.kw.kwGruntu, ...defaults.kw.kwInne].filter(
      Boolean,
    ).length;
    const pow = defaults.kw.powUzytkowaKw;
    return {
      status: "done",
      summary: `${kwCount} KW${pow != null ? `, pow. ${pow.toString().replace(".", ",")} m²` : ""}`,
      typeMismatch: false,
    };
  });
  /**
   * The second read of the same PDF — the full content of the five dzialy
   * (b1-kw-read). SECTION state, like `kwState`, and deliberately not a field
   * beside `kw` in the form: the content itself rides INSIDE the snapshot
   * (`kw.tresc`), so the only thing left out here is how the read went, which
   * nothing persists. That keeps `retractExamination` the single place that
   * decides what a withdrawn examination takes with it — this state is cleared
   * by `resetKwSection`, which only that function calls.
   *
   * A reopened draft starts `idle`: whether the stored snapshot has `tresc` is
   * visible in the operat preview, not in a banner about a read that happened
   * days ago.
   */
  const [kwTranscribe, setKwTranscribe] = useState<KwTranscribeState>({ status: "idle" });
  /** Księga gruntu ma własny tor: własny stan i własną straż kolejności (R2). */
  const [kwGruntTranscribe, setKwGruntTranscribe] = useState<KwTranscribeState>({ status: "idle" });
  const lastKwWejscie = useRef<KwWejscie | null>(null);
  // Same out-of-order guard as `fetchSeq` below, for the KW extraction: a
  // source switch (or a retry) mid-flight invalidates the in-flight upload so
  // a late-resolving stale extract can't repopulate `kw` after the section was
  // reset — which would silently submit a stale legal KW snapshot.
  const kwSeq = useRef(0);
  const kwGruntSeq = useRef(0);
  // The numeric area value auto-seeded from a KW extract's `powUzytkowaKw`
  // (into a blank field). `resetKwSection` uses it to drop a doc-seeded area on
  // a section reset — a stale LLM number must never survive as a
  // rzeczoznawca/confirmed area. `null` = nothing doc-seeded to reconcile.
  const areaSeededFromKw = useRef<number | null>(null);
  const lastFetchedAddress = useRef<string | null>(null);
  // Guards against out-of-order responses: if the address changes again (or
  // a retry fires) before an in-flight fetch resolves, only the LATEST
  // fetch's result may write into the form — an older response arriving
  // late must not clobber a newer one (or a manual hard reset in between).
  const fetchSeq = useRef(0);

  const {
    control,
    handleSubmit,
    setValue,
    resetField,
    getValues,
    trigger,
    formState: { isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: step1Resolver,
    defaultValues: {
      address: "",
      area: "",
      // `purpose` has no empty-string member in its enum — the placeholder
      // "— wybierz —" option below IS the empty string, so the select
      // starts on it and zod's required-enum message fires until the user
      // picks a real value.
      purpose: "" as never,
      propertyRight: "wlasnosc_lokalu",
      hasBasement: false,
      kwNumber: "",
      client: "",
      subject: { ...EMPTY_SUBJECT },
      subjectMeta: undefined,
      ...defaults,
    },
  });

  const kwValues = useWatch({ control, name: "kw" });
  const areaValue = useWatch({ control, name: "area" });
  // Live sidebar summary tile + FootNav mid label (Slice 12 Task 7) — the
  // same watched values used by the KW mismatch check above, reused rather
  // than re-subscribed.
  const watchedAddress = useWatch({ control, name: "address" });
  // S3 (spec §6.1): the summary tile names the right and, for the coop right,
  // says what changes downstream — copy from the Krok1 mockup.
  const watchedRight = useWatch({ control, name: "propertyRight" }) ?? "wlasnosc_lokalu";
  const watchedBasement = useWatch({ control, name: "hasBasement" }) ?? false;
  const watchedKwNumber = useWatch({ control, name: "kwNumber" }) ?? "";
  const areaDisplay = formatAreaDisplay(areaValue);

  // Surfaced only when a document gave a usable area AND the form's own area
  // disagrees — a nudge, never a block (the appraiser decides which wins).
  const areaMismatch =
    kwValues?.powUzytkowaKw != null &&
    areaValue !== undefined &&
    areaValue !== "" &&
    areaValue !== null &&
    Number(areaValue) !== kwValues.powUzytkowaKw
      ? { form: Number(areaValue), doc: kwValues.powUzytkowaKw }
      : null;

  // Decision 8 (hard reset): address is the section key for "Dane
  // przedmiotu" — every fetch (including a retry) wipes the whole subject
  // section first, including any manually-edited fields, rather than
  // merging. A stale field from a previous address is worse than an empty
  // one; the fetched proposal always stays fully editable afterwards.
  const fetchSubject = async (address: string) => {
    const seq = ++fetchSeq.current;
    setValue("subject", { ...EMPTY_SUBJECT });
    setValue("subjectMeta", undefined);
    setSubjectFetch({ status: "loading" });
    const result = await getSubjectData({ address });
    if (seq !== fetchSeq.current) return; // stale response — a newer fetch owns the section
    if ("proposal" in result) {
      setValue("subject", proposalToSubjectValues(result.proposal), { shouldValidate: true });
      setValue("subjectMeta", result.proposal.meta, { shouldDirty: true });
      const p = result.proposal;
      setSubjectFetch({
        status: "done",
        summary: `obręb ${p.parcel.obreb}, dz. ${p.parcel.nrDzialki}${p.mpzp ? `, MPZP ${p.mpzp.symbol}` : ", brak MPZP"}`,
      });
      setMapPreview({ status: "loading" });
      void getMapPreview({ address }).then((preview) => {
        if (seq !== fetchSeq.current) return; // stale preview — a newer fetch owns the section
        setMapPreview(
          "unavailable" in preview
            ? { status: "unavailable", message: preview.unavailable }
            : { status: "done", ewidencyjna: preview.ewidencyjna, orto: preview.orto },
        );
      });
    } else if ("outOfCoverage" in result) {
      setSubjectFetch({ status: "outOfCoverage", message: result.outOfCoverage });
    } else {
      setSubjectFetch({ status: "error", message: result.error });
    }
  };

  const onAddressBlur = async () => {
    if (process.env.NEXT_PUBLIC_SUBJECT_AUTOFETCH === "off") return; // e2e: no network in CI
    const address = getValues("address")?.trim();
    if (!address || address === lastFetchedAddress.current) return;
    if (!(await trigger("address"))) return;
    lastFetchedAddress.current = address;
    await fetchSubject(address);
  };

  // Hard reset on source change (Slice-5 lesson: the source is the section
  // key). `resetField` — not `setValue(..., undefined)` — clears the field
  // AND unregisters the nested extract Controllers (kw.kwLokalu, dzial*.tresc)
  // that were mounted during an upload, so a switch to manual can't leave a
  // stale `kw` in the submitted values (W7 write-once poisoning class).
  const resetKwSection = (nextSource: KwSource) => {
    kwSeq.current++; // invalidate any in-flight extraction owning the old section
    setKwSource(nextSource);
    setKwState({ status: "idle" });
    // The sixth carrier (b1-kw-read). `kw.tresc` itself needs nothing here —
    // it is a field of `kw`, which `retractExamination` nulls — but a warning
    // about a book the form no longer holds would outlive its subject.
    setKwTranscribe({ status: "idle" });
    lastKwWejscie.current = null;
    resetField("kw");
    resetField("kwMeta");
    // NOTE: the encumbrance decision is NOT cleared here. It is withdrawn by
    // `retractExamination` in kw-section.tsx, the one place that decides what
    // disappears — and it has to be, because `resetField` restores the DEFAULT,
    // which on a loaded draft is the stored decision rather than nothing.
    // Hard-reset the flat number too: a kwNumber typed straight into the card
    // must not silently become `{nr_kw}` in the operat next to a DIFFERENT set
    // of numbers read from a document after the channel changes. Every switch
    // starts clean — consistent with the section's reset philosophy.
    resetField("kwNumber");
    // Drop a doc-seeded area the appraiser never edited (still equals the
    // seeded value) — otherwise a stale LLM `powUzytkowaKw` would persist as a
    // rzeczoznawca/confirmed area. A hand-edited area (differs) is preserved.
    if (
      areaSeededFromKw.current != null &&
      Number(getValues("area")) === areaSeededFromKw.current
    ) {
      resetField("area");
    }
    areaSeededFromKw.current = null;
  };

  /**
   * Zmiana kanału księgi gruntu. Bez `resetField("kwGrunt")`: w trybie edycji
   * `resetField` przywraca ZAPISANĄ migawkę, a nie pustkę — właściwe wycofanie
   * robi `retractExamination` w `kw-section.tsx` jawną wartością `null`.
   */
  const resetKwGruntSection = (next: KwKanalUi) => {
    kwGruntSeq.current++;
    setKwGruntSource(next);
    setKwGruntTranscribe({ status: "idle" });
  };

  /**
   * Werdykt walidatora zapisywany PRZY migawce (ADR-021 reg. 4): klasy i kody
   * działów, kanał, liczba plików i chwila odczytu — nigdy wartość z księgi.
   */
  const werdyktZ = (
    t: KwTranscribeResult,
    wejscie: KwWejscie,
    karta: KartaKsiegi,
  ): KwWerdykt | null => {
    if (t.kind !== "ok") return null;
    // Reguła, której worker postawić nie może: on widzi rodzaj księgi, ale nie
    // kartę, na którą ją wklejono. Dokłada się do werdyktu workera, nie
    // zastępuje go — obie listy niezgodności trafiają do jednego banera.
    const rodzaj = rodzajNiezgodny(t.tresc, karta);
    return {
      ok: t.walidacja.ok && rodzaj == null,
      bledy: rodzaj ? [...t.walidacja.bledy, rodzaj] : t.walidacja.bledy,
      kanal: wejscie.kanal,
      plikow: wejscie.kanal === "pdf" ? wejscie.files.length : 0,
      at: new Date().toISOString(),
    };
  };

  /**
   * Stan sekcji: baner `ok:false` czyta werdykt z migawki (trwały), nie stąd.
   * Czyta jednak WERDYKT, nie `walidacja.ok` workera — inaczej karta z księgą
   * gruntu wklejoną na lokal pokazałaby naraz zieloną linię „wypadło
   * pomyślnie" i bursztynowy baner, że nie wypadło.
   */
  const stanTranskrypcji = (t: KwTranscribeResult, werdykt: KwWerdykt | null): KwTranscribeState =>
    t.kind === "error"
      ? { status: "failed", code: t.code }
      : werdykt?.ok
        ? { status: "ok", dzialy: t.tresc.dzialy.map((d) => d.kod) }
        : { status: "idle" };

  const setKwNumberFromKw = () => {
    // Operat czyta `nr_kw` z `kwNumber`, a kanał tekstowy nie ma odczytu pól,
    // który by go ustawił (przy wpisywaniu ręcznym robi to `patchKw`).
    setValue("kwNumber", getValues("kw")?.kwLokalu ?? "", { shouldDirty: true });
  };

  const runKwExtraction = async (wejscie: KwWejscie, book: KwBook) => {
    const seqRef = book === "lokal" ? kwSeq : kwGruntSeq;
    const setTranscribe = book === "lokal" ? setKwTranscribe : setKwGruntTranscribe;
    const seq = ++seqRef.current;
    // Akt: tylko pola, żadnej transkrypcji (deed ma zero działów) — jak dziś.
    // Reguła „to jest akt" pada RAZ, w `planOdczytuKw`, i stamtąd wraca.
    const { akt, czytaPola, transcribes, dozwolony } = planOdczytuKw(wejscie, book, kwSource);
    const expectedType: "akt" | "odpis_kw" = akt ? "akt" : "odpis_kw";
    if (!dozwolony) {
      setTranscribe({ status: "failed", code: "kw_kanal_niedozwolony" });
      return;
    }
    // Zapamiętane dopiero PO strażniku: „Spróbuj ponownie" odtwarza ostatnie
    // wejście, więc odrzucone nie może tam zostać (finding z review PR #80).
    if (book === "lokal") lastKwWejscie.current = wejscie;
    if (czytaPola) setKwState({ status: "loading" });
    setTranscribe({ status: transcribes ? "loading" : "idle" });

    const minted = await mintKwUploadToken();
    if (seq !== seqRef.current) return; // stale — a switch/retry owns the section now
    if ("error" in minted) {
      if (czytaPola) setKwState({ status: "error", message: minted.error });
      setTranscribe(
        transcribes ? { status: "failed", code: "kw_transkrypcja_blad" } : { status: "idle" },
      );
      return;
    }
    // ONE token, ONE await, ONE write of the snapshot below. Two independent
    // writes would race — the reads take different times — so whichever landed
    // second would overwrite the other's fields with the stale snapshot it had
    // closed over. Neither client throws: both turn every failure into a result.
    const [result, transcription] = await Promise.all([
      czytaPola && wejscie.kanal === "pdf"
        ? extractKw({
            // Pola czyta PIERWSZY plik; treść przepisują wszystkie (plan §Decyzje 8).
            file: wejscie.files[0]!,
            expectedType,
            token: minted.token,
            workerUrl: WORKER_URL,
          })
        : null,
      transcribes
        ? transcribeKw({
            ...(wejscie.kanal === "pdf" ? { files: wejscie.files } : { tekst: wejscie.tekst }),
            token: minted.token,
            workerUrl: WORKER_URL,
          })
        : null,
    ]);
    if (seq !== seqRef.current) return; // stale response — do not write into the form

    if (result && result.kind !== "ok") {
      setKwState(
        result.kind === "invalidDoc"
          ? { status: "invalidDoc", message: result.message }
          : { status: "error", message: result.message },
      );
      setTranscribe({ status: "idle" });
      return;
    }
    const werdykt = transcription ? werdyktZ(transcription, wejscie, book) : null;
    if (transcription) setTranscribe(stanTranskrypcji(transcription, werdykt));
    const tresc = transcription?.kind === "ok" ? transcription.tresc : null;

    if (book === "grunt") {
      // Bez treści nie ma czego zapisać: pola gruntu zostają, jak są, a baner
      // „failed" już stoi. Nadpisanie ich pustkami zgubiłoby to, co wpisano.
      if (!tresc) return;
      const dotychczas = getValues("kwGrunt") ?? {};
      setValue(
        "kwGrunt",
        {
          ...dotychczas,
          source: wejscie.kanal === "pdf" ? ("odpis_kw" as const) : ("ekw_wklej" as const),
          ...polaGruntuZTresci(tresc),
          dataBadania: localToday(),
          ...dzialyZTresci(tresc),
          tresc,
          transkrypcja: werdykt,
        },
        { shouldDirty: true },
      );
      return;
    }

    const extract = result?.kind === "ok" ? result.extract : null;
    const zTresci = tresc ? polaZTresci(tresc) : null;
    /**
     * Pola LOKALOWE karty lokalu, jedną strażą dla wszystkich trzech naraz.
     * W księdze gruntu nie mają na co wskazywać, więc nie bierze ich ani
     * transkrypcja (`polaZTresci` zeruje je u źródła), ani odczyt pól: `??`
     * przepuszczało wyzerowane `null` dalej do ekstraktu i na kanale PDF
     * obszar działki wracał tą drugą drogą, w dodatku bez podpisu — ten
     * siedzi pod numerem księgi, nie pod tymi polami (F6 recenzji PR #86).
     */
    const polaLokalu = (): Pick<KwSnapshot, "nrLokalu" | "udzial" | "kwGruntu"> =>
      tresc && jestKsiegaGruntu(tresc.naglowek.rodzajKsiegi)
        ? { nrLokalu: null, udzial: null, kwGruntu: null }
        : {
            nrLokalu: zTresci?.nrLokalu ?? null,
            udzial: zTresci?.udzial ?? extract?.udzial ?? null,
            kwGruntu: zTresci?.kwGruntu ?? extract?.kwGruntu ?? null,
          };
    setValue(
      "kw",
      {
        ...(extract ?? { ...EMPTY_KW_FIELDS, source: "ekw_wklej" as const }),
        ...(tresc
          ? { source: wejscie.kanal === "pdf" ? ("odpis_kw" as const) : ("ekw_wklej" as const) }
          : {}),
        kwLokalu: extract?.kwLokalu ?? (tresc ? numerKsiegiZTresci(tresc) : null),
        // A successful read of a KW excerpt IS the examination, and it happened
        // today — no book prints the day someone read it.
        dataBadania: localToday(),
        // Where the transcription states one of these, it wins: it is the
        // full-fidelity pass. Where it states nothing, the field read stands.
        ...(zTresci
          ? {
              akt: zTresci.akt,
              ...polaLokalu(),
              // Header facts, the other way round: the field read has asked for
              // these since Slice 6 and the header often omits them.
              sad: extract?.sad ?? zTresci.sad,
              wydzial: extract?.wydzial ?? zTresci.wydzial,
            }
          : {}),
        // Działy WYLICZANE z treści (ADR-021 reg. 1) — nigdy wpisywane.
        ...(tresc ? dzialyZTresci(tresc) : {}),
        // ZAWSZE, gdy przepisano — także przy `ok:false` (ADR-021 reg. 5);
        // werdykt jedzie obok i to on ostrzega.
        tresc,
        transkrypcja: werdykt,
      },
      { shouldDirty: true },
    );
    if (result?.kind === "ok") setValue("kwMeta", result.meta, { shouldDirty: true });
    // Clear a stale kwNumber error left over from a prior empty upload-mode
    // submit (W4) — now that a snapshot exists, the manual number isn't required.
    void trigger("kwNumber");
    if (tresc && !extract) setKwNumberFromKw();
    if (!extract) return;
    // Seed the form area from the document only if the appraiser left it blank
    // — never overwrite a value they typed (that's what the mismatch nudge is for).
    const area = getValues("area");
    if (extract.powUzytkowaKw != null && (area === undefined || area === "" || area === null)) {
      setValue("area", extract.powUzytkowaKw, { shouldDirty: true });
      areaSeededFromKw.current = extract.powUzytkowaKw;
    }
    const kwCount = [extract.kwLokalu, extract.kwGruntu, ...extract.kwInne].filter(Boolean).length;
    const pow = extract.powUzytkowaKw;
    setKwState({
      status: "done",
      summary: `${kwCount} KW${pow != null ? `, pow. ${pow.toString().replace(".", ",")} m²` : ""}`,
      typeMismatch: result?.kind === "ok" ? result.typeMismatch : false,
    });
  };

  /**
   * Non-PDF, too many, too large — odrzucane po stronie klienta, przed siecią
   * (D9). Odrzucenie unieważnia CAŁY odczyt w locie, obie jego połowy.
   */
  const onKwFiles = (files: File[], book: KwBook) => {
    const reject = (code: string, message: string) => {
      if (book === "lokal") {
        kwSeq.current++; // so a late resolve can't overwrite this inline error
        lastKwWejscie.current = null;
        setKwTranscribe({ status: "idle" });
        setKwState({ status: "error", message });
      } else {
        kwGruntSeq.current++;
        setKwGruntTranscribe({ status: "failed", code });
      }
    };
    if (files.length === 0) return;
    if (files.some((f) => f.type !== "application/pdf")) {
      return reject("kw_plik_nie_pdf", "Wgraj plik PDF.");
    }
    if (files.length > MAX_PLIKOW) {
      return reject("kw_za_duzo_plikow", "Najwyżej pięć plików naraz."); // NOWY TEKST (do akceptacji w PR)
    }
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_BAJTOW) {
      return reject("kw_pliki_za_duze", "Pliki są za duże (łącznie maks. 32 MB)."); // NOWY TEKST
    }
    void runKwExtraction({ kanal: "pdf", files }, book);
  };

  const onKwTekst = (tekst: string, book: KwBook) => {
    // Mierzone w bajtach, nie w znakach: limit workera to rozmiar ciała żądania,
    // a polska księga ma znaki dwubajtowe.
    if (new TextEncoder().encode(tekst).length > MAX_TEKST_BAJTOW) {
      (book === "lokal" ? setKwTranscribe : setKwGruntTranscribe)({
        status: "failed",
        code: "kw_tekst_za_dlugi",
      });
      return;
    }
    void runKwExtraction({ kanal: "tekst", tekst }, book);
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    // `values` is typed FormOutput (full) but runtime-shaped by step1Schema
    // (zod strips unregistered keys); the action re-parses with step1Schema.
    const result = valuationId
      ? await saveSubjectAction(valuationId, values)
      : await createDraft(values); // redirect on success — never returns
    if (result && "error" in result) {
      setSubmitError(result.error);
      return;
    }
    if (valuationId) router.push(`/valuations/${valuationId}?step=2`);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {/* First thing on the page, not a toast after the fact: the save is
       * irreversible for the calculation, and the appraiser has to be able to
       * decide BEFORE pressing the button.
       *
       * The SCOPE is measured field by field across this whole step — see
       * `prose-section-facts.test.ts`, which walks every input the form
       * renders. Round 1 of this warning was measured on the address and the
       * area alone and promised too little: seven more inputs here (obręb, nr
       * działki, użytek, rodzaj budynku, pow. działki, kondygnacje nadziemne,
       * rok budowy) stale `zagospodarowanie`, so someone correcting the year of
       * construction was told step 6 was safe and then blocked on it. Hence
       * "dane przedmiotu" as one group.
       *
       * The second clause is the part worth keeping, and it is equally
       * measured: `purpose`, `client` and `kwNumber` are not in `KcsInput` at
       * all and reach no prompt. Widen this sentence and it stops being read.
       *
       * What CHANGED: those three fields used to cost the calculation anyway,
       * because `applySubjectUpdate` nulled `wr` on every save. It now nulls
       * it only when the AREA moves — the one thing this step writes that
       * `computeKcs` reads — so a client-name correction costs nothing at all,
       * and the sentence has to stop claiming otherwise. */}
      {calculationConfirmed ? (
        <p
          data-testid="step1-recalc-warning"
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-500"
        >
          Zmiana powierzchni kasuje zatwierdzoną kalkulację: wartość rynkową trzeba będzie ponownie
          wyliczyć w kroku 5. Poprawka powierzchni, miasta albo danych przedmiotu wymaga też
          ponownego zatwierdzenia opisów w kroku 6 — sama zmiana zamawiającego, celu wyceny, numeru
          księgi albo ulicy i numeru w tym samym mieście nie rusza ani kwoty, ani opisów.
        </p>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <SectionCard icon={MapPin} title="Adres i lokalizacja" sub="1 pole">
            <FieldGroup>
              <Controller
                control={control}
                name="address"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="address">Adres</FieldLabel>
                    <AddressSuggestInput
                      id="address"
                      name={field.name}
                      value={(field.value as string | undefined) ?? ""}
                      placeholder="np. ul. Wierzbięcice 12/4, Poznań"
                      inputRef={field.ref}
                      onValueChange={field.onChange}
                      onBlur={() => {
                        field.onBlur();
                        void onAddressBlur();
                      }}
                      fetchSuggestions={(query) => getAddressSuggestions({ query })}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </FieldGroup>
          </SectionCard>

          <KwSection
            control={control}
            lokal={{
              source: kwSource,
              state: kwState,
              transcribe: kwTranscribe,
              onSourceChange: resetKwSection,
              onFiles: (files) => onKwFiles(files, "lokal"),
              onTekst: (tekst) => onKwTekst(tekst, "lokal"),
              onRetry: () => {
                if (lastKwWejscie.current) void runKwExtraction(lastKwWejscie.current, "lokal");
              },
            }}
            grunt={{
              source: kwGruntSource,
              transcribe: kwGruntTranscribe,
              onSourceChange: resetKwGruntSection,
              onFiles: (files) => onKwFiles(files, "grunt"),
              onTekst: (tekst) => onKwTekst(tekst, "grunt"),
            }}
            onUseDocumentArea={() => {
              if (kwValues?.powUzytkowaKw != null) {
                setValue("area", kwValues.powUzytkowaKw, { shouldDirty: true });
              }
            }}
            areaMismatch={areaMismatch}
          />

          <SectionCard icon={Building2} title="Dane przedmiotu">
            <div className="flex flex-col gap-4">
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={control}
                  name="area"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="area">Powierzchnia (m²)</FieldLabel>
                      <Input
                        id="area"
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        placeholder="np. 54.3"
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        value={toInputValue(field.value)}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                {/* FH.2 (ADR-016 reg. 5): the flat's own storey. EGiB records
                    the BUILDING's storey count, never which one the flat sits
                    on, so this is manual — step 4 compares it with the piętro
                    scale's thresholds. */}
                <Controller
                  control={control}
                  name="subject.pietro"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="subject-pietro">Piętro</FieldLabel>
                      <Input
                        id="subject-pietro"
                        type="number"
                        step="1"
                        min="0"
                        inputMode="numeric"
                        placeholder="parter = 0"
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        value={toInputValue(field.value)}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? undefined : e.target.value)
                        }
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </FieldGroup>

              <SubjectSection
                control={control}
                setValue={setValue}
                fetchState={subjectFetch}
                onRetry={() => {
                  lastFetchedAddress.current = null;
                  void onAddressBlur();
                }}
              />
            </div>
          </SectionCard>

          <SectionCard icon={User} title="Zamawiający i cel wyceny">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={control}
                name="purpose"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="purpose">Cel wyceny</FieldLabel>
                    <select
                      id="purpose"
                      {...field}
                      aria-invalid={!!fieldState.error}
                      className={cn(
                        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
                      )}
                    >
                      <option value="">— wybierz —</option>
                      {Object.entries(PURPOSE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="client"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="client">Zamawiający wycenę</FieldLabel>
                    <Input
                      id="client"
                      placeholder="np. Jan Kowalski"
                      autoComplete="off"
                      {...field}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </FieldGroup>
          </SectionCard>

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-[128px]">
          <MapPreview state={mapPreview} />
          <section
            data-testid="subject-summary"
            className="rounded-[14px] border border-border bg-card p-5 shadow-sm"
          >
            <p className="text-[14.5px] font-semibold">{watchedAddress || "—"}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
              <div>
                <dt className="text-muted-foreground">Powierzchnia</dt>
                <dd className="num text-[15px]">{areaDisplay ? `${areaDisplay} m²` : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rodzaj prawa</dt>
                <dd className="text-[13px] font-medium">{PROPERTY_RIGHT_LABEL[watchedRight]}</dd>
              </div>
            </dl>
            {watchedRight === "spoldzielcze_wlasnosciowe" ? (
              <div className="mt-4 border-t pt-3 text-[12.5px]">
                <p className="mb-1.5 font-semibold">Co się zmieni dalej</p>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
                  <li>
                    Krok 3 pobierze próbę z <b>rejestru biura</b>, nie z RCN.
                  </li>
                  <li>
                    Operat opisze <b>spółdzielcze własnościowe prawo do lokalu</b>
                    {watchedBasement ? ", z klauzulą o piwnicy" : ""}.
                  </li>
                  {!watchedKwNumber.trim() ? (
                    <li>§8.2 nie będzie zawierał wypisu z księgi wieczystej lokalu.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      <FootNav
        back={valuationId ? { href: "/valuations" } : undefined}
        mid={
          <span>
            Przedmiot: <b>lokal mieszkalny{areaDisplay ? `, ${areaDisplay} m²` : ""}</b>
          </span>
        }
      >
        <Button type="submit" disabled={isSubmitting} className="w-fit">
          Dane się zgadzają — dalej
        </Button>
      </FootNav>
    </form>
  );
}
