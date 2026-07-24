"use client";

import { useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { Resolver } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FootNav } from "@/components/wizard/foot-nav";
import { createDraft, saveSubjectAction } from "@/app/actions/wizard";
import { step1Schema } from "@/app/actions/wizard-schemas";
import { getMapPreview } from "@/app/actions/get-map-preview";
import { getSubjectData } from "@/app/actions/get-subject-data";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { PURPOSE_LABEL } from "@/domain/document-model";
import type { KcsInput } from "@/domain/kcs";
import type { KwSnapshot } from "@/domain/kw-snapshot";
import type { SubjectSnapshot } from "@/domain/subject-snapshot";
import { extractKw } from "@/lib/kw-extract-client";
import { EMPTY_SUBJECT, proposalToSubjectValues, type SubjectFormValues } from "@/lib/subject-form";
import { cn } from "@/lib/utils";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import { KwSection, type KwFetchState, type KwSource } from "./kw-section";
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
}: {
  valuationId?: string;
  defaults?: Partial<FormInput>;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [subjectFetch, setSubjectFetch] = useState<SubjectFetchState>({ status: "idle" });
  // Live §8.1 map preview (Task 8) — kicked off fire-and-forget right after
  // the subject fetch lands "done". NOT persisted: the operat's frozen copy
  // is fetched independently at approve (spec decision 1).
  const [mapPreview, setMapPreview] = useState<MapPreviewState>({ status: "idle" });
  // KW "Stan prawny" section. The UI `kwSource` (akt|odpis_kw|reczny) is the
  // section key — distinct from the extract's own `kw.source` (akt|odpis_kw).
  // Edit mode seeds both from `defaults.kw` when a document-sourced extract
  // was already saved on the draft.
  const [kwSource, setKwSource] = useState<KwSource>(defaults?.kw?.source ?? "reczny");
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
  const lastKwFile = useRef<File | null>(null);
  // Same out-of-order guard as `fetchSeq` below, for the KW extraction: a
  // source switch (or a retry) mid-flight invalidates the in-flight upload so
  // a late-resolving stale extract can't repopulate `kw` after the section was
  // reset — which would silently submit a stale legal KW snapshot.
  const kwSeq = useRef(0);
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
    lastKwFile.current = null;
    resetField("kw");
    resetField("kwMeta");
    // Hard-reset the flat manual number too: a kwNumber typed in "reczny" must
    // not silently become `{nr_kw}` in the operat next to a DIFFERENT set of
    // extracted numbers after switching to an upload source. Switching back to
    // reczny starts clean — consistent with the section's reset philosophy.
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

  const runKwExtraction = async (file: File, expectedType: "akt" | "odpis_kw") => {
    const seq = ++kwSeq.current;
    lastKwFile.current = file;
    setKwState({ status: "loading" });
    const minted = await mintKwUploadToken();
    if (seq !== kwSeq.current) return; // stale — a switch/retry owns the section now
    if ("error" in minted) {
      setKwState({ status: "error", message: minted.error });
      return;
    }
    const result = await extractKw({
      file,
      expectedType,
      token: minted.token,
      workerUrl: WORKER_URL,
    });
    if (seq !== kwSeq.current) return; // stale response — do not write into the form
    if (result.kind === "invalidDoc") {
      setKwState({ status: "invalidDoc", message: result.message });
      return;
    }
    if (result.kind === "error") {
      setKwState({ status: "error", message: result.message });
      return;
    }
    setValue("kw", result.extract, { shouldDirty: true });
    setValue("kwMeta", result.meta, { shouldDirty: true });
    // Clear a stale kwNumber error left over from a prior empty upload-mode
    // submit (W4) — now that an extract exists, the manual number isn't
    // required and the contradictory error must go.
    void trigger("kwNumber");
    // Seed the form area from the document only if the appraiser left it blank
    // — never overwrite a value they typed (that's what the mismatch nudge is
    // for).
    const area = getValues("area");
    if (
      result.extract.powUzytkowaKw != null &&
      (area === undefined || area === "" || area === null)
    ) {
      setValue("area", result.extract.powUzytkowaKw, { shouldDirty: true });
      areaSeededFromKw.current = result.extract.powUzytkowaKw;
    }
    const kwCount = [
      result.extract.kwLokalu,
      result.extract.kwGruntu,
      ...result.extract.kwInne,
    ].filter(Boolean).length;
    const pow = result.extract.powUzytkowaKw;
    setKwState({
      status: "done",
      summary: `${kwCount} KW${pow != null ? `, pow. ${pow.toString().replace(".", ",")} m²` : ""}`,
      typeMismatch: result.typeMismatch,
    });
  };

  // Non-PDF / oversize are rejected client-side before any network call (D9).
  const onKwFileSelected = (file: File) => {
    const expectedType = kwSource === "odpis_kw" ? "odpis_kw" : "akt";
    if (file.type !== "application/pdf") {
      kwSeq.current++; // invalidate any in-flight extraction so a late resolve can't overwrite this inline error
      lastKwFile.current = null;
      setKwState({ status: "error", message: "Wgraj plik PDF." });
      return;
    }
    if (file.size > 32 * 1024 * 1024) {
      kwSeq.current++; // invalidate any in-flight extraction so a late resolve can't overwrite this inline error
      lastKwFile.current = null;
      setKwState({ status: "error", message: "Plik jest za duży (maks. 32 MB)." });
      return;
    }
    void runKwExtraction(file, expectedType);
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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-8">
          <FieldGroup>
            <Controller
              control={control}
              name="address"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor="address">Adres</FieldLabel>
                  <Input
                    id="address"
                    placeholder="np. ul. Wierzbięcice 12/4, Poznań"
                    autoComplete="off"
                    {...field}
                    onBlur={() => {
                      field.onBlur();
                      void onAddressBlur();
                    }}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
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
                  <Input id="client" placeholder="np. Jan Kowalski" autoComplete="off" {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>

          <SubjectSection
            control={control}
            fetchState={subjectFetch}
            onRetry={() => {
              lastFetchedAddress.current = null;
              void onAddressBlur();
            }}
          />

          <KwSection
            control={control}
            state={kwState}
            source={kwSource}
            onSourceChange={resetKwSection}
            onFileSelected={onKwFileSelected}
            onRetry={() => {
              if (lastKwFile.current) {
                void runKwExtraction(
                  lastKwFile.current,
                  kwSource === "odpis_kw" ? "odpis_kw" : "akt",
                );
              }
            }}
            onUseDocumentArea={() => {
              if (kwValues?.powUzytkowaKw != null) {
                setValue("area", kwValues.powUzytkowaKw, { shouldDirty: true });
              }
            }}
            areaMismatch={areaMismatch}
          />

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-[128px]">
          <MapPreview state={mapPreview} />
          <section className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
            <p className="text-[14.5px] font-semibold">{watchedAddress || "—"}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
              <div>
                <dt className="text-muted-foreground">Powierzchnia</dt>
                <dd className="num text-[15px]">{areaValue ? `${String(areaValue)} m²` : "—"}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <FootNav
        back={valuationId ? { href: "/valuations" } : undefined}
        mid={
          <span>
            Przedmiot: <b>lokal mieszkalny{areaValue ? `, ${String(areaValue)} m²` : ""}</b>
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
