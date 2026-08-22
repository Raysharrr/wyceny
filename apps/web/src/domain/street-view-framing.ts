import { buildingKey, type Candidate } from "./sample-selection";

/**
 * Camera framing per building — controller ruling after Spike C (2026-08-21):
 * with the camera < 20 m from the building and a flat pitch only the ground
 * floor is visible (6/40 tall buildings in the spike read as "no building");
 * a taller building needs a steeper pitch and a wider field of view when the
 * camera sits close.
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Max `floor` per building over the whole pool — a sold flat's floor is a
 * lower bound on the building's storey count (team-lead ruling 2026-08-21).
 * `null` when no candidate of that building has a floor; candidates without
 * an `egib` (no `buildingKey`) are skipped, same as `enrichStreetView`.
 */
export function storeysHintByBuilding(
  candidates: readonly Candidate[],
): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const c of candidates) {
    const b = buildingKey(c);
    if (!b) continue;
    const current = m.get(b);
    if (c.floor === null) {
      if (!m.has(b)) m.set(b, null);
      continue;
    }
    m.set(b, current == null ? c.floor : Math.max(current, c.floor));
  }
  return m;
}

/**
 * Street View camera framing (Static + Embed): `pitch` tilts up with
 * building height, `fov` widens when the camera is close so a tall facade
 * still fits the frame. `storeysHint` null (unknown) behaves like 0 storeys.
 */
export function framingFor(args: { storeysHint: number | null; cameraDistanceM: number | null }): {
  pitch: number;
  fov: number;
} {
  const storeys = args.storeysHint ?? 0;
  const pitch = clamp(10 + 2 * storeys, 5, 35);
  const fov = args.cameraDistanceM !== null && args.cameraDistanceM < 20 ? 90 : 80;
  return { pitch, fov };
}
