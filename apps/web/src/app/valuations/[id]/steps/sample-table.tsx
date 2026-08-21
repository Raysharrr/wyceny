"use client";

import { Camera, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildingKey, candidateKey, type Candidate } from "@/domain/sample-selection";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { StreetViewSnapshot } from "@/domain/street-view-snapshot";
import { padObreb } from "@/domain/egib-id";
import { obrebName } from "@/domain/obreb-name";
import { rowBadges } from "./sample-badges";

export type SampleTableProps = {
  /** The rows THIS table renders — one section's worth (proposed or alternate), already resolved by the caller via `effectiveSelection`. */
  rows: Candidate[];
  /** Which section these rows belong to — drives the checkbox's checked state and aria-label. */
  kind: "proposed" | "alternate";
  /** Shared keyboard order across BOTH sections (proposed ∪ visible alternates) — owned by `SampleSections`, not derived locally. */
  allKeys: string[];
  reviewedKeys: ReadonlySet<string>;
  /** Keys carrying the "dodana ręcznie" badge (Slice 3c, Task 5) — defaults to empty, so existing/older callers need not pass it. */
  includedKeys?: ReadonlySet<string>;
  /** Only `flags` and `params.subjectEgib` are read off this — row membership comes from `rows`, not from re-deriving `effectiveSelection` here. */
  selection: SampleSelectionSnapshot;
  streetView: StreetViewSnapshot | null;
  streetViewEnabled: boolean;
  selectedKey: string | null;
  onSelect(key: string | null): void;
  /** The "w próbie" checkbox. proposed row unchecked (`inSample=false`) = a request to remove it from the sample; alternate row checked (`inSample=true`) = a request to add it. */
  onToggleInSample(key: string, inSample: boolean): void;
};

const pln = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Stable default for the optional `includedKeys` prop — one shared empty `Set`, not a fresh one per render. */
const NO_INCLUDED_KEYS: ReadonlySet<string> = new Set();

function Thumb({
  c,
  streetView,
  enabled,
}: {
  c: Candidate;
  streetView: StreetViewSnapshot | null;
  enabled: boolean;
}) {
  if (!enabled) return null;
  const b = buildingKey(c);
  const e = b ? streetView?.[b] : undefined;
  if (e?.thumbnailKey) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- bytea-served thumbnail, not an optimizable asset
      <img
        src={`/api/docs/${encodeURIComponent(e.thumbnailKey)}`}
        alt="Fasada budynku"
        className="h-10 w-16 rounded-md border object-cover"
        loading="lazy"
      />
    );
  }
  // No entry at all (enrichment skipped/failed for this building) vs. an
  // entry that ran but found no panorama (`panoId === null`) — two distinct
  // captions (final wave B11), same wording as `sample-panel.tsx`'s own
  // no-entry/no-panorama split. No capture-date suffix here (M3, final wave
  // addendum): `panoId === null` always means `captureDate === null` too,
  // so that suffix could never actually show — it was dead code.
  const caption = !e ? "brak miniaturki" : "brak zdjęcia ulicy";
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-10 w-16 place-items-center rounded-md border border-dashed bg-muted text-muted-foreground">
        <Camera className="size-4" />
      </div>
      <span className="text-[11px] leading-tight text-muted-foreground">{caption}</span>
    </div>
  );
}

/**
 * Step-3 candidate row list, ONE section at a time (spec §Krok 3 UI, layer
 * 1 — Slice 3c, Task 3): facade thumbnail, reviewed mark, date, obręb,
 * distance, area, price, floor, badges, and a "w próbie" checkbox. Which
 * rows to show (`rows`) and the shared keyboard order across BOTH sections
 * (`allKeys`) are computed by the caller
 * ({@link import("./sample-sections").SampleSections}) — this component
 * neither knows about `effectiveSelection` nor owns the "Alternatywy"
 * expand/collapse toggle (moved to `SampleSections`'s section header).
 * Keyboard: Enter/Space select, ↑/↓ move along `allKeys`, following DOM
 * focus via `data-key` (not `nextElementSibling`/`previousElementSibling` —
 * those can't cross the boundary between the two sections' separate
 * `<table>`s).
 */
