"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { candidateKey, type RejectReason } from "@/domain/sample-selection";
import type { ManualRejection } from "@/domain/sample-manual";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { groupRejected, REJECT_REASON_LABELS } from "./rejected-groups";

export type SampleRejectedProps = {
  selection: SampleSelectionSnapshot;
  onRestore(r: ManualRejection): void;
  /** Opens the side panel on a manually-rejected row (Task 4) — never called for an automatic-census row (no full `Candidate` to show). */
  onSelect(key: string): void;
};

const pln = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Step-3 "Odrzucone" section (spec §Krok 3 UI, mockup "Odrzucone (174)"
 * collapsed → grouped counters on expand). The header count is the FULL
 * census (`rejectedCounts` sum + the appraiser's own `manualRejections`),
 * never `rejected.length` — `rejected` is only a capped sample (nearest
 * {@link import("@/domain/sample-snapshot").REJECTED_PER_REASON} per
 * reason, see `sample-snapshot.ts`), so a group whose full count exceeds
 * what's shown reads "najbliższe K z M" instead of a plain "(K)". A
 * pre-Slice-3 snapshot (no `rejected` persisted) falls back to counts-only
 * badges per reason plus a hint to re-fetch for the row-level list.
 */
export function SampleRejected({ selection, onRestore, onSelect }: SampleRejectedProps) {
  const [open, setOpen] = useState(false);
  const autoTotal = Object.values(selection.rejectedCounts ?? {}).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );
  const manualCount = selection.manualRejections?.length ?? 0;
  const n = autoTotal + manualCount;

  const groups = groupRejected(selection);
  const manualByKey = new Map(
    (selection.manualRejections ?? []).map((m) => [candidateKey(m), m] as const),
  );

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown /> : <ChevronRight />}
        Odrzucone ({n})
      </Button>

      {open ? (
        <div className="flex flex-col gap-3">
          {!selection.rejected ? (
            <>
              <p className="text-sm text-muted-foreground">
                Lista odrzuconych dostępna po ponownym pobraniu próby.
              </p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(selection.rejectedCounts ?? {}).map(([reason, count]) => (
                  <Badge key={reason} variant="outline">
                    {REJECT_REASON_LABELS[reason as RejectReason]} · {count}
                  </Badge>
                ))}
              </div>
            </>
          ) : null}

          {groups.map((g) => {
            const manual = g.rows[0]?.manual ?? false;
            const total = manual ? undefined : selection.rejectedCounts?.[g.key as RejectReason];
            const showTotal = total !== undefined && total > g.rows.length;
            return (
              <section key={g.key}>
                <h4 className="text-sm font-medium">
                  {g.label}{" "}
                  <span className="num text-muted-foreground">
                    ({showTotal ? `najbliższe ${g.rows.length} z ${total}` : g.rows.length})
                  </span>
                </h4>
                <ul className="text-sm text-muted-foreground">
                  {g.rows.map((r) => {
                    const rowContent = (
                      <>
                        <span className="num">{r.date.slice(0, 7)}</span> ·{" "}
                        <span className="num">{m2.format(r.area)}</span> m² ·{" "}
                        <span className="num">{pln.format(r.pricePerM2)}</span> zł/m² ·{" "}
                        <span className="num">{Math.round(r.distanceM)}</span> m
                        {r.note ? <> · „{r.note}”</> : null}
                      </>
                    );
                    return (
                      <li key={r.key} className="flex flex-wrap items-center gap-1.5 py-0.5">
                        {r.manual ? (
                          // Manually-rejected rows carry a full `Candidate` (via
                          // `manualRejections`) — clickable, opens the side panel
                          // (Task 4). Automatic-census rows below stay plain text:
                          // no full `Candidate` to show (`statusOf` returns `null`
                          // for them — Controller ruling, Task 2 review).
                          <button
                            type="button"
                            className="cursor-pointer text-left underline-offset-2 hover:underline"
                            // Mirrors `sample-table.tsx`'s "w próbie" checkbox
                            // fix (Task 3 review): the mandated purpose text is
                            // the PREFIX, the row identity suffix disambiguates
                            // — the row's own numbers alone would make the
                            // accessible name ambiguous across rows.
                            aria-label={`Podgląd odrzuconej propozycji — ${r.date.slice(0, 7)}, ${Math.round(r.distanceM)} m, ${pln.format(r.pricePerM2)} zł/m²`}
                            onClick={() => onSelect(r.key)}
                          >
                            {rowContent}
                          </button>
                        ) : (
                          <span>{rowContent}</span>
                        )}
                        {r.manual ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              const m = manualByKey.get(r.key);
                              if (m) onRestore(m);
                            }}
                          >
                            Przywróć
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
