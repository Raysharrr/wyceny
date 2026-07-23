"use client";

import { useState } from "react";
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
import { saveSampleAction } from "@/app/actions/wizard";
import { sampleStepSchema } from "@/app/actions/wizard-schemas";
import { getSampleProposal } from "@/app/actions/get-sample-proposal";
import type { Comparable, KcsInput } from "@/domain/kcs";
import { REQUIRED_SAMPLE_SIZE } from "@/domain/provenance";
import { WizardNav } from "../stepper";

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

function formatStat(value: number | null): string {
  return value === null ? "—" : `${numberFormatter.format(value)} zł/m²`;
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
}: {
  valuationId: string;
  address: string;
  area: number;
  comparables: Comparable[];
  sampleMeta: KcsInput["sampleMeta"];
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isFetchingSample, setIsFetchingSample] = useState(false);
  const [fetchSampleError, setFetchSampleError] = useState<string | null>(null);

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
          }))
        : [{ ...emptyComparable }, { ...emptyComparable }, { ...emptyComparable }],
      sampleMeta: sampleMeta ?? undefined,
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

  const comparablesCount = (comparables ?? []).length;
  const comparablesError = errors.comparables?.root?.message ?? errors.comparables?.message;

  const onFetchSample = async () => {
    setFetchSampleError(null);
    setIsFetchingSample(true);
    try {
      const result = await getSampleProposal({ address, area });
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
    <>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
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

        {submitError ? (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        ) : null}

        <Button type="submit" disabled={isSubmitting} className="w-fit">
          Zatwierdź próbę i dalej
        </Button>
      </form>
      <WizardNav valuationId={valuationId} back={2} />
    </>
  );
}
