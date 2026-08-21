import { mapFrame } from "@/domain/geo";
import { DEFAULTS, candidateKey } from "@/domain/sample-selection";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";

export type MapDot = {
  key: string;
  px: number;
  py: number;
  kind: "proposed" | "alternate" | "rejected";
};
export type MapRing = { radiusM: number; rPx: number; active: boolean };

/** Ring radius (px) a duplicate dot is nudged onto — final wave minor ii. */
const OVERLAP_RING_PX = 7;

/**
 * Nudges dots that land on the EXACT same pixel (same building — e.g. two
 * lokale of one notarial act, whose candidates share a `pos`) onto a small
 * ring so every one of them stays individually clickable; two dots stacked
 * 1:1 leave only the top one reachable by click or keyboard (final wave
 * minor ii, team-lead 2026-08-21). The k-th dot at a shared position lands
 * at `angle = k · 2π/8` on a ring of {@link OVERLAP_RING_PX} — deterministic
 * (no randomness) and order-preserving (a single left-to-right `map`, no
 * grouping/reordering). A position held by exactly one dot is untouched.
 */
function spreadOverlaps(dots: MapDot[]): MapDot[] {
  const totalAt = new Map<string, number>();
  for (const d of dots) {
    const posKey = `${d.px},${d.py}`;
    totalAt.set(posKey, (totalAt.get(posKey) ?? 0) + 1);
  }
  const seenAt = new Map<string, number>();
  return dots.map((d) => {
    const posKey = `${d.px},${d.py}`;
    if ((totalAt.get(posKey) ?? 0) <= 1) return d;
    const k = seenAt.get(posKey) ?? 0;
    seenAt.set(posKey, k + 1);
    const angle = k * ((2 * Math.PI) / 8);
    return {
      ...d,
      px: d.px + OVERLAP_RING_PX * Math.cos(angle),
      py: d.py + OVERLAP_RING_PX * Math.sin(angle),
    };
  });
}

/**
 * Everything the overview SVG draws (Task 9), in pixels of a `px`-wide
 * square frame (linear in EPSG:2180, `mapFrame` from Task 2). `rejected`
 * dots come from BOTH the domain's hygiene/band sample (`snap.rejected`,
 * `RejectedRow.pos`) and the appraiser's own manual rejections
 * (`effectiveSelection(snap).removed`) — a candidate the appraiser rejected
 * is drawn as rejected even though it started out `proposed`/`alternate`.
 * Draw order matters to the caller: rejected → alternate → proposed, so
 * `proposed` dots end up on top.
 */
export function mapDots(
  snap: SampleSelectionSnapshot,
  center: { x: number; y: number },
  halfM: number,
  px: number,
) {
  const frame = mapFrame(center, halfM, px);
  const eff = effectiveSelection(snap);
  const dots: MapDot[] = [];
  const push = (key: string, pos: { x: number; y: number } | null, kind: MapDot["kind"]) => {
    if (!pos) return;
    const p = frame.toPx(pos);
    dots.push({ key, px: p.px, py: p.py, kind });
  };
  for (const r of snap.rejected ?? []) push(candidateKey(r), r.pos, "rejected");
  for (const c of eff.removed) push(candidateKey(c), c.pos, "rejected");
  for (const c of eff.alternates) push(candidateKey(c), c.pos, "alternate");
  for (const c of eff.proposed) push(candidateKey(c), c.pos, "proposed");
  const rings: MapRing[] = DEFAULTS.radiusStepsM
    .filter((r) => r <= halfM)
    .map((r) => ({ radiusM: r, rPx: r / frame.mPerPx, active: r === snap.radiusUsedM }));
  return { dots: spreadOverlaps(dots), rings, subject: frame.toPx(center) };
}
