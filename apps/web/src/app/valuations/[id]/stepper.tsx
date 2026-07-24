import Link from "next/link";
import { Check } from "lucide-react";
import { WIZARD_STEPS } from "@/domain/wizard";
import { cn } from "@/lib/utils";

export function Stepper({
  current,
  maxReached,
  valuationId,
}: {
  current: number;
  maxReached: number;
  valuationId?: string;
}) {
  return (
    <nav
      aria-label="Kroki wyceny"
      className="sticky top-[60px] z-[39] flex h-[52px] items-stretch gap-0.5 overflow-x-auto border-b bg-muted px-6"
    >
      <Link
        href="/valuations"
        className="mr-2 flex shrink-0 items-center border-r pr-4 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        ← Wyceny
      </Link>
      {WIZARD_STEPS.map((s) => {
        const state = s.n < current ? "done" : s.n === current ? "active" : "todo";
        const reachable = s.n <= maxReached;
        // Advisor I6: without a valuationId (create mode) there is nowhere
        // for a step link to point — every step renders as a non-link span,
        // reachability notwithstanding.
        const asLink = reachable && valuationId !== undefined;
        const inner = (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                state === "done" && "border-primary bg-primary text-white",
                state === "active" &&
                  "border-primary bg-[var(--accent-050)] text-[var(--accent-700)]",
                state === "todo" && "border-border text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3.5" /> : s.n}
            </span>
            <span className="hidden text-[12.5px] font-medium sm:inline">{s.label}</span>
          </span>
        );
        return asLink ? (
          <Link
            key={s.n}
            href={`/valuations/${valuationId}?step=${s.n}`}
            aria-current={s.n === current ? "step" : undefined}
            className={cn(
              "flex h-full shrink-0 items-center border-b-2 border-transparent px-3",
              state === "active" ? "border-primary text-foreground" : "text-muted-foreground",
            )}
          >
            {inner}
          </Link>
        ) : (
          <span
            key={s.n}
            aria-disabled="true"
            className={cn(
              "flex h-full shrink-0 cursor-not-allowed items-center border-b-2 border-transparent px-3 text-muted-foreground",
              state === "active" && "border-primary text-foreground",
            )}
          >
            {inner}
          </span>
        );
      })}
    </nav>
  );
}
