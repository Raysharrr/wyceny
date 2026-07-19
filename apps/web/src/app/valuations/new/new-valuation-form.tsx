"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createValuation } from "@/app/actions/create-valuation";
import { getSampleProposal } from "@/app/actions/get-sample-proposal";
import { getSubjectData } from "@/app/actions/get-subject-data";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { PURPOSE_LABEL } from "@/domain/document-model";
import {
  FEATURE_PRESETS,
  medianAreaM2,
  powierzchniaDefinitions,
  type LokalFeatureKey,
} from "@/domain/feature-presets";
import { REQUIRED_SAMPLE_SIZE } from "@/domain/provenance";
import { extractKw } from "@/lib/kw-extract-client";
import { EMPTY_SUBJECT, proposalToSubjectValues } from "@/lib/subject-form";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FEATURES,
  valuationFormSchema,
  type ValuationFormValues,
} from "@/lib/valuation-form-schema";
import { KwSection, type KwFetchState, type KwSource } from "./kw-section";
import { SubjectSection, type SubjectFetchState } from "./subject-section";

// KW uploads bypass Vercel's body limit by going straight to the worker
// (see mint-kw-token.ts). Defaults to the local worker for dev/e2e.
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8000";

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;
type Rating = ValuationFormValues["features"][number]["rating"];

const RATING_OPTIONS: Array<{ value: Rating; label: string }> = [
  { value: "gorsza", label: "gorsza" },
  // internal enum value stays `przecietna` (no diacritics) — the visible
  // label uses the correct Polish spelling "przeciętna".
  { value: "przecietna", label: "przeciętna" },
  { value: "lepsza", label: "lepsza" },
];

// Deliberate deviation from the brief's literal `emptyRow = { date: "",
// area: "", pricePerM2: "" }`: `area` defaults to `undefined`, not `""`.
// `z.coerce.number().positive().optional()` only treats `undefined` as
// "not provided" — an empty string coerces to `0`, which fails `.positive()`
// and silently blocks submit (the E2E only fills price, leaving area
// blank). `date`/`pricePerM2` keep string defaults per the brief; only
// `pricePerM2` is required so a blank one should (and does) fail.
const emptyComparable: FormInput["comparables"][number] = {
  date: "",
  area: undefined,
  pricePerM2: "",
};

const numberFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatStat(value: number | null): string {
  return value === null ? "—" : `${numberFormatter.format(value)} zł/m²`;
}

// zod's coerced-number fields (`z.coerce.number()`) have an `input` type of
// `unknown` (they genuinely accept anything and coerce it) — so RHF's
// `field.value` for area/price/weight is typed `unknown`, not `string`.
// This turns it into the string an <input> needs, without stringifying
// `undefined`/`null` into the literal words "undefined"/"null".
function toInputValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Create-valuation form (Task 9, extended in KCS Task 3). Client-side
 * validation via react-hook-form + the shared `valuationFormSchema` (also
 * used by the Server Action — Task 4 wires the authoritative re-check).
 * Submission calls `createValuation` directly; on success the action
 * redirects (thrown `redirect()` propagates uncaught); on failure it
 * returns `{ error }`, shown below the fields.
 *
 * The form collects comparable transactions and weighted features; the
 * action (KCS Task 4) validates them with the same schema and feeds them
 * to the KCS engine to compute the WR.
 */
