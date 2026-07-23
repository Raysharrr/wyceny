"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { confirmCalculationAction } from "@/app/actions/wizard";

/**
 * Step 5 ("Kalkulacja") confirm button. Re-confirming an already-confirmed
 * draft (confirmed=true) is idempotent and cheap — the KCS engine is pure
 * and re-running it against unchanged inputs yields the same `wr` — so the
 * button stays a single action, just relabelled "Dalej" (YAGNI: no separate
 * "Przelicz ponownie" affordance).
 */
export function ConfirmCalculationButton({
  valuationId,
  confirmed,
}: {
  valuationId: string;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await confirmCalculationAction(valuationId);
            if ("error" in result) {
              setError(result.error);
              return;
            }
            router.push(`/valuations/${valuationId}?step=6`);
          })
        }
      >
        {pending ? "Zapisywanie…" : confirmed ? "Dalej" : "Zatwierdź kalkulację i dalej"}
      </Button>
    </div>
  );
}
