"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, Scale, Table2 } from "lucide-react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { saveSampleAction } from "@/app/actions/wizard";
import { sampleStepSchema } from "@/app/actions/wizard-schemas";
import { getSampleProposal } from "@/app/actions/get-sample-proposal";
import { AutoBanner } from "@/components/wizard/auto-banner";
import { FootNav } from "@/components/wizard/foot-nav";
import { plural } from "@/components/wizard/plural";
import { SectionCard } from "@/components/wizard/section-card";
import type { Comparable, KcsInput } from "@/domain/kcs";
import { REQUIRED_SAMPLE_SIZE } from "@/domain/provenance";
import { candidateKey, DEFAULTS } from "@/domain/sample-selection";
import { SampleMap } from "./sample-map";
import { SamplePanel } from "./sample-panel";
import { SampleRadius } from "./sample-radius";
import { SampleRejected } from "./sample-rejected";
import { SampleSections } from "./sample-sections";
import { rcnRow, useSampleReview } from "./use-sample-review";

// `NEXT_PUBLIC_*` vars are inlined at build time (Next.js) or read from the
// real process env (vitest/node) — mirrors the same check in
// `app/valuations/_deps.ts`'s `streetView` adapter selection. CI e2e sets
// this to "off" so the smoke test never depends on Google Street View being
// reachable.
export const NEXT_PUBLIC_STREET_VIEW_OFF = process.env.NEXT_PUBLIC_STREET_VIEW === "off";

// Same "read once at module scope" pattern as `NEXT_PUBLIC_STREET_VIEW_OFF`
// above — Next.js inlines `NEXT_PUBLIC_*` at build time, and vitest/node
// read it straight off `process.env`, so both the app and the RTL tests see
// the same value without threading it through props.
const EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ?? null;

type FormInput = z.input<typeof sampleStepSchema>;
type FormOutput = z.output<typeof sampleStepSchema>;

// Deliberate deviation from a literal `{ date: "", area: "", pricePerM2: "" }`:
// `area` defaults to `undefined`, not `""` — mirrors
// `new-valuation-form.tsx`'s `emptyComparable` (z.coerce.number().positive()
// treats only `undefined` as "not provided"; an empty string coerces to `0`
// and fails `.positive()`).
const emptyComparable: FormInput["comparables"][number] = {
  date: "",
  area: undefined,
  pricePerM2: "",
};

const numberFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ratioFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

function formatStat(value: number | null): string {
  return value === null ? "—" : `${numberFormatter.format(value)} zł/m²`;
}

function formatRatio(value: number | null): string {
  return value === null ? "—" : ratioFormatter.format(value);
}

// zod's coerced-number fields (`z.coerce.number()`) have an `input` type of
// `unknown` — so RHF's `field.value` for area/price is typed `unknown`, not
// `string`. This turns it into the string an <input> needs, without
// stringifying `undefined`/`null` into the literal words "undefined"/"null".
// Mirrors `new-valuation-form.tsx`.
function toInputValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Step 3 ("Próba") — comparable-transactions table + RCN fetch + Cmin/Cmax/Cśr
 * stats, copied from `new-valuation-form.tsx`'s sample section (Task 9,
 * transitional duplication — the old form is deleted in Task 12). Own
 * `useForm` scoped to `sampleStepSchema` (unlike step 1's `SubjectForm`,
 * which types against the full form schema — this step's Controllers are new
 * copies, so the narrower type works directly). Submit saves via
 * `saveSampleAction` and advances to step 4; `address`/`area` come from the
 * persisted valuation (props), not from fields in this step.
 */