export function NewValuationForm() {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isFetchingSample, setIsFetchingSample] = useState(false);
  const [fetchSampleError, setFetchSampleError] = useState<string | null>(null);
  const [subjectFetch, setSubjectFetch] = useState<SubjectFetchState>({ status: "idle" });
  // KW "Stan prawny" section. The UI `kwSource` (akt|odpis_kw|reczny) is the
  // section key — distinct from the extract's own `kw.source` (akt|odpis_kw).
  const [kwSource, setKwSource] = useState<KwSource>("reczny");
  const [kwState, setKwState] = useState<KwFetchState>({ status: "idle" });
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
  // Slice 7 (Slice-6 "seeded" pattern): powierzchnia definitions track the
  // sample median until the appraiser edits them — then they freeze.
  const powDefsEdited = useRef(false);
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
    formState: { isSubmitting, errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(valuationFormSchema),
    defaultValues: {
      address: "",
      area: "",
      comparables: [{ ...emptyComparable }, { ...emptyComparable }, { ...emptyComparable }],
      features: DEFAULT_FEATURES,
      // Registered up front (rather than left implicit) so the RCN fetch's
      // `setValue("sampleMeta", ...)` below writes a known field instead of
      // relying on RHF to create it on first write.
      sampleMeta: undefined,
      subject: { ...EMPTY_SUBJECT },
      subjectMeta: undefined,
      // `purpose` has no empty-string member in its enum — the placeholder
      // "— wybierz —" option below IS the empty string, so the select
      // starts on it and zod's required-enum message fires until the user
      // picks a real value.
      purpose: "" as never,
      kwNumber: "",
      client: "",
      inspectionDate: "",
    },
  });

  const {
    fields: comparableFields,
    append: appendComparable,
    remove: removeComparable,
    replace: replaceComparables,
  } = useFieldArray({ control, name: "comparables" });

  const {
    fields: featureFields,
    append: appendFeature,
    remove: removeFeature,
  } = useFieldArray({ control, name: "features" });

  const comparables = useWatch({ control, name: "comparables" });
  const features = useWatch({ control, name: "features" });
  const kwValues = useWatch({ control, name: "kw" });
  const areaValue = useWatch({ control, name: "area" });

  const validPrices = (comparables ?? [])
    .map((c) => Number(c?.pricePerM2))
    .filter((price) => Number.isFinite(price) && price > 0);
  const cmin = validPrices.length ? Math.min(...validPrices) : null;
  const cmax = validPrices.length ? Math.max(...validPrices) : null;
  const csr = validPrices.length
    ? validPrices.reduce((sum, price) => sum + price, 0) / validPrices.length
    : null;

  const comparablesCount = (comparables ?? []).length;

  const weightSum = (features ?? []).reduce((sum, f) => sum + (Number(f?.weightPct) || 0), 0);
  const weightsBalanced = Math.abs(weightSum - 100) <= 0.1;

  const comparableAreas = (comparables ?? [])
    .map((c) => Number(c?.area))
    .filter((a) => Number.isFinite(a) && a > 0);
  const areasKey = comparableAreas.join(",");
  useEffect(() => {
    if (powDefsEdited.current) return;
    const current = getValues("features") ?? [];
    const idx = current.findIndex((f) => f?.key === "powierzchnia-uzytkowa");
    if (idx < 0) return;
    const defs = powierzchniaDefinitions(medianAreaM2(comparableAreas));
    setValue(`features.${idx}.definitions`, {
      lepsza: defs.lepsza ?? "",
      przecietna: "",
      gorsza: defs.gorsza ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- areasKey is the dependency proxy for comparableAreas
  }, [areasKey]);

  // The closed pool (F-6): every preset entry not already an active row —
  // starts as the 3 "exceptional" features, refills with a removed row.
  const activeFeatureKeys = new Set((features ?? []).map((f) => f?.key));
  const availableFeatures = FEATURE_PRESETS.lokal.filter(
    (e) => !activeFeatureKeys.has(e.key as LokalFeatureKey),
  );

  const comparablesError = errors.comparables?.root?.message ?? errors.comparables?.message;
  const featuresError = errors.features?.root?.message ?? errors.features?.message;

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

  const onFetchSample = async () => {
    setFetchSampleError(null);
    const isValid = await trigger(["address", "area"]);
    if (!isValid) return;

    setIsFetchingSample(true);
    try {
      const { address, area } = getValues();
      const result = await getSampleProposal({ address, area: Number(area) });
      if ("error" in result) {
        setFetchSampleError(result.error);
        return;
      }
      // Rows stay fully editable after this — a hand-edited row keeps
      // `source: "rcn"` even though its values no longer match the fetch;
      // reconciling edited-vs-fetched fidelity is a later gating-slice concern.
      replaceComparables(
        result.proposal.transactions.slice(0, 12).map((t) => ({
          date: t.date,
          area: String(t.area),
          pricePerM2: String(t.pricePerM2),
          source: "rcn" as const,
          transactionId: t.transactionId,
        })),
      );
      setValue("sampleMeta", result.proposal.meta, { shouldDirty: true, shouldValidate: true });
    } finally {
      setIsFetchingSample(false);
    }
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
    const result = await createValuation(values);
    if (result?.error) {
      setSubmitError(result.error);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
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
        <Controller
          control={control}
          name="inspectionDate"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="inspectionDate">Data oględzin</FieldLabel>
              <Input id="inspectionDate" type="date" {...field} />
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
            void runKwExtraction(lastKwFile.current, kwSource === "odpis_kw" ? "odpis_kw" : "akt");
          }
        }}
        onUseDocumentArea={() => {
          if (kwValues?.powUzytkowaKw != null) {
            setValue("area", kwValues.powUzytkowaKw, { shouldDirty: true });
          }
        }}
        areaMismatch={areaMismatch}
      />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">Próba porównawcza</h2>
          <p className="text-sm text-muted-foreground">
            Transakcje porównawcze użyte do wyznaczenia ceny średniej (Cśr) — minimum 3.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data transakcji</TableHead>
              <TableHead>Powierzchnia (m²)</TableHead>
              <TableHead>Cena (zł/m²)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparableFields.map((field, index) => (
              <TableRow key={field.id}>
                <TableCell>
                  <Controller
                    control={control}
                    name={`comparables.${index}.date`}
                    render={({ field: dateField }) => (
                      <Input id={`comparable-date-${index}`} placeholder="2024-07" {...dateField} />
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Controller
                    control={control}
                    name={`comparables.${index}.area`}
                    render={({ field: areaField, fieldState }) => (
                      <>
                        <Input
                          id={`comparable-area-${index}`}
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder="m²"
                          name={areaField.name}
                          onBlur={areaField.onBlur}
                          ref={areaField.ref}
                          value={toInputValue(areaField.value)}
                          onChange={(e) =>
                            areaField.onChange(e.target.value === "" ? undefined : e.target.value)
                          }
                          aria-invalid={!!fieldState.error}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Controller
                    control={control}
                    name={`comparables.${index}.pricePerM2`}
                    render={({ field: priceField, fieldState }) => (
                      <>
                        <Input
                          id={`comparable-price-${index}`}
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder="zł/m²"
                          aria-invalid={!!fieldState.error}
                          name={priceField.name}
                          onBlur={priceField.onBlur}
                          ref={priceField.ref}
                          value={toInputValue(priceField.value)}
                          onChange={(e) => priceField.onChange(e.target.value)}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={comparableFields.length <= 3}
                    onClick={() => removeComparable(index)}
                  >
                    Usuń
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {comparablesError ? (
          <p role="alert" className="text-sm text-destructive">
            {comparablesError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => appendComparable({ ...emptyComparable })}
          >
            Dodaj transakcję
          </Button>
          <Button
            type="button"
            id="fetch-sample"
            variant="outline"
            className="w-fit"
            disabled={isFetchingSample}
            onClick={onFetchSample}
          >
            {isFetchingSample ? "Pobieranie…" : "Pobierz próbę z RCN"}
          </Button>
        </div>

        {fetchSampleError ? (
          <p role="alert" className="text-sm text-destructive">
            {fetchSampleError}
          </p>
        ) : null}

        {comparablesCount < REQUIRED_SAMPLE_SIZE ? (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            Operat wymaga co najmniej {REQUIRED_SAMPLE_SIZE} transakcji — masz {comparablesCount}.
            Szkic można zapisać, ale zatwierdzenie operatu będzie zablokowane.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p>
            <span className="text-muted-foreground">Cmin: </span>
            <span className="font-medium text-foreground">{formatStat(cmin)}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Cmax: </span>
            <span className="font-medium text-foreground">{formatStat(cmax)}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Cśr: </span>
            <span className="font-medium text-foreground">{formatStat(csr)}</span>
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">Cechy i wagi</h2>
          <p className="text-sm text-muted-foreground">
            Ocena nieruchomości względem próby na każdej cesze — wagi muszą sumować się do 100%.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cecha</TableHead>
              <TableHead>Waga (%)</TableHead>
              <TableHead>Ocena</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {featureFields.map((field, index) => {
              const currentRating = features?.[index]?.rating ?? field.rating;
              return (
                <Fragment key={field.id}>
                  <TableRow>
                    <TableCell className="whitespace-normal">{field.name}</TableCell>
                    <TableCell>
                      <Controller
                        control={control}
                        name={`features.${index}.weightPct`}
                        render={({ field: weightField, fieldState }) => (
                          <>
                            <Input
                              id={`feature-weight-${index}`}
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              aria-invalid={!!fieldState.error}
                              name={weightField.name}
                              onBlur={weightField.onBlur}
                              ref={weightField.ref}
                              value={toInputValue(weightField.value)}
                              onChange={(e) => weightField.onChange(e.target.value)}
                            />
                            <FieldError errors={[fieldState.error]} />
                          </>
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {RATING_OPTIONS.map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            size="sm"
                            variant={currentRating === option.value ? "default" : "outline"}
                            aria-label={`${field.name}: ${option.label}`}
                            onClick={() =>
                              setValue(`features.${index}.rating`, option.value, {
                                shouldDirty: true,
                                shouldValidate: true,
                              })
                            }
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-testid={`remove-feature-${features?.[index]?.key ?? index}`}
                        aria-label={`Usuń cechę ${field.name}`}
                        disabled={featureFields.length === 1}
                        onClick={() => removeFeature(index)}
                      >
                        Usuń
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={4} className="py-0">
                      <details>
                        <summary
                          data-testid={`feature-defs-summary-${features?.[index]?.key ?? index}`}
                          className="cursor-pointer py-1.5 text-xs text-muted-foreground"
                        >
                          Definicje skali ocen — {field.name}
                        </summary>
                        <div className="flex flex-col gap-2 pb-3">
                          {(["lepsza", "przecietna", "gorsza"] as const).map((level) => (
                            <Controller
                              key={level}
                              control={control}
                              name={`features.${index}.definitions.${level}`}
                              render={({ field: defField }) => (
                                <label className="flex flex-col gap-1 text-xs">
                                  <span className="text-muted-foreground">
                                    {level === "przecietna" ? "przeciętna" : level}
                                  </span>
                                  <Input
                                    data-testid={`feature-def-${features?.[index]?.key ?? index}-${level}`}
                                    placeholder="puste pole — poziom nie pojawi się w operacie"
                                    name={defField.name}
                                    onBlur={defField.onBlur}
                                    ref={defField.ref}
                                    value={toInputValue(defField.value)}
                                    onChange={(e) => {
                                      if (features?.[index]?.key === "powierzchnia-uzytkowa") {
                                        powDefsEdited.current = true;
                                      }
                                      defField.onChange(e.target.value);
                                    }}
                                  />
                                </label>
                              )}
                            />
                          ))}
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>

        {availableFeatures.length > 0 ? (
          <select
            data-testid="add-feature-select"
            aria-label="Dodaj cechę z puli"
            className="w-fit rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              const entry = FEATURE_PRESETS.lokal.find((x) => x.key === e.target.value);
              if (!entry) return;
              appendFeature({
                key: entry.key as LokalFeatureKey,
                name: entry.name,
                weightPct: 0,
                rating: "przecietna",
                definitions: { ...entry.defaultDefinitions },
              });
            }}
          >
            <option value="">+ Dodaj cechę z puli…</option>
            {availableFeatures.map((e) => (
              <option key={e.key} value={e.key}>
                {e.name}
              </option>
            ))}
          </select>
        ) : null}

        {featuresError ? (
          <p role="alert" className="text-sm text-destructive">
            {featuresError}
          </p>
        ) : !weightsBalanced ? (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            Suma wag wynosi {numberFormatter.format(weightSum)}% — powinna wynosić 100%.
          </p>
        ) : null}
      </section>

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting} className="w-fit">
        {isSubmitting ? "Zapisywanie…" : "Zapisz szkic"}
      </Button>
    </form>
  );
}
