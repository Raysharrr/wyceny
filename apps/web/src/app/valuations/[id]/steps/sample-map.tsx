"use client";

import { useState } from "react";
import { candidateKey } from "@/domain/sample-selection";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { kiegWmsUrl, ortoWmsUrl } from "./embed-urls";
import { mapDots, type MapDot } from "./map-dots";

const PX = 640;

// Literal hex, not `var(--primary)`/`var(--destructive)` (globals.css:
// `--primary: var(--brand-teal) = #1f7a5c`, `--destructive` an oklch red
// close to `#e7000b`) — the dots sit in an SVG overlay on top of the WMS
// `<img>`, and a literal is exactly as themeable there while staying
// unambiguous if this markup is ever copied next to an `<img>` fallback
// (where `currentColor`/CSS vars don't resolve the same way).
const FILL: Record<MapDot["kind"], string> = {
  proposed: "#1f7a5c",
  alternate: "#9a978f",
  rejected: "#e7000b",
};

const DOT_RADIUS: Record<MapDot["kind"], number> = {
  proposed: 6,
  alternate: 4.5,
  rejected: 4,
};

const priceFmt = new Intl.NumberFormat("pl-PL");

/** "date · price" for the `<title>` native tooltip — every dot gets one. */
function dotTitle(date: string, pricePerM2: number): string {
  return `${date} · ${priceFmt.format(Math.round(pricePerM2))} zł/m²`;
}

/**
 * "kandydatka date · price · distance · propozycja|alternatywa" for the
 * clickable dot's `aria-label` (final wave A2/B2) — the SVG carries
 * `role="group"`, not `role="img"`, so each dot's own label is what makes
 * it discoverable to assistive tech, not one caption on the whole overlay.
 */
function dotAriaLabel(
  date: string,
  pricePerM2: number,
  distanceM: number,
  kind: "proposed" | "alternate",
): string {
  const kindLabel = kind === "proposed" ? "propozycja" : "alternatywa";
  return `kandydatka ${dotTitle(date, pricePerM2)} · ${Math.round(distanceM)} m · ${kindLabel}`;
}

/** date/pricePerM2/distanceM for every dot key, built once per render (proposed/alternates/removed + the sampled rejected rows). Keyed via the shared `candidateKey` (final wave B2), not a hand-rolled `${transactionId}|${lokalId}` — the exact key `mapDots` builds each dot with. */
function buildDotInfo(
  selection: SampleSelectionSnapshot,
): Map<string, { date: string; pricePerM2: number; distanceM: number }> {
  const eff = effectiveSelection(selection);
  const info = new Map<string, { date: string; pricePerM2: number; distanceM: number }>();
  for (const c of [...eff.proposed, ...eff.alternates, ...eff.removed]) {
    info.set(candidateKey(c), { date: c.date, pricePerM2: c.pricePerM2, distanceM: c.distanceM });
  }
  for (const r of selection.rejected ?? []) {
    info.set(candidateKey(r), { date: r.date, pricePerM2: r.pricePerM2, distanceM: r.distanceM });
  }
  return info;
}

/**
 * Overview map (Task 9, decision b, 2026-08-21): ONE GUGiK WMS `GetMap`
 * image (ORTO, falling back to KIEG on error) plus an SVG overlay drawing
 * radius rings and candidate dots on top — no Leaflet, no Google Maps. The
 * frame is square, `halfM` scaled from `radiusUsedM` so the active ring
 * always fits, and linear in EPSG:2180 (`mapFrame`/`map-dots.ts`, Task 2).
 */
