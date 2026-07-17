"use client";

import { Controller, useWatch, type Control } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { valuationFormSchema } from "@/lib/valuation-form-schema";

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

/**
 * Status of the address-triggered EGiB/MPZP auto-fetch (Task 5, decision 2
 * + 9). `outOfCoverage` (address outside the supported area) is a neutral,
 * non-retryable info state — the appraiser fills the section manually.
 * `error` is retryable (transient upstream failure).
 */
export type SubjectFetchState =
  | { status: "idle" | "loading" }
  | { status: "done"; summary: string }
  | { status: "outOfCoverage"; message: string }
  | { status: "error"; message: string };

interface SubjectSectionProps {
  control: Control<FormInput, unknown, FormOutput>;
  fetchState: SubjectFetchState;
  onRetry: () => void;
}

// Mirrors `toInputValue` in `new-valuation-form.tsx`: zod's coerced-number
// fields give RHF a `field.value` typed `unknown`, so this turns it into the
// string an <input> needs without stringifying `undefined`/`null`.
function toInputValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

const TEXT_FIELDS = [
  { name: "subject.obreb", id: "subject-obreb", label: "Obręb" },
  { name: "subject.arkusz", id: "subject-arkusz", label: "Arkusz mapy" },
  { name: "subject.nrDzialki", id: "subject-nr-dzialki", label: "Nr działki" },
  { name: "subject.uzytek", id: "subject-uzytek", label: "Użytek" },
  { name: "subject.budynekRodzaj", id: "subject-budynek-rodzaj", label: "Rodzaj budynku" },
] as const;

const MPZP_FIELDS = [
  { name: "subject.mpzpSymbol", id: "subject-mpzp-symbol", label: "Symbol MPZP" },
  { name: "subject.mpzpNazwa", id: "subject-mpzp-nazwa", label: "Nazwa planu" },
  { name: "subject.mpzpUchwala", id: "subject-mpzp-uchwala", label: "Uchwała" },
  { name: "subject.mpzpData", id: "subject-mpzp-data", label: "Data uchwały" },
  { name: "subject.mpzpPubl", id: "subject-mpzp-publ", label: "Publikator" },
] as const;

function SubjectFetchStatusBar({
  fetchState,
  onRetry,
}: {
  fetchState: SubjectFetchState;
  onRetry: () => void;
}) {
  // `switch` rather than an `if`-chain: TS doesn't fully narrow away the
  // `{ status: "idle" | "loading" }` member across sequential equality
  // checks (its discriminant has two literals), but it does narrow
  // correctly per `case` — verified against the exact repo tsconfig.
  switch (fetchState.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <p data-testid="subject-fetch-status" className="text-sm text-muted-foreground">
          ⏳ Pobieram dane działki i MPZP…
        </p>
      );
    case "done":
      return (
        <p data-testid="subject-fetch-status" className="text-sm text-muted-foreground">
          ✓ Pobrano: {fetchState.summary} — do potwierdzenia
        </p>
      );
    case "outOfCoverage":
      return (
        <p data-testid="subject-fetch-status" className="text-sm text-muted-foreground">
          ℹ {fetchState.message}
        </p>
      );
    case "error":
      return (
        <div data-testid="subject-fetch-status" className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-amber-600">⚠ {fetchState.message}</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Spróbuj ponownie
          </Button>
        </div>
      );
  }
}

/**
 * "Dane przedmiotu" form section (Task 5) — parcel/building/MPZP fields
 * seeded by the address auto-fetch (`onAddressBlur` in the parent) but
 * always editable, since the fetch is a proposal, not an authoritative
 * write. `mpzpAbsent` toggles between the five MPZP fields and the
 * studium/WZ fallback field.
 */
export function SubjectSection({ control, fetchState, onRetry }: SubjectSectionProps) {
  const mpzpAbsent = useWatch({ control, name: "subject.mpzpAbsent" });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Dane przedmiotu</h2>
        <p className="text-sm text-muted-foreground">
          Działka, budynek i MPZP — proponowane automatycznie z adresu, zawsze do potwierdzenia.
        </p>
      </div>

      <SubjectFetchStatusBar fetchState={fetchState} onRetry={onRetry} />

      <FieldGroup>
        {TEXT_FIELDS.map(({ name, id, label }) => (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                <Input id={id} autoComplete="off" {...field} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        ))}

        <Controller
          control={control}
          name="subject.powEwidHa"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="subject-pow-ewid">Pow. ewidencyjna działki [ha]</FieldLabel>
              <Input
                id="subject-pow-ewid"
                type="number"
                step="0.0001"
                min="0"
                inputMode="decimal"
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
          name="subject.kondygnacjeNadziemne"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="subject-kondygnacje-nadziemne">Kondygnacje nadziemne</FieldLabel>
              <Input
                id="subject-kondygnacje-nadziemne"
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
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
          name="subject.kondygnacjePodziemne"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="subject-kondygnacje-podziemne">Kondygnacje podziemne</FieldLabel>
              <Input
                id="subject-kondygnacje-podziemne"
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
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
          name="subject.rokBudowy"
          render={({ field, fieldState }) => (
            <Field data-invalid={!!fieldState.error}>
              <FieldLabel htmlFor="subject-rok-budowy">Rok budowy</FieldLabel>
              <Input
                id="subject-rok-budowy"
                type="number"
                step="1"
                inputMode="numeric"
                name={field.name}
                onBlur={field.onBlur}
                ref={field.ref}
                value={toInputValue(field.value)}
                onChange={(e) => field.onChange(e.target.value)}
              />
              <FieldDescription>
                Brak w publicznej ewidencji — uzupełnij z dokumentacji lub oględzin.
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="subject.mpzpAbsent"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="subject-mpzp-absent"
                checked={field.value ?? false}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                ref={field.ref}
              />
              <FieldLabel htmlFor="subject-mpzp-absent">Brak obowiązującego MPZP</FieldLabel>
            </Field>
          )}
        />

        {mpzpAbsent ? (
          <Controller
            control={control}
            name="subject.przeznaczenieStudium"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor="subject-przeznaczenie-studium">
                  Przeznaczenie wg studium/decyzji WZ
                </FieldLabel>
                <Input id="subject-przeznaczenie-studium" autoComplete="off" {...field} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        ) : (
          MPZP_FIELDS.map(({ name, id, label }) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  <Input id={id} autoComplete="off" {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ))
        )}
      </FieldGroup>
    </section>
  );
}
