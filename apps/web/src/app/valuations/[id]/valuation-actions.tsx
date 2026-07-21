"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmSample } from "@/app/actions/confirm-sample";
import { confirmSubject } from "@/app/actions/confirm-subject";
import { confirmKw } from "@/app/actions/confirm-kw";
import { confirmFeatures } from "@/app/actions/confirm-features";
import { approveValuation, type ApproveValuationResult } from "@/app/actions/approve-valuation";
import { signValuationAction } from "@/app/actions/sign-valuation";
import { createNewVersionAction } from "@/app/actions/create-new-version";

/**
 * Owner-only action bar, mounted for the owner across all statuses.
 * `draft` → confirm-* + approve buttons (gated by `canApprove`); `approved`
 * → sign button (gated by `canSign`); `signed` → new-version button (gated
 * by `canCreateNewVersion`, Task 9). `gateOk`/`hasToVerify`/
 * `hasSubjectToVerify`/`hasKwToVerify`/`hasFeaturesToVerify` are computed
 * server-side by the RSC (approvalGate) — the disabled state is UX sugar;
 * the actions re-check everything server-side (F-4 is an invariant, not UI).
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
  canCreateNewVersion,
}: {
  id: string;
  hasToVerify: boolean;
  hasSubjectToVerify: boolean;
  hasKwToVerify: boolean;
  hasFeaturesToVerify: boolean;
  gateOk: boolean;
  canApprove: boolean;
  canSign: boolean;
  canCreateNewVersion: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveValuationResult>(undefined);
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

  // Slice 9 (Task 9): approve is no longer covered by the generic `run` —
  // it needs to forward `opts` (the user's "approve without maps" choice)
  // and its result carries an extra `mapsUnavailable` flag that drives the
  // inline retry/skip-maps block instead of the plain error paragraph.
  const handleApprove = (opts?: { skipMaps?: boolean }) => {
    setError(null);
    setApproveResult(undefined);
    startTransition(async () => {
      const result = await approveValuation(id, opts);
      if (result?.error) {
        if (result.mapsUnavailable) {
          setApproveResult(result);
        } else {
          setError(result.error);
        }
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
            onClick={() => handleApprove()}
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
        {canCreateNewVersion ? (
          <Button
            type="button"
            data-testid="create-new-version-button"
            disabled={isPending}
            onClick={() => run(createNewVersionAction)}
          >
            {isPending ? "Tworzenie…" : "Utwórz nową wersję"}
          </Button>
        ) : null}
      </div>
      {approveResult?.mapsUnavailable ? (
        <div data-testid="maps-fallback" className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-amber-600">⚠ {approveResult.error}</p>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleApprove()}
          >
            Spróbuj ponownie
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleApprove({ skipMaps: true })}
          >
            Zatwierdź bez map
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
