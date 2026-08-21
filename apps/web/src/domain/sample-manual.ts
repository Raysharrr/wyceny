import { DEFAULTS, buildingKey, candidateKey, type Candidate, type Flag } from "./sample-selection";

/** Appraiser's manual rejection vocabulary — from wiki `kryteria-doboru-proby-biuro-anety` (typ/wiek budynku = filtr twardy; standard NIE jest kryterium doboru, ale rzeczoznawca może go podać jako powód). */
export const MANUAL_REJECTION_REASONS = [
  "building_older",
  "building_newer",
  "different_building_type",
  "different_standard",
  "too_far",
  "other",
] as const;
export type ManualRejectionReason = (typeof MANUAL_REJECTION_REASONS)[number];

export const MANUAL_REJECTION_LABELS: Record<ManualRejectionReason, string> = {
  building_older: "budynek starszy",
  building_newer: "budynek nowszy",
  different_building_type: "inna zabudowa (kamienica / blok / wielka płyta)",
  different_standard: "odbiega standardem",
  too_far: "za daleko",
  other: "inne",
};

export type ManualRejection = {
  transactionId: string;
  lokalId: string;
  reason: ManualRejectionReason;
  note?: string;
  /** ISO timestamp — the UI's clock, never the domain's. */
  at: string;
};

/** Flags that keep a row out of `proposed` (ADR-015 rules 5 and 7) — mirrors selectSample's own demotion. */
const DEMOTING: readonly Flag[] = ["price_outlier", "primary_suspect"];

/**
 * Overlay of the appraiser's manual rejections on the domain's result.
 * Pure, order-preserving: removes rejected rows from both lists, then refills
 * `proposed` from `alternates` in ranking order, skipping demoted flags and
 * honouring `maxPerBuilding`. Runs ON the selection, never inside it — the
 * ranking (F-14) is untouched. Unknown keys are ignored.
 */
export function applyManualRejections(
  sel: { proposed: Candidate[]; alternates: Candidate[]; flags: Record<string, Flag[]> },
  rejections: readonly ManualRejection[],
  opts: { proposedN?: number; maxPerBuilding?: number } = {},
): { proposed: Candidate[]; alternates: Candidate[]; removed: Candidate[] } {
  const proposedN = opts.proposedN ?? DEFAULTS.proposedN;
  const maxPerBuilding = opts.maxPerBuilding ?? DEFAULTS.maxPerBuilding;
  const rejected = new Set(rejections.map((r) => candidateKey(r)));
  const removed = [...sel.proposed, ...sel.alternates].filter((c) => rejected.has(candidateKey(c)));
  const proposed = sel.proposed.filter((c) => !rejected.has(candidateKey(c)));
  const alternates = sel.alternates.filter((c) => !rejected.has(candidateKey(c)));

  const perBuilding = new Map<string, number>();
  for (const c of proposed) {
    const b = buildingKey(c);
    if (b) perBuilding.set(b, (perBuilding.get(b) ?? 0) + 1);
  }
  const rest: Candidate[] = [];
  for (const c of alternates) {
    const flags = sel.flags[candidateKey(c)] ?? [];
    const b = buildingKey(c);
    const demoted = flags.some((f) => DEMOTING.includes(f));
    const full = b !== null && (perBuilding.get(b) ?? 0) >= maxPerBuilding;
    if (proposed.length < proposedN && !demoted && !full) {
      proposed.push(c);
      if (b) perBuilding.set(b, (perBuilding.get(b) ?? 0) + 1);
    } else {
      rest.push(c);
    }
  }
  return { proposed, alternates: rest, removed };
}
