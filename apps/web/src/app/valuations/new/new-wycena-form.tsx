"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createWycena } from "@/app/actions/create-wycena";

const formSchema = z.object({
  address: z.string().trim().min(1, "Podaj adres nieruchomości."),
  area: z
    .string()
    .trim()
    .min(1, "Podaj powierzchnię.")
    .refine((value) => Number.isFinite(Number(value)), "Podaj poprawną liczbę.")
    .transform((value) => Number(value))
    .refine((value) => value > 0, "Powierzchnia musi być większa od zera."),
});

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

/**
 * Create-wycena form (Task 9). Client-side validation via
 * react-hook-form + zod; submission calls the `createWycena` Server Action
 * directly. On success the action redirects (thrown `redirect()` propagates
 * uncaught); on failure it returns `{ error }`, shown below the fields.
 */
export function NewWycenaForm() {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { address: "", area: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const result = await createWycena(values);
    if (result?.error) {
      setSubmitError(result.error);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
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
                {...field}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>

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
