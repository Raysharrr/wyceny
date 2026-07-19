"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveSignature } from "@/app/actions/save-signature";

export function SignatureForm({ hasSignature }: { hasSignature: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await saveSignature(formData);
          if (result?.error) setError(result.error);
        });
      }}
    >
      {hasSignature ? null : (
        <p className="text-sm text-muted-foreground">
          Nie wgrano jeszcze skanu podpisu — bez niego nie podpiszesz operatu.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Skan podpisu (PNG lub JPEG, do 1 MB; najlepiej szeroki, np. 510×170 px)
        <input type="file" name="signature" accept="image/png,image/jpeg" />
      </label>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Zapisywanie…" : "Zapisz podpis"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
