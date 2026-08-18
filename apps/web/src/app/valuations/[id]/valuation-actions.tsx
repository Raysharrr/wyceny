"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { BlockerList } from "@/components/wizard/blocker-list";
import { FootNav } from "@/components/wizard/foot-nav";
import { approveValuation, type ApproveValuationResult } from "@/app/actions/approve-valuation";
import { signValuationAction } from "@/app/actions/sign-valuation";
import { createNewVersionAction } from "@/app/actions/create-new-version";
import { currencyFormatter } from "./cards";

/** Mirrors the WR blocker label in documentFieldBlockers (document-model.ts) — shown
 * in the FootNav mid slot when `wr` isn't confirmed yet, instead of a formatted amount. */
const WR_BLOCKER_HINT = "Wartość rynkowa — kalkulacja niezatwierdzona (krok 5. Kalkulacja).";

/**
 * Owner-only action bar, mounted for the owner across all statuses.
 * `draft` → approve button (gated by `canApprove`); `approved` → sign button
 * (gated by `canSign`); `signed` → new-version button (gated by
 * `canCreateNewVersion`, Task 9). `gateOk` is computed server-side by the RSC
 * (approvalGate) — the disabled state is UX sugar; the actions re-check
 * everything server-side (F-4 is an invariant, not UI).
 *
 * T8 removed the four bulk `confirm-*` buttons that used to lead this bar.
 * They flipped whole provenance groups from a screen that showed none of the
 * underlying data — the "I confirm what I cannot see" problem this slice
 * exists to remove. Each group is now confirmed by the save on the step that
 * displays it (T7: steps 1, 3 and 4), and what is left of the refusal here is
 * a list of blockers, each linking to its own step.
 *
 * The four Server Actions (`confirmSample`/`confirmSubject`/`confirmKw`/
 * `confirmFeatures`) and their repo methods are deliberately KEPT: they are
 * owner-gated, audited and idempotent, and they remain the operator-side
 * rescue path for a draft whose group somehow outlives its step. Nothing in
 * the UI calls them any more.
 */
export function ValuationActions({
  id,
  gateOk,
  canApprove,
  canSign,
  canCreateNewVersion,
  wr,
}: {
  id: string;
  gateOk: boolean;
  canApprove: boolean;
  canSign: boolean;
  canCreateNewVersion: boolean;
  /** Optional: ValuationActions also mounts on the flat view
   * (page.tsx), whose call site doesn't pass it — `undefined` and `null`
   * both fall back to the WR blocker hint in the FootNav mid slot. */
  wr?: number | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveValuationResult>(undefined);
  const [isPending, startTransition] = useTransition();
  const wrFormatted = wr != null ? currencyFormatter.format(wr) : null;

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
  // inline retry/skip-maps block instead of the plain error paragraph. Since
  // T8 it may also carry the full blocker list, which renders as a linked
  // list instead. Everything else still falls through to the plain paragraph.
  const handleApprove = (opts?: { skipMaps?: boolean }) => {
    setError(null);
    setApproveResult(undefined);
    startTransition(async () => {
      const result = await approveValuation(id, opts);
      if (result?.error) {
        if (result.mapsUnavailable || result.blockers?.length) {
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
      {approveResult?.blockers?.length ? (
        <BlockerList blockers={approveResult.blockers} testId="approve-blockers" role="alert" />
      ) : null}
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
      {/* ValuationActions also mounts on the flat view (approved/signed,
       * canApprove=false) where an unconditional fixed FootNav would overlay the PDF
       * iframe — gate it so it exists only alongside the approve action it carries. */}
      {canApprove ? (
        <FootNav
          back={{ href: "?step=6", label: "Wstecz" }}
          mid={
            wrFormatted ? (
              <span>
                Wartość rynkowa <b className="num">{wrFormatted}</b>
              </span>
            ) : (
              WR_BLOCKER_HINT
            )
          }
        >
          <Button
            type="button"
            data-testid="approve-button"
            disabled={isPending || !gateOk}
            onClick={() => handleApprove()}
          >
            {isPending ? "Zatwierdzanie…" : "Zatwierdź operat"}
          </Button>
        </FootNav>
      ) : null}
    </div>
  );
}
