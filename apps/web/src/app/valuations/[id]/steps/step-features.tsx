"use client";

import { Fragment, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
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
  medianAreaM2,
  powierzchniaDefinitions,
  type LokalFeatureKey,
} from "@/domain/feature-presets";
import type { KcsInput } from "@/domain/kcs";
import { DEFAULT_FEATURES } from "@/lib/valuation-form-schema";
import { WizardNav } from "../stepper";

type FormInput = z.input<typeof featuresStepSchema>;
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
): FormInput["features"] {
  const mapped: FormInput["features"] = features.length
    ? features.map((f) => ({
        key: f.key as LokalFeatureKey,
        name: f.name,
        weightPct: Math.round(f.weight * 10000) / 100,
        rating: f.rating,
        definitions: {
          lepsza: f.definitions?.lepsza ?? "",
          przecietna: f.definitions?.przecietna ?? "",
          gorsza: f.definitions?.gorsza ?? "",
        },
      }))
    : DEFAULT_FEATURES;

  const median = medianAreaM2(comparableAreas);
  return mapped.map((f) =>
    f.key === "powierzchnia-uzytkowa" && !f.definitions?.lepsza && !f.definitions?.gorsza
      ? { ...f, definitions: { ...f.definitions, ...powierzchniaDefinitions(median) } }
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
  comparableAreas,
}: {
  valuationId: string;
  features: KcsInput["features"];
  comparableAreas: Array<number | undefined>;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(featuresStepSchema),
    defaultValues: {
      features: buildDefaultFeatures(initialFeatures, comparableAreas),
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

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const result = await saveFeaturesAction(valuationId, values);
    if ("error" in result) {
      setSubmitError(result.error);
      return;
    }
    router.push(`/valuations/${valuationId}?step=5`);
  });

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
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
                                      onChange={(e) => defField.onChange(e.target.value)}
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
          Zatwierdź cechy i dalej
        </Button>
      </form>
      <WizardNav valuationId={valuationId} back={3} />
    </>
  );
}
