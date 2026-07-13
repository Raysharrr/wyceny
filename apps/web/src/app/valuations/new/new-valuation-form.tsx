"use client";

import { useState } from "react";
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
import {
  DEFAULT_FEATURES,
  valuationFormSchema,
  type ValuationFormValues,
} from "@/lib/valuation-form-schema";

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

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(valuationFormSchema),
    defaultValues: {
      address: "",
      area: "",
      comparables: [{ ...emptyComparable }, { ...emptyComparable }, { ...emptyComparable }],
      features: DEFAULT_FEATURES,
    },
  });

  const {
    fields: comparableFields,
    append: appendComparable,
    remove: removeComparable,
  } = useFieldArray({ control, name: "comparables" });

  const { fields: featureFields } = useFieldArray({ control, name: "features" });

  const comparables = useWatch({ control, name: "comparables" });
  const features = useWatch({ control, name: "features" });

  const validPrices = (comparables ?? [])
    .map((c) => Number(c?.pricePerM2))
    .filter((price) => Number.isFinite(price) && price > 0);
  const cmin = validPrices.length ? Math.min(...validPrices) : null;
  const cmax = validPrices.length ? Math.max(...validPrices) : null;
  const csr = validPrices.length
    ? validPrices.reduce((sum, price) => sum + price, 0) / validPrices.length
    : null;

  const weightSum = (features ?? []).reduce((sum, f) => sum + (Number(f?.weightPct) || 0), 0);
  const weightsBalanced = Math.abs(weightSum - 100) <= 0.1;

  const comparablesError = errors.comparables?.root?.message ?? errors.comparables?.message;
  const featuresError = errors.features?.root?.message ?? errors.features?.message;

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
      </FieldGroup>

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

        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => appendComparable({ ...emptyComparable })}
        >
          Dodaj transakcję
        </Button>

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {featureFields.map((field, index) => {
              const currentRating = features?.[index]?.rating ?? field.rating;
              return (
                <TableRow key={field.id}>
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

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
        {isSubmitting ? "Tworzenie…" : "Utwórz wycenę"}
      </Button>
    </form>
  );
}
