"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveAuthorProfile } from "@/app/actions/save-profile";
import type { AppraiserProfile } from "@/ports/profile";

/**
 * The three fields B-15 asks for. They used to be literals in the DOCX
 * template, which is how an operat left this application carrying another
 * appraiser's name and licence number (ADR-020 cz. 1).
 *
 * No methodology copy here — the "why" belongs in Pomoc; this screen only
 * helps fill the fields in.
 */
export function AuthorForm({ profile }: { profile: AppraiserProfile | null }) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      data-testid="author-form"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setFieldErrors({});
        setError(null);
        setSaved(false);
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await saveAuthorProfile(formData);
          if (result?.fieldErrors) setFieldErrors(result.fieldErrors);
          if (result?.error) setError(result.error);
          if (!result) setSaved(true);
        });
      }}
    >
      <Field data-invalid={Boolean(fieldErrors.fullName)}>
        <FieldLabel htmlFor="profile-full-name">Imię i nazwisko</FieldLabel>
        <Input
          id="profile-full-name"
          name="fullName"
          autoComplete="name"
          defaultValue={profile?.fullName ?? ""}
        />
        <FieldError errors={fieldErrors.fullName ? [{ message: fieldErrors.fullName }] : []} />
      </Field>

      <Field data-invalid={Boolean(fieldErrors.licenseNo)}>
        <FieldLabel htmlFor="profile-license-no">Numer uprawnień zawodowych</FieldLabel>
        <Input
          id="profile-license-no"
          name="licenseNo"
          autoComplete="off"
          defaultValue={profile?.licenseNo ?? ""}
        />
        <FieldError errors={fieldErrors.licenseNo ? [{ message: fieldErrors.licenseNo }] : []} />
      </Field>

      <Field data-invalid={Boolean(fieldErrors.officeBlock)}>
        <FieldLabel htmlFor="profile-office-block">Dane biura</FieldLabel>
        <textarea
          id="profile-office-block"
          name="officeBlock"
          rows={4}
          defaultValue={profile?.officeBlock ?? ""}
          className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        />
        <FieldDescription>
          Nazwa, adres i dane kontaktowe — tak jak mają być w operacie.
        </FieldDescription>
        <FieldError
          errors={fieldErrors.officeBlock ? [{ message: fieldErrors.officeBlock }] : []}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Zapisywanie…" : "Zapisz dane autora"}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Zapisano.</span> : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
