"use client";

import { Fragment, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calculator, Scale, SlidersHorizontal } from "lucide-react";
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
import { saveFeaturesAction } from "@/app/actions/wizard";
import { featuresStepSchema } from "@/app/actions/wizard-schemas";
import {
  FEATURE_PRESETS,
  matchesPresetDefinitions,
  medianAreaM2,
  powierzchniaDefinitions,
  type LokalFeatureKey,
  type FeatureInputKey,
} from "@/domain/feature-presets";
import { type Comparable, type KcsInput } from "@/domain/kcs";
import { computeValuation } from "@/domain/valuation-calculation";
import { pairwiseBasis, valuationComparables } from "@/domain/pairwise-state";
import { PairwiseAssessment } from "./pairwise-assessment";
import type { Resolver } from "react-hook-form";
import { DEFAULT_FEATURES } from "@/lib/valuation-form-schema";
import { FootNav } from "@/components/wizard/foot-nav";
import { SectionCard } from "@/components/wizard/section-card";

type SchemaInput = z.input<typeof featuresStepSchema>;
type FormInput = Omit<SchemaInput, "features"> & {
  features: Array<Omit<SchemaInput["features"][number], "rating"> & { rating: Rating | "" }>;
};
type FormOutput = z.output<typeof featuresStepSchema>;
type Rating = FormOutput["features"][number]["rating"];

const RATING_OPTIONS: Array<{ value: Rating; label: string }> = [
  { value: "gorsza", label: "gorsza" },
  // internal enum value stays `przecietna` (no diacritics) — the visible
  // label uses the correct Polish spelling "przeciętna".
  { value: "przecietna", label: "przeciętna" },
  { value: "lepsza", label: "lepsza" },
];

const numberFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Sidebar/FootNav formatters (Task 9 — live KCS preview).
const sumUiFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const ratioFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const unitPriceFormatter = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const wrFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });

// zod's coerced-number fields (`z.coerce.number()`) have an `input` type of
// `unknown` — so RHF's `field.value` for weight is typed `unknown`, not
// `string`. This turns it into the string an <input> needs, without
// stringifying `undefined`/`null` into the literal words "undefined"/"null".
// Mirrors `new-valuation-form.tsx` / `step-sample.tsx`.
function toInputValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Builds `useForm`'s `defaultValues.features` from the persisted draft (or
 * `DEFAULT_FEATURES` for a fresh valuation) — fractions convert to %
 * (`saveFeaturesAction` does the reverse on save). The powierzchnia-uzytkowa
 * median seed (Slice 7 UX) runs ONCE here rather than the old form's
 * live-tracking effect: comparables are a FROZEN prop on this step (no
 * sample table to react to), so an empty definition just gets the current
 * median baked in up front; an already-filled one is left untouched.
 */
function buildDefaultFeatures(
  features: KcsInput["features"],
  comparableAreas: Array<number | undefined>,
  isPairwise = false,
): FormInput["features"] {
  const mapped: FormInput["features"] = features.length
    ? features.map((f) => ({
        key: (f.key ??
          FEATURE_PRESETS.lokal.find((entry) => entry.name === f.name)?.key) as FeatureInputKey,
        name: f.name,
        weightPct: Number((f.weight * 100).toPrecision(15)),
        rating: f.rating,
        ratingScale: f.ratingScale ?? "three",
        definitions: {
          lepsza: f.definitions?.lepsza ?? "",
          ...(f.ratingScale === "two" ? {} : { przecietna: f.definitions?.przecietna ?? "" }),
          gorsza: f.definitions?.gorsza ?? "",
        },
      }))
    : DEFAULT_FEATURES;

  const median = medianAreaM2(comparableAreas);
  return mapped
    .map((f) =>
      f.key === "powierzchnia-uzytkowa" && !f.definitions?.lepsza && !f.definitions?.gorsza
        ? { ...f, definitions: { ...f.definitions, ...powierzchniaDefinitions(median) } }
        : f,
    )
    .map((f) =>
      // PP: the area scale defines only its ends, so "przecietna" would reach
      // Tabela 1 undefined — leave it unrated until the appraiser picks.
      isPairwise &&
      f.key === "powierzchnia-uzytkowa" &&
      f.rating === "przecietna" &&
      f.definitions?.lepsza &&
      !f.definitions?.przecietna?.trim()
        ? { ...f, rating: "" }
        : f,
    );
}

/**
 * Step 4 ("Cechy") — feature/weight/rating table + closed pool, copied from
 * `new-valuation-form.tsx`'s features section (Task 10, transitional
 * duplication — the old form is deleted in Task 12). Own `useForm` scoped to
 * `featuresStepSchema`. Submit saves via `saveFeaturesAction` and advances to
 * step 5.
 */
