import { kcsReady } from "./feature-rules";
import type { KcsInput } from "./kcs";
import type { Valuation } from "../ports/valuation";

/** Wizard steps — labels are UI copy (Polish), mirror of mockup shared.jsx STEPS. */
export const WIZARD_STEPS = [
  { n: 1, label: "Przedmiot" },
  { n: 2, label: "Oględziny" },
  { n: 3, label: "Próba" },
  { n: 4, label: "Cechy" },
  { n: 5, label: "Kalkulacja" },
  { n: 6, label: "Opisy" },
  { n: 7, label: "Operat" },
] as const;

/**
 * Soft gating (spec decision 1): the furthest reachable step is DERIVED from
 * what the draft already holds — no separate progress state to migrate or
 * desync. Step 2 (photos) is an optional pass-through. Step 6 is NOT, and has
 * not been since ADR-014: it generates the operat's descriptive sections and
 * the F-4 gate refuses approval without them. The derivation below is
 * unchanged and still correct — step 6 opens once the calculation is
 * confirmed — only this comment had gone stale.
 */
export function maxReachedStep(v: Pick<Valuation, "status" | "wr" | "inputs">): number {
  if (v.status !== "in_progress" || v.wr != null) return 7;
  if ((v.inputs?.features?.length ?? 0) > 0) return 5;
  if ((v.inputs?.comparables?.length ?? 0) > 0) return 4;
  return 3;
}

export function resolveStep(param: string | undefined, max: number): number {
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) return max;
  return Math.min(n, max);
}

export function calculationReady(inputs: KcsInput | null): boolean {
  return (
    inputs != null &&
    inputs.comparables.length >= 3 &&
    inputs.features.length > 0 &&
    kcsReady(inputs)
  );
}

/**
 * Which step owns which blocker, keyed by the `path` that `approvalGate` and
 * `documentFieldBlockers` emit. Longest prefix wins, so the group keys below
 * also answer for `comparables[3]`, `kw.kwGruntu` and `prose.uzasadnienie`.
 *
 * Kept next to the step list itself: this is the same ordering the wizard
 * already encodes, and a second copy — in the step-7 card, say, and again in
 * the approve action — could disagree about where a blocker is fixed.
 */
const BLOCKER_STEP: Record<string, number> = {
  // Step 1 (Przedmiot): the address, everything read off it (EGiB/MPZP, the
  // geocoding), the land-register extract and the area it carried — plus the
  // operat's header fields, which live on the same form.
  "provenance.address": 1,
  "provenance.area": 1,
  "provenance.geocode": 1,
  "provenance.ewidencja": 1,
  "provenance.mpzp": 1,
  // B-02 (M-10): the designation is chosen on the same step-1 form.
  "subject.przeznaczenieRodzaj": 1,
  "provenance.kw": 1,
  kw: 1,
  // Spelled out rather than left to the `kw` prefix: B-06 and B-07 are the
  // two blockers people land on most, and a future rename of the prefix must
  // not quietly strand them (ADR-018).
  "kw.badanie": 1,
  encumbranceTreatment: 1,
  purpose: 1,
  kwNumber: 1,
  client: 1,
  // Step 2 (Oględziny).
  inspectionDate: 2,
  // B-01 (M-1): the exterior photos of the building — the first of them is the
  // operat's cover, so the blocker has to land on the step that uploads them.
  "inspection.photos.budynekZewn": 2,
  // Step 3 (Próba): the sample's size and every transaction in it.
  comparables: 3,
  // Step 4 (Cechy): weights, ratings and the rating-scale definitions.
  "provenance.weights": 4,
  "provenance.ratings": 4,
  "provenance.featureDefs": 4,
  // ADR-016: each feature's rating against its scale (B-08…B-10).
  features: 4,
  // Step 5 (Kalkulacja).
  wr: 5,
  // Step 6 (Opisy): the prose snapshot and each of its seven sections.
  prose: 6,
};

export type WizardStep = { n: number; label: string };

/**
 * Where a blocker is fixed. Not every one is fixed in the wizard: the author's
 * name, licence number, office block and OC policy (B-15, B-16) belong to the
 * APPRAISER rather than to this valuation, and live on `/profile` — a
 * destination with no step number, which is why this is a union instead of a
 * widened `WizardStep`.
 */
export type BlockerTarget =
  { kind: "step"; step: WizardStep } | { kind: "page"; href: string; label: string };

/** Paths leading outside the wizard. `profile` also answers for `profile.polisa`. */
const BLOCKER_PAGE: Record<string, { href: string; label: string }> = {
  profile: { href: "/profile", label: "Profil rzeczoznawcy" },
};

/**
 * Where a blocker can actually be fixed — what step 7 links to since T8
 * stopped confirming there.
 *
 * An unmapped path returns `undefined` ON PURPOSE, and the caller then renders
 * the blocker with no link. `provenance.address` and a future
 * `provenance.somethingNew` are one prefix apart, so falling back to a sibling
 * key would send the appraiser to a screen that cannot clear the blocker —
 * a wasted round trip, and one that teaches them not to trust the next link.
 * Silence is recoverable; a wrong destination is not.
 */
export function blockerTarget(path: string): BlockerTarget | undefined {
  const segments = path.replace(/\[\d+\]/g, "").split(".");
  for (let i = segments.length; i > 0; i--) {
    const key = segments.slice(0, i).join(".");
    const n = BLOCKER_STEP[key];
    if (n != null) {
      const step = WIZARD_STEPS.find((s) => s.n === n);
      if (step) return { kind: "step", step };
    }
    const page = BLOCKER_PAGE[key];
    if (page) return { kind: "page", ...page };
  }
  return undefined;
}

/** The wizard-step half of {@link blockerTarget} — `undefined` for `/profile` too. */
export function stepForBlockerPath(path: string): WizardStep | undefined {
  const target = blockerTarget(path);
  return target?.kind === "step" ? target.step : undefined;
}