export function StepSample({
  valuationId,
  address,
  area,
  comparables: initialComparables,
  sampleMeta,
  sampleSelection,
  streetView,
}: {
  valuationId: string;
  address: string;
  area: number;
  comparables: Comparable[];
  sampleMeta: KcsInput["sampleMeta"];
  sampleSelection: KcsInput["sampleSelection"];
  streetView: KcsInput["streetView"];
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isFetchingSample, setIsFetchingSample] = useState(false);
  const [fetchSampleError, setFetchSampleError] = useState<string | null>(null);
  // Collapsed by default once a v3 selection snapshot already exists (the
  // candidate table above takes over) — expanded when it doesn't (manual
  // sample, legacy v2 draft), so the Playwright smoke and the pre-Slice-3
  // RTL tests keep seeing the editable table without touching a toggle.
  // Keyed off the PROP (the draft as loaded), not the live watched value —
  // a fetch during this session must not auto-collapse a section the
  // appraiser may have opened on purpose.
  const [showEditable, setShowEditable] = useState(!sampleSelection);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(sampleStepSchema),
    defaultValues: {
      comparables: initialComparables.length
        ? initialComparables.map((c) => ({
            date: c.date ?? "",
            area: c.area != null ? String(c.area) : undefined,
            pricePerM2: String(c.pricePerM2),
            source: c.source,
            transactionId: c.transactionId,
            // Wave 4 (C1 still open on the RELOADED-DRAFT path): without
            // this, every RCN row hydrated from a SAVED draft looked
            // "legacy" (no lokalId) even on drafts saved AFTER lokalId
            // shipped — rebuildComparables then fell back to its
            // content/position matching for every reject, not just true
            // pre-lokalId drafts.
            lokalId: c.lokalId,
          }))
        : [{ ...emptyComparable }, { ...emptyComparable }, { ...emptyComparable }],
      sampleMeta: sampleMeta ?? undefined,
      sampleSelection: sampleSelection ?? undefined,
      streetView: streetView ?? undefined,
    },
  });

  const {
    fields: comparableFields,
    append: appendComparable,
    remove: removeComparable,
    replace: replaceComparables,
  } = useFieldArray({ control, name: "comparables" });

  const comparables = useWatch({ control, name: "comparables" });

  const validPrices = (comparables ?? [])
    .map((c) => Number(c?.pricePerM2))
    .filter((price) => Number.isFinite(price) && price > 0);
  const cmin = validPrices.length ? Math.min(...validPrices) : null;
  const cmax = validPrices.length ? Math.max(...validPrices) : null;
  const csr = validPrices.length
    ? validPrices.reduce((sum, price) => sum + price, 0) / validPrices.length
    : null;

  // `stats` only exists once every input is a real, positive number — the
  // guard against `avg === 0` (impossible in practice, since `validPrices`
  // already filters to `price > 0`) keeps `vMin`/`vMax` division-safe without
  // scattering the same three null-checks across the JSX below.
  const stats =
    cmin !== null && cmax !== null && csr !== null && csr > 0
      ? { min: cmin, max: cmax, avg: csr }
      : null;
  const vMin = stats ? stats.min / stats.avg : null;
  const vMax = stats ? stats.max / stats.avg : null;
  const csrPos =
    stats && stats.max > stats.min ? (stats.avg - stats.min) / (stats.max - stats.min) : null;

  const validCount = validPrices.length;
  const comparablesCount = (comparables ?? []).length;
  const comparablesError = errors.comparables?.root?.message ?? errors.comparables?.message;
  // The v3 selection snapshot (ADR-015) — the banner reads counts/radius from
  // here; a persisted `sampleMeta` with no matching `sampleSelection` (a
  // hand-edited sample, test data) gets a "re-fetch to see details" banner.
  const sel = useWatch({ control, name: "sampleSelection" });
  // Watched (not the raw `sampleMeta` prop) so the banner reacts live to a
  // fetch in this session, not only to whatever the page rendered with.
  const liveSampleMeta = useWatch({ control, name: "sampleMeta" });
  // Watched so the candidate table's thumbnails reflect a fetch made in this
  // session, not only whatever `streetView` the page rendered with.
  const liveStreetView = useWatch({ control, name: "streetView" });

  // Candidate-review state (Task 7): which row the side panel shows, the
  // domain result + manual overlay it's derived from, and the
  // reject/restore/next handlers — pulled into its own hook purely to keep
  // this file's length down (see `use-sample-review.ts`).
  const {
    eff,
    combined,
    selectedKey,
    setSelectedKey,
    selectedIndex,
    selectedCandidate,
    selectedStatus,
    streetViewEntryFor,
    next,
    reject,
    restore,
    include,
    skip,
    reviewStats,
    isReselecting,
    poolMissing,
    setPoolMissing,
    reselectError,
    clearReselectError,
    onRadius,
  } = useSampleReview({
    valuationId,
    sel,
    comparables,
    setValue,
    replaceComparables,
    liveStreetView,
  });

  // Manually-rejected rows aren't in `combined` (proposed ∪ alternates) —
  // "Odrzucone" opening the panel on one (Task 4) needs `eff.removed`
  // instead, since `selectedCandidate` (from `combined`) is null for them.
  // `panelStatus` falls back to "proposed" only for TypeScript's sake: a
  // `null` `selectedStatus` means `panelCandidate` is ALSO null (neither
  // lookup found the key), so the panel never actually renders with the
  // fallback in effect.
  const rejectedCandidate =
    eff && selectedKey ? eff.removed.find((c) => candidateKey(c) === selectedKey) : undefined;
  const panelCandidate = selectedCandidate ?? rejectedCandidate ?? null;
  const panelStatus = selectedStatus ?? "proposed";
  const selectedRejection = selectedKey
    ? (sel?.manualRejections ?? []).find((m) => candidateKey(m) === selectedKey)
    : undefined;

  const onFetchSample = async () => {
    setFetchSampleError(null);
    setIsFetchingSample(true);
    try {
      const result = await getSampleProposal({ valuationId, address, area });
      if ("error" in result) {
        setFetchSampleError(result.error);
        return;
      }
      // Rows stay fully editable after this — a hand-edited row keeps
      // `source: "rcn"` even though its values no longer match the fetch;
      // reconciling edited-vs-fetched fidelity is a later gating-slice concern.
      // RCN's raw floats (e.g. `16030.8916015625`) are rounded to 2 decimals
      // here so the value the user sees and accepts in the input is the same
      // value that feeds the valuation engine. No `.slice(0, 12)` here — the
      // domain's `selectSample` already caps `proposed` at 12 (ADR-015 rule 6).
      // A fresh proposal has no `manualRejections` yet, so this is the same
      // result `syncComparables` would produce — going through it here would
      // just add a needless extra read of the (not-yet-updated) form state.
      replaceComparables(result.proposal.comparables.map(rcnRow));
      setValue("sampleMeta", result.proposal.sampleMeta, {
        shouldDirty: true,
        shouldValidate: true,
      });
      // `sampleSelection` must round-trip alongside `sampleMeta` — omitting it
      // on save would wipe the persisted snapshot to null even for a plain
      // price edit that never re-fetches (see the "hidden round-trip" RTL test).
      setValue("sampleSelection", result.proposal.sampleSelection, { shouldDirty: true });
      // Same round-trip requirement as sampleSelection above — the fresh
      // Street View lookup must persist alongside it.
      setValue("streetView", result.proposal.streetView, { shouldDirty: true });
      // A fresh fetch replaces the whole candidate pool — a panel left open
      // on a candidate from the PREVIOUS pool would show stale data (or a
      // key that no longer resolves to anything).
      setSelectedKey(null);
      // A fresh fetch re-populates the pool cache `reselectSample` reads —
      // clears whatever "pobierz ponownie" gate a previous radius click hit,
      // and any leftover error message from that click.
      setPoolMissing(false);
      clearReselectError();
    } finally {
      setIsFetchingSample(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const result = await saveSampleAction(valuationId, values);
    if ("error" in result) {
      setSubmitError(result.error);
      return;
    }
    router.push(`/valuations/${valuationId}?step=4`);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard
          icon={Table2}
          title="Próba porównawcza"
          sub={`${comparablesCount} ${plural(comparablesCount, "transakcja", "transakcje", "transakcji")}`}
        >
          <div className="flex flex-col gap-3">
            {liveSampleMeta && sel && eff ? (
              <AutoBanner>
                Dobrano{" "}
                <b>
                  {eff.proposed.length} z {sel.counts.afterBand} pasujących
                </b>{" "}
                w promieniu <b>{sel.radiusUsedM} m</b> (przebadano {sel.counts.pool} transakcji z
                RCN, {new Date(liveSampleMeta.fetchedAt).toLocaleDateString("pl-PL")})
                {liveSampleMeta.query.truncated
                  ? " — pobieranie przerwano przed pokryciem 24 miesięcy (limit stron lub czasu), pula może być niepełna"
                  : null}
                {" · "}
                {eff.alternates.length}{" "}
                {plural(eff.alternates.length, "alternatywa", "alternatywy", "alternatyw")} ·
                odrzucono{" "}
                {Object.values(sel.rejectedCounts ?? {}).reduce(
                  (total, count) => total + (count ?? 0),
                  0,
                )}
                {(sel.manualRejections?.length ?? 0) > 0
                  ? ` · Twoich odrzuceń: ${sel.manualRejections?.length}`
                  : null}
              </AutoBanner>
            ) : liveSampleMeta ? (
              // A persisted `sampleMeta` without its v3 selection snapshot (a
              // hand-edited sample, test data) — no counts to show, so say that
              // instead of printing question marks.
              <AutoBanner>
                Próba z RCN z {new Date(liveSampleMeta.fetchedAt).toLocaleDateString("pl-PL")}{" "}
                zapisana bez szczegółów doboru — pobierz próbę z RCN ponownie, żeby zobaczyć promień
                i liczniki.
              </AutoBanner>
            ) : null}

            {sel ? (
              <>
                <SampleRadius
                  value={sel.radiusUsedM}
                  steps={DEFAULTS.radiusStepsM}
                  busy={isReselecting}
                  // The alert below is the single VISIBLE copy of the reason
                  // (minor #3) — `disabledReason` here only drives `disabled`
                  // + the `title` tooltip, so it reuses the SAME text
                  // `reselectSample` returned rather than a second, possibly
                  // drifting, hardcoded string.
                  disabledReason={poolMissing ? reselectError : null}
                  onChange={onRadius}
                />
                {reselectError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {reselectError}
                  </p>
                ) : null}
                {liveSampleMeta?.point ? (
                  <SampleMap
                    selection={sel}
                    center={{ x: liveSampleMeta.point.x, y: liveSampleMeta.point.y }}
                    selectedKey={selectedKey}
                    onSelect={setSelectedKey}
                  />
                ) : null}
                <SampleSections
                  selection={sel}
                  streetView={liveStreetView ?? null}
                  streetViewEnabled={!NEXT_PUBLIC_STREET_VIEW_OFF}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  reviewedKeys={reviewStats.reviewedKeys}
                  defaultAlternatesOpen={reviewStats.reviewed === 0}
                  // "w próbie" checkbox (Task 3 wires the prop; Task 4/5 give
                  // the "Odrzuć" path its reasons UI via the panel's
                  // `initialRejecting` — until then, unchecking a proposed
                  // row opens the panel on it, same as a row click, so the
                  // appraiser reaches "Odrzuć" from there). Checking an
                  // alternate is unconditional and already the FULL Task 5
                  // behavior — `include` needs no reason.
                  onToggleInSample={(key, inSample) =>
                    inSample ? include(key) : setSelectedKey(key)
                  }
                />
                <SampleRejected selection={sel} onRestore={restore} onSelect={setSelectedKey} />
              </>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              aria-expanded={showEditable}
              onClick={() => setShowEditable((v) => !v)}
            >
              {showEditable ? <ChevronDown /> : <ChevronRight />}
              Próba do kalkulacji ({comparablesCount}) — edytuj wartości lub dopisz ręcznie
            </Button>

            {/* A validation error on `comparables` must never be hidden behind
                a collapsed section — the appraiser needs to see it to fix it,
                even when they collapsed the section themselves. */}
            {showEditable || !!errors.comparables ? (
              <>
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
                              <Input
                                id={`comparable-date-${index}`}
                                placeholder="2024-07"
                                {...dateField}
                              />
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
                                    areaField.onChange(
                                      e.target.value === "" ? undefined : e.target.value,
                                    )
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

                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() => appendComparable({ ...emptyComparable })}
                >
                  Dodaj transakcję
                </Button>
              </>
            ) : null}

            {comparablesError ? (
              <p role="alert" className="text-sm text-destructive">
                {comparablesError}
              </p>
            ) : null}

            {errors.sampleMeta || errors.sampleSelection ? (
              <p role="alert" className="text-sm text-destructive">
                Ta próba pochodzi ze starszej wersji doboru — pobierz próbę z RCN ponownie, a potem
                zatwierdź.
              </p>
            ) : null}

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

            {fetchSampleError ? (
              <p role="alert" className="text-sm text-destructive">
                {fetchSampleError}
              </p>
            ) : null}

            {comparablesCount < REQUIRED_SAMPLE_SIZE ? (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Operat wymaga co najmniej {REQUIRED_SAMPLE_SIZE} transakcji — masz{" "}
                {comparablesCount}. Szkic można zapisać, ale zatwierdzenie operatu będzie
                zablokowane.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-[128px]">
          {panelCandidate ? (
            <SamplePanel
              candidate={panelCandidate}
              index={selectedIndex}
              total={combined.length}
              entry={streetViewEntryFor(panelCandidate)}
              embedKey={EMBED_KEY}
              streetViewEnabled={!NEXT_PUBLIC_STREET_VIEW_OFF}
              status={panelStatus}
              rejection={selectedRejection}
              onKeep={next}
              onReject={reject}
              // `panelInitialRejecting`-driven wiring (checkbox-uncheck path)
              // is Task 5 — `initialRejecting` stays unpassed (component
              // default `false`) until then.
              onInclude={() => selectedKey && include(selectedKey)}
              onSkip={() => {
                if (!selectedKey) return;
                skip(selectedKey);
                next();
              }}
              onRestore={() => selectedRejection && restore(selectedRejection)}
              onClose={() => setSelectedKey(null)}
            />
          ) : null}

          <SectionCard icon={Scale} title="Statystyki próby">
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">Cmin: </span>
                <span className="num font-medium text-foreground">{formatStat(cmin)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Cmax: </span>
                <span className="num font-medium text-foreground">{formatStat(cmax)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Cśr: </span>
                <span className="num font-medium text-foreground">{formatStat(csr)}</span>
              </p>
            </div>

            {stats ? (
              <div className="mt-4 border-t border-border pt-4">
                <div className="relative h-2 overflow-hidden rounded-full bg-border">
                  <div className="absolute inset-y-0 left-0 right-0 bg-[var(--accent-100)]" />
                  {csrPos !== null ? (
                    <div
                      className="absolute -top-[3px] h-3.5 w-0.5 bg-primary"
                      style={{ left: `${csrPos * 100}%` }}
                    />
                  ) : null}
                </div>
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  Granice korekty [<span className="num">{formatRatio(vMin)}</span> ;{" "}
                  <span className="num">{formatRatio(vMax)}</span>]
                </p>
              </div>
            ) : null}
          </SectionCard>
        </aside>
      </div>

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <FootNav
        back={{ href: `/valuations/${valuationId}?step=2` }}
        mid={
          <>
            Próba:{" "}
            <b>
              {validCount} {plural(validCount, "transakcja", "transakcje", "transakcji")}
            </b>
            {stats ? (
              <>
                {" "}
                · Cśr <b className="num">{numberFormatter.format(stats.avg)} zł/m²</b>
              </>
            ) : null}
          </>
        }
      >
        <Button type="submit" disabled={isSubmitting} className="w-fit">
          Zatwierdź próbę i dalej
        </Button>
      </FootNav>
    </form>
  );
}