export function StepFeatures({
  valuationId,
  features: initialFeatures,
  comparables: initialComparables,
  area: initialArea,
  snapshot,
}: {
  valuationId: string;
  features: KcsInput["features"];
  comparables: Comparable[];
  area: number;
  snapshot?: KcsInput;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Freeze form dependencies and CAS token together. Refreshing props cannot
  // authorize dirty values against a snapshot the appraiser never edited.
  const [loaded] = useState(
    () =>
      snapshot ?? { features: initialFeatures, comparables: initialComparables, area: initialArea },
  );
  const [expectedBasis] = useState(() => pairwiseBasis(loaded));
  const [comparisons, setComparisons] = useState(() => loaded.pairwise?.comparisons ?? {});
  const [saved, setSaved] = useState(false);
  const isPairwise = loaded.method === "pp";
  const area = loaded.area;
  const selected = useMemo(() => {
    try {
      return valuationComparables(loaded);
    } catch {
      return [];
    }
  }, [loaded]);
  const comparableAreas = selected.map((c) => c.area);
  const areaMedian = medianAreaM2(comparableAreas);

  const featuresResolver = zodResolver(featuresStepSchema) as unknown as Resolver<
    FormInput,
    unknown,
    FormOutput
  >;
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<FormInput, unknown, FormOutput>({
    // A zero-weight row is outside the result and the operat, so an unrated
    // one (the PP area row starts unrated) must not block the save.
    resolver: (values, context, options) =>
      featuresResolver(
        {
          ...values,
          features: values.features.map((f) =>
            f.rating === "" && Number(f.weightPct) === 0 ? { ...f, rating: "przecietna" } : f,
          ),
        },
        context,
        options,
      ),
    defaultValues: {
      features: buildDefaultFeatures(loaded.features, comparableAreas, isPairwise),
    },
  });

  const {
    fields: featureFields,
    append: appendFeature,
    remove: removeFeature,
  } = useFieldArray({ control, name: "features" });

  const features = useWatch({ control, name: "features" });

  const weightSum = (features ?? []).reduce((sum, f) => sum + (Number(f?.weightPct) || 0), 0);
  const weightsBalanced = Math.abs(weightSum - 100) <= 0.1;

  // The closed pool (F-6): every preset entry not already an active row —
  // starts as the 3 "exceptional" features, refills with a removed row.
  const activeFeatureKeys = new Set((features ?? []).map((f) => f?.key));
  const availableFeatures = FEATURE_PRESETS.lokal.filter(
    (e) => !activeFeatureKeys.has(e.key as LokalFeatureKey),
  );

  const featuresError = errors.features?.root?.message ?? errors.features?.message;

  // Both previews use the shared dispatcher and validated editable features.
  // Confirmation belongs to the explicit save, never the live preview.
  const live = useMemo(() => {
    try {
      const parsed = featuresStepSchema.safeParse({ features });
      if (!parsed.success) return null;
      const liveFeatures = parsed.data.features.map((f) => ({ ...f, weight: f.weightPct / 100 }));
      return computeValuation({
        ...loaded,
        features: liveFeatures,
        pairwise: loaded.pairwise ? { ...loaded.pairwise, comparisons } : undefined,
      });
    } catch {
      return null;
    }
  }, [loaded, features, comparisons]);
  const kcs = live?.method === "kcs" ? live : null;

  const sumUiPos =
    kcs && kcs.vmax > kcs.vmin
      ? Math.min(1, Math.max(0, (kcs.sumUi - kcs.vmin) / (kcs.vmax - kcs.vmin)))
      : null;

  const submit = (confirmPairwise: boolean) =>
    handleSubmit(async (values) => {
      setSubmitError(null);
      const result = await saveFeaturesAction(valuationId, {
        ...values,
        ...(isPairwise
          ? { comparisons, expectedPairwiseBasis: expectedBasis, confirmPairwise }
          : {}),
      });
      if ("error" in result) {
        setSubmitError(result.error);
        return;
      }
      setSaved(true);
      if (isPairwise && !confirmPairwise) {
        // Deliberate reload remounts both fields and basis before another save.
        window.location.assign(`/valuations/${valuationId}?step=4`);
      } else router.push(`/valuations/${valuationId}?step=5`);
    });

  return (
    <form
      onSubmit={isPairwise ? (event) => event.preventDefault() : submit(false)}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard
          className="min-w-0"
          icon={SlidersHorizontal}
          title="Cechy, oceny i wagi"
          sub="worek: lokal"
        >
          <div className="flex flex-col gap-3">
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
                  const current = features?.[index] ?? field;
                  const currentRating = current.rating;
                  const ratings = RATING_OPTIONS.filter(
                    (r) => current.ratingScale !== "two" || r.value !== "przecietna",
                  );
                  // Same rule and gate as the comparison cells in PairwiseAssessment.
                  const areaSuggestion: Rating | null =
                    isPairwise &&
                    !currentRating &&
                    current.key === "powierzchnia-uzytkowa" &&
                    areaMedian !== null &&
                    matchesPresetDefinitions(
                      [{ key: current.key, definitions: current.definitions }],
                      areaMedian,
                    )
                      ? area < areaMedian
                        ? "lepsza"
                        : "gorsza"
                      : null;
                  return (
                    <Fragment key={field.id}>
                      <TableRow>
                        <TableCell className="whitespace-normal">
                          {field.key === "inne" ? (
                            <Controller
                              control={control}
                              name={`features.${index}.name`}
                              render={({ field: nameField, fieldState }) => (
                                <>
                                  <Input {...nameField} aria-label="Nazwa cechy" maxLength={120} />
                                  <FieldError errors={[fieldState.error]} />
                                </>
                              )}
                            />
                          ) : (
                            field.name
                          )}
                          <label className="mt-2 block text-xs">
                            Skala
                            <select
                              aria-label={`Skala: ${current.name}`}
                              className="ml-2 rounded-md border border-input bg-background p-1"
                              value={current.ratingScale ?? "three"}
                              onChange={(e) => {
                                const scale = e.target.value as "two" | "three";
                                setValue(`features.${index}.ratingScale`, scale, {
                                  shouldDirty: true,
                                });
                                if (scale === "two") {
                                  setValue(`features.${index}.definitions`, {
                                    lepsza: current.definitions?.lepsza ?? "",
                                    gorsza: current.definitions?.gorsza ?? "",
                                  });
                                  if (current.rating === "przecietna")
                                    setValue(`features.${index}.rating`, "");
                                  setComparisons((cells) =>
                                    Object.fromEntries(
                                      Object.entries(cells).map(([id, row]) => [
                                        id,
                                        Object.fromEntries(
                                          Object.entries(row).map(([key, cell]) => [
                                            key,
                                            key === current.key && cell.rating === "przecietna"
                                              ? { ...cell, rating: null, multiplier: null }
                                              : cell,
                                          ]),
                                        ),
                                      ]),
                                    ),
                                  );
                                }
                              }}
                            >
                              <option value="three">3 poziomy</option>
                              <option value="two">2 poziomy</option>
                            </select>
                          </label>
                          <FieldError
                            errors={[
                              errors.features?.[index]?.key,
                              errors.features?.[index]?.rating,
                            ]}
                          />
                        </TableCell>
                        <TableCell>
                          <Controller
                            control={control}
                            name={`features.${index}.weightPct`}
                            render={({ field: weightField, fieldState }) => (
                              <>
                                <Input
                                  id={`feature-weight-${index}`}
                                  aria-label={`Waga: ${current.name}`}
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
                            {ratings.map((option) => (
                              <Button
                                key={option.value}
                                type="button"
                                size="sm"
                                variant={currentRating === option.value ? "default" : "outline"}
                                aria-label={`${current.name}: ${option.label}`}
                                aria-pressed={currentRating === option.value}
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
                          {areaSuggestion ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Sugestia: {areaSuggestion} — powierzchnia przedmiotu {area} m², próg{" "}
                              {areaMedian} m² z wybranych porównań.
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setValue(`features.${index}.rating`, areaSuggestion, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  })
                                }
                              >
                                Przyjmij sugerowaną ocenę przedmiotu
                              </Button>
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            data-testid={`remove-feature-${features?.[index]?.key ?? index}`}
                            aria-label={`Usuń cechę ${current.name}`}
                            disabled={featureFields.length === 1}
                            onClick={() => {
                              removeFeature(index);
                              setComparisons((cells) =>
                                Object.fromEntries(
                                  Object.entries(cells).map(([id, row]) => [
                                    id,
                                    Object.fromEntries(
                                      Object.entries(row).filter(([key]) => key !== current.key),
                                    ),
                                  ]),
                                ),
                              );
                            }}
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
                              Definicje skali ocen — {current.name}
                            </summary>
                            <div className="flex flex-col gap-2 pb-3">
                              {ratings.map(({ value: level }) => (
                                <Controller
                                  key={level}
                                  control={control}
                                  name={`features.${index}.definitions.${level}`}
                                  render={({ field: defField, fieldState }) => (
                                    <label className="flex flex-col gap-1 text-xs">
                                      <span className="text-muted-foreground">
                                        {level === "przecietna" ? "przeciętna" : level}
                                      </span>
                                      <Input
                                        data-testid={`feature-def-${features?.[index]?.key ?? index}-${level}`}
                                        aria-label={`Definicja: ${current.name} — ${level}`}
                                        maxLength={1000}
                                        // Mirrors validateFeatures: custom and two-level features require every level.
                                        placeholder={
                                          current.key === "inne" || current.ratingScale === "two"
                                            ? "wymagane — opis poziomu trafia do operatu"
                                            : "puste pole — poziom nie pojawi się w operacie"
                                        }
                                        name={defField.name}
                                        onBlur={defField.onBlur}
                                        ref={defField.ref}
                                        value={toInputValue(defField.value)}
                                        onChange={(e) => defField.onChange(e.target.value)}
                                      />
                                      <FieldError errors={[fieldState.error]} />
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

            {!activeFeatureKeys.has("inne") ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() =>
                  appendFeature({
                    key: "inne",
                    name: "",
                    rating: "",
                    ratingScale: "three",
                    weightPct: 0,
                    definitions: { lepsza: "", przecietna: "", gorsza: "" },
                  })
                }
              >
                + Inna cecha
              </Button>
            ) : null}
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
          </div>
        </SectionCard>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[128px]">
          {!isPairwise ? (
            <SectionCard icon={Scale} title="Wskaźnik korekty ΣUi">
              <p
                data-testid="sidebar-sum-ui"
                className="num text-[28px] font-semibold text-foreground"
              >
                {live ? sumUiFormatter.format(kcs!.sumUi) : "—"}
              </p>
              {live ? (
                <p className="text-[12.5px] text-muted-foreground">
                  lokal {kcs!.sumUi > 1 ? "lepszy" : kcs!.sumUi < 1 ? "gorszy" : "równy"} od
                  średniej rynkowej
                </p>
              ) : null}
              {live ? (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="relative h-2 overflow-hidden rounded-full bg-border">
                    <div className="absolute inset-y-0 left-0 right-0 bg-[var(--accent-100)]" />
                    {sumUiPos !== null ? (
                      <div
                        className="absolute -top-[3px] h-3.5 w-0.5 bg-primary"
                        style={{ left: `${sumUiPos * 100}%` }}
                      />
                    ) : null}
                  </div>
                  <p className="mt-2 flex justify-between text-[12.5px] text-muted-foreground">
                    <span className="num">{ratioFormatter.format(kcs!.vmin)}</span>
                    <span className="num">1,000</span>
                    <span className="num">{ratioFormatter.format(kcs!.vmax)}</span>
                  </p>
                </div>
              ) : null}
            </SectionCard>
          ) : null}

          <SectionCard icon={Calculator} title="Podgląd wartości (WR)">
            <div className="flex flex-col gap-1.5 text-sm">
              <p className="text-muted-foreground">
                {isPairwise ? "Średnia cen po korektach = cena jedn." : "Cśr × ΣUi = cena jedn."}{" "}
                <span className="num font-medium text-foreground">
                  {live ? `${unitPriceFormatter.format(live.unitValue)}/m²` : "—"}
                </span>
              </p>
              <p className="text-muted-foreground">
                × {area.toLocaleString("pl-PL")} m² ={" "}
                <b data-testid="sidebar-wr-preview" className="num text-foreground">
                  {live ? `${wrFormatter.format(live.wr)} zł` : "—"}
                </b>
              </p>
            </div>
          </SectionCard>
        </aside>
      </div>

      {isPairwise ? (
        <PairwiseAssessment
          comparables={selected}
          features={(features ?? []).map((f) => ({ ...f, weight: Number(f.weightPct) / 100 }))}
          comparisons={comparisons}
          onChange={setComparisons}
        />
      ) : null}
      {isPairwise ? (
        <p className="text-sm text-muted-foreground">
          Zmiana cech, ocen lub poprawek wymaga ponownego potwierdzenia całej macierzy.
        </p>
      ) : null}
      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      {isPairwise ? (
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting || saved}
          onClick={submit(false)}
        >
          Zapisz oceny robocze
        </Button>
      ) : null}
      <FootNav
        back={{ href: `/valuations/${valuationId}?step=3` }}
        mid={
          <span data-testid="footnav-kcs-mid" className="hidden sm:inline">
            {live ? (
              <>
                {kcs ? (
                  <>
                    ΣUi <b className="num">{sumUiFormatter.format(kcs.sumUi)}</b> ·{" "}
                  </>
                ) : null}
                podgląd WR <b className="num">{wrFormatter.format(live.wr)} zł</b>
              </>
            ) : (
              "—"
            )}
          </span>
        }
      >
        <Button
          type={isPairwise ? "button" : "submit"}
          onClick={isPairwise ? submit(true) : undefined}
          disabled={isSubmitting || saved}
          className="h-auto w-fit max-w-44 whitespace-normal sm:max-w-none"
        >
          {isPairwise ? "Potwierdź oceny i poprawki i dalej" : "Zatwierdź cechy i dalej"}
        </Button>
      </FootNav>
    </form>
  );
}
