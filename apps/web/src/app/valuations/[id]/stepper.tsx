import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WIZARD_STEPS } from "@/domain/wizard";
import { cn } from "@/lib/utils";

export function Stepper({
  current,
  maxReached,
  valuationId,
}: {
  current: number;
  maxReached: number;
  valuationId: string;
}) {
  return (
    <nav aria-label="Kroki wyceny" className="flex flex-wrap gap-1">
      {WIZARD_STEPS.map((s) => {
        const state = s.n < current ? "done" : s.n === current ? "active" : "todo";
        const reachable = s.n <= maxReached;
        const inner = (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs tabular-nums",
                state === "active" && "border-primary bg-primary text-primary-foreground",
                state === "done" && "border-primary/40 text-primary",
                state === "todo" && "border-border text-muted-foreground",
              )}
            >
              {s.n < current ? <Check className="size-3.5" /> : s.n}
            </span>
            <span
              className={cn(
                "text-sm",
                state === "active" ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </span>
        );
        return reachable ? (
          <Link
            key={s.n}
            href={`/valuations/${valuationId}?step=${s.n}`}
            aria-current={s.n === current ? "step" : undefined}
            className="rounded-md px-2 py-1 hover:bg-muted"
          >
            {inner}
          </Link>
        ) : (
          <span
            key={s.n}
            aria-disabled="true"
            className="cursor-not-allowed rounded-md px-2 py-1 opacity-50"
          >
            {inner}
          </span>
        );
      })}
    </nav>
  );
}

export function WizardNav({
  valuationId,
  back,
  next,
  nextLabel,
}: {
  valuationId: string;
  back?: number;
  next?: number;
  nextLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border pt-4">
      {back ? (
        <Button asChild variant="ghost">
          <Link href={`/valuations/${valuationId}?step=${back}`}>Wstecz</Link>
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button asChild>
          <Link href={`/valuations/${valuationId}?step=${next}`}>{nextLabel ?? "Dalej"}</Link>
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}
