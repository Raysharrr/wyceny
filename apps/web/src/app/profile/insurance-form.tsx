"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { finishInsuranceUpload, uploadInsurancePage } from "@/app/actions/save-profile";
import { renderPdfPages } from "@/lib/pdf-pages-client";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8000";

/**
 * The OC policy (D-60): uploaded ONCE here, printed at the end of every operat
 * as "Załącznik nr 1", and required by B-16 to be valid on the operat's date.
 *
 * PDF only (decyzja usera 15.09). The file goes straight to the worker, which
 * rasterises it into one JPEG per page; the pages come back here and are sent
 * on one at a time — the same body-limit bypass the inspection photos use.
 * The profile starts pointing at the new pages only after the last one lands,
 * so an interrupted upload leaves the previous policy in place rather than a
 * truncated new one.
 */
export function InsuranceForm({
  hasPolicy,
  validUntil,
  validUntilLabel,
}: {
  hasPolicy: boolean;
  /** `YYYY-MM-DD` — what `<input type="date">` needs. */
  validUntil: string | null;
  /** The same date as `dd.mm.rrrr`, the form every other date in the operat takes. */
  validUntilLabel: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = async (date: string) => {
    const errors: Record<string, string> = {};
    if (!file || file.size === 0) {
      errors.policy = "Wybierz plik PDF z polisą.";
    } else if (file.type !== "application/pdf") {
      // `accept` already filters the picker; this catches a drag-and-drop or a
      // renamed file, where the browser still reports the real type.
      errors.policy = "Polisa musi być plikiem PDF.";
    }
    if (!date) errors.insuranceValidUntil = "Podaj datę ważności polisy.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const minted = await mintKwUploadToken();
    if ("error" in minted) {
      setError(minted.error);
      return;
    }
    const rendered = await renderPdfPages({
      file: file!,
      token: minted.token,
      workerUrl: WORKER_URL,
    });
    if (rendered.kind !== "ok") {
      // 413/415 from the worker carry a sentence the appraiser can act on
      // ("za dużo stron", "wgraj plik PDF") — show it on the file field.
      setFieldErrors({ policy: rendered.message });
      return;
    }

    const uploadId = crypto.randomUUID();
    for (let i = 0; i < rendered.pages.length; i++) {
      setProgress(`${i + 1}/${rendered.pages.length}`);
      const pageForm = new FormData();
      pageForm.set("page", rendered.pages[i].blob, `page-${i + 1}.jpg`);
      const result = await uploadInsurancePage(uploadId, i, pageForm);
      if (result?.error) {
        setError(result.error);
        return;
      }
    }
    const finished = await finishInsuranceUpload(uploadId, date);
    if (finished?.fieldErrors) setFieldErrors(finished.fieldErrors);
    else if (finished?.error) setError(finished.error);
    else setSaved(true);
  };

  return (
    <form
      data-testid="insurance-form"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setFieldErrors({});
        setError(null);
        setSaved(false);
        const date = String(new FormData(e.currentTarget).get("insuranceValidUntil") ?? "");
        startTransition(async () => {
          try {
            await submit(date);
          } catch {
            // A Server Action can reject outright and the base64 decode in
            // `renderPdfPages` has no guard of its own — neither may leave the
            // form stuck on "Wgrywanie…" forever (the photo-upload lesson).
            setError("Nie udało się wgrać polisy — sprawdź połączenie i spróbuj ponownie.");
          } finally {
            setProgress(null);
          }
        });
      }}
    >
      {hasPolicy ? (
        <p data-testid="insurance-current" className="text-sm text-muted-foreground">
          Polisa wgrana{validUntilLabel ? `, ważna do ${validUntilLabel}` : ""}. Wgranie nowego
          pliku zastąpi poprzedni.
        </p>
      ) : (
        <p data-testid="insurance-missing" className="text-sm text-muted-foreground">
          Nie wgrano jeszcze polisy — bez niej nie zatwierdzisz operatu.
        </p>
      )}

      <Field data-invalid={Boolean(fieldErrors.policy)}>
        <FieldLabel htmlFor="profile-policy">Polisa OC (PDF)</FieldLabel>
        <FileInput
          id="profile-policy"
          name="policy"
          accept="application/pdf"
          label="Wybierz plik PDF"
          aria-label="Polisa OC (PDF)"
          hint="PDF, do 10 MB i 10 stron"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <FieldDescription>
          Każda strona trafi na koniec operatu jako Załącznik nr 1.
        </FieldDescription>
        <FieldError errors={fieldErrors.policy ? [{ message: fieldErrors.policy }] : []} />
      </Field>

      <Field data-invalid={Boolean(fieldErrors.insuranceValidUntil)}>
        <FieldLabel htmlFor="profile-policy-valid-until">Ważna do</FieldLabel>
        <Input
          id="profile-policy-valid-until"
          name="insuranceValidUntil"
          type="date"
          defaultValue={validUntil ?? ""}
        />
        <FieldError
          errors={
            fieldErrors.insuranceValidUntil ? [{ message: fieldErrors.insuranceValidUntil }] : []
          }
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? (progress ? `Wgrywanie ${progress}…` : "Wgrywanie…") : "Zapisz polisę"}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Zapisano.</span> : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