export function SampleMap({
  selection,
  center,
  selectedKey,
  onSelect,
}: {
  selection: SampleSelectionSnapshot;
  center: { x: number; y: number };
  selectedKey: string | null;
  onSelect(key: string): void;
}) {
  const halfM = Math.max(300, selection.radiusUsedM * 1.2);
  // Identifies the frame by its primitives, not `center`'s object identity —
  // callers (e.g. `step-sample.tsx`) build `center` as a fresh literal every
  // render.
  const frameKey = `${center.x},${center.y},${halfM}`;
  const [src, setSrc] = useState(() => ortoWmsUrl(center, halfM, PX));
  // One-shot guard via REACT STATE, not a DOM dataset marker (the lesson
  // `sample-panel.tsx`'s own ORTO→KIEG fallback already learned).
  const [triedFallback, setTriedFallback] = useState(false);
  const [forFrame, setForFrame] = useState(frameKey);

  // setState during RENDER is safe here (same pattern as `sample-panel.tsx`'s
  // own candidate-switch reset) — React re-renders immediately with the new
  // state before anything commits to the DOM, so a frame change never lets a
  // STALE `src` (or a `triedFallback` left over from the OLD frame) flash on
  // screen the way a `useEffect`-based reset (which runs AFTER commit, and
  // which `eslint-plugin-react-hooks` flags for exactly this "cascading
  // render" risk) would.
  if (frameKey !== forFrame) {
    setForFrame(frameKey);
    setSrc(ortoWmsUrl(center, halfM, PX));
    setTriedFallback(false);
  }

  const { dots, rings, subject } = mapDots(selection, center, halfM, PX);
  const eff = effectiveSelection(selection);
  const dotInfo = buildDotInfo(selection);
  const rejectedCensus =
    Object.values(selection.rejectedCounts ?? {}).reduce((sum, n) => sum + (n ?? 0), 0) +
    (selection.manualRejections?.length ?? 0);

  return (
    <>
      <figure className="relative overflow-hidden rounded-lg border">
        {/* eslint-disable-next-line @next/next/no-img-element -- WMS tile, not an optimizable static asset */}
        <img
          key={frameKey}
          src={src}
          alt="Ortofotomapa GUGiK z kandydatkami"
          className="block w-full"
          onError={() => {
            if (triedFallback) return;
            setTriedFallback(true);
            setSrc(kiegWmsUrl(center, halfM, PX));
          }}
        />
        <svg
          viewBox={`0 0 ${PX} ${PX}`}
          className="absolute inset-0 h-full w-full"
          role="group"
          aria-label="Kandydatki na mapie"
        >
          {rings.map((r) => (
            <g key={r.radiusM}>
              <circle
                cx={subject.px}
                cy={subject.py}
                r={r.rPx}
                fill="none"
                stroke="#fff"
                strokeWidth={r.active ? 2 : 1}
                strokeDasharray={r.active ? undefined : "4 4"}
              />
              <text
                x={subject.px}
                y={subject.py - r.rPx - 4}
                fill="#fff"
                fontSize={11}
                textAnchor="middle"
                stroke="#0006"
                strokeWidth={2}
                paintOrder="stroke"
              >
                {r.radiusM} m
              </text>
            </g>
          ))}
          {dots.map((d) => {
            const clickable = d.kind !== "rejected";
            const found = dotInfo.get(d.key);
            return (
              <circle
                key={d.key}
                cx={d.px}
                cy={d.py}
                r={DOT_RADIUS[d.kind]}
                fill={FILL[d.kind]}
                stroke="#fff"
                strokeWidth={1.5}
                className={clickable ? "cursor-pointer" : undefined}
                data-testid={`dot-${d.kind}`}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                // Rejected dots carry no interaction and no label of their
                // own — hidden from assistive tech entirely (A2) rather than
                // an empty stop on the tab order or an unlabeled node.
                aria-hidden={clickable ? undefined : true}
                aria-label={
                  clickable && found
                    ? dotAriaLabel(
                        found.date,
                        found.pricePerM2,
                        found.distanceM,
                        d.kind as "proposed" | "alternate",
                      )
                    : undefined
                }
                onClick={clickable ? () => onSelect(d.key) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(d.key);
                        }
                      }
                    : undefined
                }
              >
                {found ? <title>{dotTitle(found.date, found.pricePerM2)}</title> : null}
              </circle>
            );
          })}
          {selectedKey
            ? (() => {
                const sel = dots.find((d) => d.key === selectedKey);
                return sel ? (
                  <circle
                    cx={sel.px}
                    cy={sel.py}
                    r={10}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth={2}
                  />
                ) : null;
              })()
            : null}
          {/* Subject marker — a diamond, distinct from the round candidate dots. */}
          <path
            d={`M ${subject.px} ${subject.py - 9} L ${subject.px + 9} ${subject.py} L ${subject.px} ${subject.py + 9} L ${subject.px - 9} ${subject.py} Z`}
            fill="var(--foreground)"
            stroke="#fff"
            strokeWidth={1.5}
          />
        </svg>
        <figcaption className="absolute left-2 bottom-2 flex gap-3 rounded-md bg-background/90 px-2 py-1 text-xs">
          <span>
            <span style={{ color: FILL.proposed }}>●</span> propozycja {eff.proposed.length}
          </span>
          <span>
            <span style={{ color: FILL.alternate }}>●</span> alternatywy {eff.alternates.length}
          </span>
          <span>
            <span style={{ color: FILL.rejected }}>●</span> odrzucone {rejectedCensus}
          </span>
        </figcaption>
      </figure>
      <p className="text-sm text-muted-foreground">
        Ortofotomapa GUGiK (WMS, EPSG:2180) · klik w kropkę podświetla wiersz i otwiera panel
      </p>
    </>
  );
}
