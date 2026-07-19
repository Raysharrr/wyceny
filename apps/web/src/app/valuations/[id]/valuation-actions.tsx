"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmSample } from "@/app/actions/confirm-sample";
import { confirmSubject } from "@/app/actions/confirm-subject";
import { confirmKw } from "@/app/actions/confirm-kw";
import { confirmFeatures } from "@/app/actions/confirm-features";
import { approveValuation } from "@/app/actions/approve-valuation";
import { signValuationAction } from "@/app/actions/sign-valuation";

/**
 * Owner-only action bar, mounted for the owner across all statuses.
 * `draft` → confirm-* + approve buttons (gated by `canApprove`); `approved`
 * → sign button (gated by `canSign`); `signed` → new-version button (Task 9).
 * `gateOk`/`hasToVerify`/`hasSubjectToVerify`/`hasKwToVerify`/
 * `hasFeaturesToVerify` are computed server-side by the RSC (approvalGate) —
 * the disabled state is UX sugar; the actions re-check everything
 * server-side (F-4 is an invariant, not UI).
 */
export function ValuationActions({
  id,
  hasToVerify,
  hasSubjectToVerify,
  hasKwToVerify,
  hasFeaturesToVerify,
  gateOk,
  canApprove,
  canSign,
}: {
  id: string;
  hasToVerify: boolean;
  hasSubjectToVerify: boolean;
  hasKwToVerify: boolean;
  hasFeaturesToVerify: boolean;
  gateOk: boolean;
  canApprove: boolean;
  canSign: boolean;
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
        {hasKwToVerify ? (
          <Button
            type="button"
            variant="outline"
            data-testid="confirm-kw-button"
            disabled={isPending}
            onClick={() => run(confirmKw)}
          >
            {isPending ? "Potwierdzanie…" : "Potwierdź dane KW"}
          </Button>
        ) : null}
        {hasFeaturesToVerify ? (
          <Button
            type="button"
            variant="outline"
            data-testid="confirm-features-button"
            disabled={isPending}
            onClick={() => run(confirmFeatures)}
          >
            {isPending ? "Potwierdzanie…" : "Potwierdź cechy i wagi"}
          </Button>
        ) : null}
        {canApprove ? (
          <Button
            type="button"
            data-testid="approve-button"
            disabled={isPending || !gateOk}
            onClick={() => run(approveValuation)}
          >
            {isPending ? "Zatwierdzanie…" : "Zatwierdź operat"}
          </Button>
        ) : null}
        {canSign ? (
          <Button
            type="button"
            data-testid="sign-button"
            disabled={isPending}
            onClick={() => run(signValuationAction)}
          >
            {isPending ? "Podpisywanie…" : "Podpisz operat (nieodwracalne)"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
