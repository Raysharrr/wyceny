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

/**
 * Appraiser's explicit addition of a row outside the domain's proposal (Slice
 * 3c). Carries the full {@link Candidate} at inclusion time — not just a key
 * — so the addition survives a later radius change: `applyManualOverlay`
 * re-attaches it from `candidate` when its key is no longer in the current
 * `proposed`/`alternates` lists.
 */
export type ManualInclusion = {
  transactionId: string;
  lokalId: string;
  /** ISO timestamp — the UI's clock, never the domain's. */
  at: string;
  candidate: Candidate;
};

/**
 * Review trail entry — marks that the appraiser has looked at this row.
 * Purely informational (UI badge): it never gates or changes the sample.
 */
export type ReviewedMark = {
  transactionId: string;
  lokalId: string;
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

/**
 * Overlay of BOTH the appraiser's manual rejections AND manual inclusions on
 * the domain's result (Slice 3c). Rejections are applied first, exactly as
 * in {@link applyManualRejections} (untouched base behaviour); inclusions
 * are layered on top and are an explicit override — they bypass `DEMOTING`
 * flags, `maxPerBuilding` and `proposedN` entirely (the appraiser's choice
 * wins). Rejection beats inclusion for the same key. An inclusion already
 * present in the base `proposed` is a no-op; duplicate inclusion keys count
 * once. An inclusion whose row is still in `alternates` is spliced into
 * `proposed` in ranking order; one that has fallen out of both lists (e.g. a
 * smaller radius) is re-attached from its stored `candidate`, appended at
 * the end. `removed` is unaffected by inclusions.
 */
export function applyManualOverlay(
  sel: { proposed: Candidate[]; alternates: Candidate[]; flags: Record<string, Flag[]> },
  overlay: { rejections: readonly ManualRejection[]; inclusions: readonly ManualInclusion[] },
  opts: { proposedN?: number; maxPerBuilding?: number } = {},
): { proposed: Candidate[]; alternates: Candidate[]; removed: Candidate[]; included: Candidate[] } {
  const base = applyManualRejections(sel, overlay.rejections, opts);
  const rejectedKeys = new Set(overlay.rejections.map((r) => candidateKey(r)));
  const baseProposedKeys = new Set(base.proposed.map(candidateKey));
  const baseAlternatesByKey = new Map(base.alternates.map((c) => [candidateKey(c), c]));

  const fromAlternatesKeys = new Set<string>();
  const reattached: Candidate[] = [];
  const seen = new Set<string>();
  for (const inclusion of overlay.inclusions) {
    const key = candidateKey(inclusion);
    if (rejectedKeys.has(key) || seen.has(key) || baseProposedKeys.has(key)) continue;
    seen.add(key);
    if (baseAlternatesByKey.has(key)) {
      fromAlternatesKeys.add(key);
    } else {
      reattached.push(inclusion.candidate);
    }
  }

  // Ranking order for the from-alternates group — mirrors `removed`'s
  // ordering above (filter the ranked concat, don't re-sort).
  const fromAlternates = [...sel.proposed, ...sel.alternates].filter((c) =>
    fromAlternatesKeys.has(candidateKey(c)),
  );
  const included = [...fromAlternates, ...reattached];
  const includedKeys = new Set(included.map(candidateKey));

  return {
    proposed: [...base.proposed, ...included],
    alternates: base.alternates.filter((c) => !includedKeys.has(candidateKey(c))),
    removed: base.removed,
    included,
  };
}
