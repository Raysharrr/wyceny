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
  return { dots, rings, subject: frame.toPx(center) };
}
