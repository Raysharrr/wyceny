"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { candidateKey } from "@/domain/sample-selection";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { StreetViewSnapshot } from "@/domain/street-view-snapshot";
import { SampleTable } from "./sample-table";

export type SampleSectionsProps = {
  selection: SampleSelectionSnapshot;
  streetView: StreetViewSnapshot | null;
  streetViewEnabled: boolean;
  selectedKey: string | null;
  onSelect(key: string | null): void;
  onToggleInSample(key: string, inSample: boolean): void;
  reviewedKeys: ReadonlySet<string>;
  /** Initial "Alternatywy" expand state (`reviewStats.reviewed === 0` at the caller) — read once on mount, like the old `showAlternates` default. */
  defaultAlternatesOpen: boolean;
};

/**
 * Step-3 candidate review (spec §Krok 3 UI, layer 1 — Slice 3c, Task 3):
 * two sections, "W próbie" (the effective proposal) and "Alternatywy" (the
 * effective alternates, collapsed behind a button). Replaces the single
 * whole-selection `SampleTable` — `effectiveSelection` is computed HERE
 * (once), and both `SampleTable` instances render one already-resolved
 * `rows` list each. `allKeys` (the shared keyboard order) is likewise
 * computed here, ONCE, from the SAME `showAlternates` state that decides
 * whether the alternates section is even in the DOM — so it's always
 * "proposed ∪ visible alternates", never "proposed ∪ all alternates"
 * regardless of collapse state.
 */
export function SampleSections({
  selection,
  streetView,
  streetViewEnabled,
  selectedKey,
  onSelect,
  onToggleInSample,
  reviewedKeys,
  defaultAlternatesOpen,
}: SampleSectionsProps) {
  const [showAlternates, setShowAlternates] = useState(defaultAlternatesOpen);
  const eff = effectiveSelection(selection);
  const proposedKeys = eff.proposed.map(candidateKey);
  const alternateKeys = eff.alternates.map(candidateKey);
  const allKeys = showAlternates ? [...proposedKeys, ...alternateKeys] : proposedKeys;

  // Collapsing "Alternatywy" hides those rows again — if the panel is open
  // on one of them, leaving `selectedKey` pointed at a now-invisible row
  // would strand the panel (and let a stale ↑/↓ jump back to row 0, since
  // `allKeys` above is recomputed from the now-collapsed section). Closing
  // the panel (onSelect(null)) is simpler than trying to keep it open on a
  // hidden row. Mirrors the old `SampleTable`'s own `toggleAlternates`.
  const toggleAlternates = () => {
    const next = !showAlternates;
    setShowAlternates(next);
    if (!next && selectedKey && alternateKeys.includes(selectedKey)) {
      onSelect(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">W próbie ({eff.proposed.length})</h4>
        <SampleTable
          rows={eff.proposed}
          kind="proposed"
          allKeys={allKeys}
          reviewedKeys={reviewedKeys}
          selection={selection}
          streetView={streetView}
          streetViewEnabled={streetViewEnabled}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onToggleInSample={onToggleInSample}
        />
      </section>
      {eff.alternates.length ? (
        <section className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            aria-expanded={showAlternates}
            onClick={toggleAlternates}
          >
            {showAlternates ? <ChevronDown /> : <ChevronRight />} Alternatywy (
            {eff.alternates.length})
          </Button>
          {showAlternates ? (
            <SampleTable
              rows={eff.alternates}
              kind="alternate"
              allKeys={allKeys}
              reviewedKeys={reviewedKeys}
              selection={selection}
              streetView={streetView}
              streetViewEnabled={streetViewEnabled}
              selectedKey={selectedKey}
              onSelect={onSelect}
              onToggleInSample={onToggleInSample}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