export function SampleTable({
  rows,
  kind,
  allKeys,
  reviewedKeys,
  includedKeys = NO_INCLUDED_KEYS,
  selection,
  streetView,
  streetViewEnabled,
  selectedKey,
  onSelect,
  onToggleInSample,
}: SampleTableProps) {
  const subjectEgib = selection.params.subjectEgib;

  const move = (from: string, delta: 1 | -1) => {
    const i = allKeys.indexOf(from);
    // `from` (the current `selectedKey`) can fall outside `allKeys` once a
    // row leaves both sections it's rendered from — e.g. a rejected row
    // (Task 4 lets `selectedKey` point at one while its reasons UI is open).
    // `indexOf` returns -1 there; `allKeys[-1 + delta]` would silently wrap
    // to the array's last/second-to-last element instead of no-op'ing.
    if (i < 0) return;
    const next = allKeys[i + delta];
    if (!next) return;
    onSelect(next);
    document.querySelector<HTMLElement>(`[data-key="${next}"]`)?.focus();
  };

  const row = (c: Candidate) => {
    const key = candidateKey(c);
    const selected = key === selectedKey;
    const name = c.egib ? obrebName(c.egib) : null;
    const inSample = kind === "proposed";
    return (
      <TableRow
        key={key}
        data-key={key}
        tabIndex={0}
        aria-selected={selected}
        data-state={selected ? "selected" : undefined}
        data-testid={kind === "alternate" ? "alternate-row" : "proposed-row"}
        className={`cursor-pointer ${kind === "alternate" ? "text-muted-foreground" : ""}`}
        onClick={() => onSelect(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(key);
          }
          // Anchor on the CURRENT selection, not the row the keydown fired
          // on — a row can hold DOM focus without being `selectedKey` (e.g.
          // after Tab), and repeated arrow presses on a row whose selection
          // never changed (a controlled prop, updated by the parent) must
          // still walk forward from where the selection actually is.
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(selectedKey ?? key, 1);
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            move(selectedKey ?? key, -1);
          }
        }}
      >
        <TableCell>
          <Checkbox
            checked={inSample}
            // The mandated text ("Usuń z próby" / "Dodaj do próby") is the
            // PREFIX — identical across every row on its own, which made
            // the accessible name ambiguous for `getByRole("checkbox", {
            // name })` (Opus review, fix round 1). The row identity suffix
            // disambiguates without changing what the prefix says.
            aria-label={`${inSample ? "Usuń z próby" : "Dodaj do próby"} — ${c.date.slice(0, 7)}, ${Math.round(c.distanceM)} m, ${pln.format(c.pricePerM2)} zł/m²`}
            onCheckedChange={(v) => onToggleInSample(key, v === true)}
            onClick={(e) => e.stopPropagation()}
            // Space/Enter on the checkbox otherwise bubbles to this row's own
            // `onKeyDown` above (React keydown events bubble through the
            // native checkbox `<button>`), which would ALSO select the row —
            // stopping propagation here keeps the checkbox and the row as
            // two independent actions, mouse or keyboard (RTL evidence: see
            // rtl-sample-table.test.tsx's "does NOT select the row" case).
            onKeyDown={(e) => e.stopPropagation()}
          />
        </TableCell>
        <TableCell>
          {reviewedKeys.has(key) ? (
            <Check role="img" className="size-4 text-primary" aria-label="przejrzane" />
          ) : null}
        </TableCell>
        <TableCell>
          <Thumb c={c} streetView={streetView} enabled={streetViewEnabled} />
        </TableCell>
        <TableCell className="num">{c.date.slice(0, 7) || "—"}</TableCell>
        <TableCell>
          {c.egib ? (
            <>
              <span className="num">{padObreb(c.egib.obreb)}</span>{" "}
              {name ? <span className="text-muted-foreground">{name}</span> : null}
            </>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="num text-right">{Math.round(c.distanceM)} m</TableCell>
        <TableCell className="num text-right">{m2.format(c.area)}</TableCell>
        <TableCell className="num text-right">{pln.format(c.pricePerM2)}</TableCell>
        <TableCell className="num text-center">{c.floor ?? "—"}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {includedKeys.has(key) ? <Badge variant="secondary">dodana ręcznie</Badge> : null}
            {rowBadges(c, selection.flags[key] ?? [], subjectEgib).map((b) => (
              <Badge key={b.key} variant={b.tone}>
                {b.label}
              </Badge>
            ))}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Table aria-label={kind === "proposed" ? "W próbie" : "Alternatywy"}>
      <TableHeader>
        <TableRow>
          <TableHead aria-label="w próbie">W próbie</TableHead>
          <TableHead aria-label="przejrzane">✓</TableHead>
          <TableHead>Fasada</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Obręb</TableHead>
          <TableHead className="text-right">Odległość</TableHead>
          <TableHead className="text-right">Pow. (m²)</TableHead>
          <TableHead className="text-right">Cena (zł/m²)</TableHead>
          <TableHead className="text-center">Piętro</TableHead>
          <TableHead>Odznaki</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows.map(row)}</TableBody>
    </Table>
  );
}
