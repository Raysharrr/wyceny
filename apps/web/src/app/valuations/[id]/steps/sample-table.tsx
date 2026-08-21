"use client";

import { useState } from "react";
import { Camera, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildingKey, candidateKey, type Candidate } from "@/domain/sample-selection";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { StreetViewSnapshot } from "@/domain/street-view-snapshot";
import { padObreb } from "@/domain/egib-id";
import { obrebName } from "@/domain/obreb-name";
import { rowBadges } from "./sample-badges";

export type SampleTableProps = {
  selection: SampleSelectionSnapshot;
  streetView: StreetViewSnapshot | null;
  streetViewEnabled: boolean;
  selectedKey: string | null;
  onSelect(key: string | null): void;
};

const pln = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-10 w-16 place-items-center rounded-md border border-dashed bg-muted text-muted-foreground">
        <Camera className="size-4" />
      </div>
      {e ? (
        <span className="text-[11px] leading-tight text-muted-foreground">
          brak zdjęcia ulicy
          {e.captureDate ? (
            <>
              <br />
              Google z {e.captureDate.slice(0, 4)}
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Step-3 candidate review (spec §Krok 3 UI, layer 1): one row per candidate —
 * facade thumbnail, date, obręb, distance, area, price, floor, badges. Shows
 * the EFFECTIVE lists (domain result + manual overlay, Task 1). Alternates
 * collapse behind one button. Keyboard: Enter/Space select, ↑/↓ move.
 */
export function SampleTable({
  selection,
  streetView,
  streetViewEnabled,
  selectedKey,
  onSelect,
}: SampleTableProps) {
  const [showAlternates, setShowAlternates] = useState(false);
  const eff = effectiveSelection(selection);
  const subjectEgib = selection.params.subjectEgib;
  const visible = showAlternates ? [...eff.proposed, ...eff.alternates] : eff.proposed;
  const keys = visible.map(candidateKey);

  const move = (from: string, delta: 1 | -1) => {
    const i = keys.indexOf(from);
    const next = keys[i + delta];
    if (next) onSelect(next);
  };

  const row = (c: Candidate, alternate: boolean) => {
    const key = candidateKey(c);
    const selected = key === selectedKey;
    const name = c.egib ? obrebName(c.egib) : null;
    return (
      <TableRow
        key={key}
        tabIndex={0}
        aria-selected={selected}
        data-state={selected ? "selected" : undefined}
        data-testid={alternate ? "alternate-row" : "proposed-row"}
        className={`cursor-pointer ${alternate ? "text-muted-foreground" : ""}`}
        onClick={() => onSelect(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(key);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(key, 1);
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            move(key, -1);
          }
        }}
      >
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
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
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
        <TableBody>
          {eff.proposed.map((c) => row(c, false))}
          {showAlternates ? eff.alternates.map((c) => row(c, true)) : null}
        </TableBody>
      </Table>
      {eff.alternates.length ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          aria-expanded={showAlternates}
          onClick={() => setShowAlternates((v) => !v)}
        >
          {showAlternates ? <ChevronDown /> : <ChevronRight />} Alternatywy ({eff.alternates.length}
          )
        </Button>
      ) : null}
    </div>
  );
}
