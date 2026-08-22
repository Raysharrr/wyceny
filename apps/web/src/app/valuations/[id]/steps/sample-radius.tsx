"use client";

import { Button } from "@/components/ui/button";

/**
 * Radius buttons (500/1000/2000/3000 m, Task 8, ADR-015 "Dobor proby v3") —
 * re-runs the DOMAIN selection on the pool `getSampleProposal` already
 * cached, via `reselectSample`, no second WFS call. `disabledReason`
 * (non-null when the pool cache is missing or stale — "pobierz ponownie")
 * disables every button and surfaces the reason only via `title` — the
 * caller's own alert (the same string) is the single VISIBLE copy, so the
 * message isn't shown twice (review round 1, minor #3, 2026-08-21). `busy`
 * disables the buttons the same way while a reselect request is in flight.
 */
export function SampleRadius({
  value,
  steps,
  busy,
  disabledReason,
  onChange,
}: {
  value: number;
  steps: readonly number[];
  busy: boolean;
  disabledReason: string | null;
  onChange(radiusM: number): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Promień</span>
      {steps.map((r) => (
        <Button
          key={r}
          type="button"
          size="sm"
          variant={r === value ? "default" : "outline"}
          aria-pressed={r === value}
          disabled={busy || !!disabledReason}
          title={disabledReason ?? undefined}
          onClick={() => r !== value && onChange(r)}
        >
          {r} m
        </Button>
      ))}
    </div>
  );
}
