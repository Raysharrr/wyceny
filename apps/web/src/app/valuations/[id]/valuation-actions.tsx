"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmSample } from "@/app/actions/confirm-sample";
import { confirmSubject } from "@/app/actions/confirm-subject";
import { approveValuation } from "@/app/actions/approve-valuation";

/**
 * Draft-only action bar. `gateOk`/`hasToVerify`/`hasSubjectToVerify` are
 * computed server-side by the RSC (approvalGate) — the disabled state is UX
 * sugar; the actions re-check everything server-side (F-4 is an invariant,
 * not UI).
 */
export function ValuationActions({
  id,
  hasToVerify,
  hasSubjectToVerify,
  gateOk,
}: {
  id: string;
  hasToVerify: boolean;
  hasSubjectToVerify: boolean;
  gateOk: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: (id: string) => Promise<{ error: string } | undefined>) => {
    setError(null);
    startTransition(async () => {
      const result = await action(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {hasToVerify ? (
          <Button
            type="button"
            variant="outline"
            data-testid="confirm-sample-button"
            disabled={isPending}
            onClick={() => run(confirmSample)}
          >
            {isPending ? "Potwierdzanie…" : "Potwierdź próbę z RCN"}
          </Button>
        ) : null}
        {hasSubjectToVerify ? (
          <Button
            type="button"
            variant="outline"
            data-testid="confirm-subject-button"
            disabled={isPending}
            onClick={() => run(confirmSubject)}
          >
            {isPending ? "Potwierdzanie…" : "Potwierdź dane przedmiotu"}
          </Button>
        ) : null}
        <Button
          type="button"
          data-testid="approve-button"
          disabled={isPending || !gateOk}
          onClick={() => run(approveValuation)}
        >
          {isPending ? "Zatwierdzanie…" : "Zatwierdź operat"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
