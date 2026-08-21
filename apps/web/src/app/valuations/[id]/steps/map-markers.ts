import { plural } from "@/components/wizard/plural";
import { candidateKey } from "@/domain/sample-selection";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";

export type DotKind = "proposed" | "alternate" | "rejected";

export type Dot = {
  key: string;
  pos: { x: number; y: number };
  kind: DotKind;
  date: string;
  pricePerM2: number;
  distanceM: number;
  /** `null` for `RejectedRow`s — the compact shape carries no floor. */
  floor: number | null;
};

type DotSource = {
  transactionId: string;
  lokalId: string;
  pos: { x: number; y: number } | null;
  date: string;
  pricePerM2: number;
  distanceM: number;
  floor?: number | null;
};

const priceFmt = new Intl.NumberFormat("pl-PL");
const price = (v: number) => `${priceFmt.format(Math.round(v))} zł/m²`;

/**
 * Every row the map draws, in draw order rejected → alternate → proposed so
 * proposed ends on top. Reads ONLY `effectiveSelection(snap)` (proposed /
 * alternates / removed — on the 3c branch `proposed` already carries manual
 * inclusions) plus the sampled `snap.rejected`. Rows without `pos` are skipped.
 */
export function buildDots(snap: SampleSelectionSnapshot): Dot[] {
  const eff = effectiveSelection(snap);
  const dots: Dot[] = [];
  const push = (row: DotSource, kind: DotKind) => {
    if (!row.pos) return;
    dots.push({
      key: candidateKey(row),
      pos: row.pos,
      kind,
      date: row.date,
      pricePerM2: row.pricePerM2,
      distanceM: row.distanceM,
      floor: row.floor ?? null,
    });
  };
  for (const r of snap.rejected ?? []) push(r, "rejected");
  for (const c of eff.removed) push(c, "rejected");
  for (const c of eff.alternates) push(c, "alternate");
  for (const c of eff.proposed) push(c, "proposed");
  return dots;
}

export function posKey(pos: { x: number; y: number }): string {
  return `${pos.x},${pos.y}`;
}

/**
 * Lokale of one building share the building's EGiB centroid, so an EXACT
 * coordinate match means "same building". Insertion order is kept (the
 * ranking order of the table).
 */
export function groupByPos(dots: Dot[]): Map<string, Dot[]> {
  const groups = new Map<string, Dot[]>();
  for (const d of dots) {
    const k = posKey(d.pos);
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }
  return groups;
}

export function bestKind(dots: Dot[]): DotKind {
  if (dots.some((d) => d.kind === "proposed")) return "proposed";
  if (dots.some((d) => d.kind === "alternate")) return "alternate";
  return "rejected";
}

/** "16 propozycji: 3 w próbie · 2 alternatywy · 11 odrzuconych" */
export function buildingSummary(dots: Dot[]): string {
  const n = dots.length;
  const a = dots.filter((d) => d.kind === "proposed").length;
  const b = dots.filter((d) => d.kind === "alternate").length;
  const c = n - a - b;
  return `${n} ${plural(n, "propozycja", "propozycje", "propozycji")}: ${a} w próbie · ${b} ${plural(b, "alternatywa", "alternatywy", "alternatyw")} · ${c} ${plural(c, "odrzucona", "odrzucone", "odrzuconych")}`;
}

export function dotTooltip(d: Dot): string {
  return `${d.date} · ${price(d.pricePerM2)} · ${Math.round(d.distanceM)} m`;
}

/** Same vocabulary as the table: "propozycja … · w próbie | alternatywa". */
export function dotAriaLabel(d: Dot): string {
  const kindLabel = d.kind === "proposed" ? "w próbie" : "alternatywa";
  return `propozycja ${dotTooltip(d)} · ${kindLabel}`;
}

/** On a spider leg the building is the context: month, price, floor. */
export function spiderTooltip(d: Dot): string {
  const floor = d.floor == null ? "" : ` · p. ${d.floor}`;
  return `${d.date.slice(0, 7)} · ${price(d.pricePerM2)}${floor}`;
}

const SPIDER_BASE_PX = 26;
const SPIDER_STEP_PX = 3;

/** Pixel offsets of n spider legs: radius grows with n so 16 lokale stay apart; first at 12 o'clock, clockwise. */
export function spiderOffsets(n: number): { dx: number; dy: number }[] {
  const r = SPIDER_BASE_PX + SPIDER_STEP_PX * n;
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { dx: r * Math.cos(angle), dy: r * Math.sin(angle) };
  });
}

export type RingStyle = "active" | "inner" | "outer";

/**
 * All of `DEFAULTS.radiusStepsM` are drawn: the used radius solid (active),
 * smaller ones solid and thinner, larger ones thin/dashed/faded — a cheap
 * "what 1000 m would cover" hint on a zoomable map.
 */
export function ringStyle(radiusM: number, radiusUsedM: number): RingStyle {
  if (radiusM === radiusUsedM) return "active";
  return radiusM < radiusUsedM ? "inner" : "outer";
}

/** Half-side of the initial view so the active ring always fits. */
export function viewHalfM(radiusUsedM: number): number {
  return Math.max(300, radiusUsedM * 1.2);
}

/** Legend count: automatic rejections (all reasons) + manual ones — deliberately larger than the drawn rejected dots. */
export function rejectedCensus(snap: SampleSelectionSnapshot): number {
  return (
    Object.values(snap.rejectedCounts ?? {}).reduce((sum, n) => sum + (n ?? 0), 0) +
    (snap.manualRejections?.length ?? 0)
  );
}
