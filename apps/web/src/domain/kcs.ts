/**
 * KCS engine — comparative approach ("korygowanie ceny średniej"), the pure
 * core validated by the 2026-05-14 spike (5/5 reference operaty, error
 * ≤0.16%; wiki repo `tools/spike/2026-05-14-kcs/`).
 *
 * ZERO I/O, ZERO adapter imports (F-10). Deterministic by construction:
 * no Date, no randomness (F-2). Inputs come from the caller; persisted
 * snapshots make every result reproducible offline (F-3).
 *
 * OPERAT ROUNDING CONVENTION (domain rule — F-1 depends on it): the operat
 * document rounds intermediates as it prints them and keeps calculating on
 * the ROUNDED values. The engine mirrors the document, not pure arithmetic:
 * the convention itself is declared in `ROUNDING` below;
 * half-up everywhere (values are always positive here). Full-precision math
 * would yield 1 043 900 for Kościelna instead of the operat's 1 044 400.
 */

import type { ProvenanceStatus } from "@wyceny/shared";
import type { CandidatePool } from "../ports/sample";
import type { KwMetaSnapshot, KwSnapshot } from "./kw-snapshot";
import type { InputsProvenance } from "./provenance";
import type { SubjectMetaSnapshot, SubjectSnapshot } from "./subject-snapshot";
import type { InspectionSnapshot } from "./inspection";
import type { ProseSnapshot } from "./prose-snapshot";
import type { SampleSelectionSnapshot } from "./sample-snapshot";
import type { StreetViewSnapshot } from "./street-view-snapshot";

/**
 * The RCN pool fetch's provenance for the whole sample (F-5) — `CandidatePool`
 * (`ports/sample.ts`) minus `candidates`, which live instead as
 * `proposed`/`alternates` inside {@link KcsInput.sampleSelection}. Declared
 * locally (not imported from `ports/sample`) so this file's only dependency
 * on that port is the type-only `CandidatePool` import below, itself erased
 * at compile time (F-10 — domain stays pure, no runtime port dependency).
 */
export type SampleMeta = Omit<CandidatePool, "candidates">;

export type FeatureRating = "gorsza" | "przecietna" | "lepsza";

/**
 * Where a comparable came from (B1, S1 of the "Prawo spółdzielcze" block).
 * `rcn` and `rejestr_sm` are registers — machine-fetched rows that arrive
 * `to_verify`; `manual` is typed by the appraiser. Underscore on purpose:
 * this enum keeps the `rcn`/`manual` convention (`CandidatePool.source`
 * keeps its own hyphenated one). A new source is added here, once.
 */
export const COMPARABLE_SOURCES = ["rcn", "rejestr_sm", "manual"] as const;
export type ComparableSource = (typeof COMPARABLE_SOURCES)[number];
export type RegistrySource = Exclude<ComparableSource, "manual">;
export const REGISTRY_LABEL: Record<RegistrySource, string> = {
  rcn: "RCN",
  rejestr_sm: "Rejestr SM",
};
/**
 * Where a candidate POOL came from (`CandidatePool.source`, hyphenated by
 * convention) and the one mapping onto `Comparable.source` — S3: the only
 * place "rejestr-sm" becomes "rejestr_sm".
 */
export const POOL_SOURCES = ["rcn-wfs-gugik", "rejestr-sm"] as const;
export type PoolSource = (typeof POOL_SOURCES)[number];
const POOL_TO_COMPARABLE: Record<PoolSource, RegistrySource> = {
  "rcn-wfs-gugik": "rcn",
  "rejestr-sm": "rejestr_sm",
};
export function registrySourceOfPool(pool: PoolSource): RegistrySource {
  return POOL_TO_COMPARABLE[pool];
}
/** True for rows fetched from a register — the ones provenance re-verifies. */
export function isRegistrySourced<T extends { source?: ComparableSource }>(
  c: T,
): c is T & { source: RegistrySource } {
  return c.source === "rcn" || c.source === "rejestr_sm";
}

export type Comparable = {
  /** Transaction month, e.g. "2024-07" — display metadata only. */
  date?: string;
  /** Usable area in m² — display metadata only. */
  area?: number;
  /** Unit price in zł/m² — the only field the engine consumes. */
  pricePerM2: number;
  /** Provenance: RCN auto-fetch vs manual entry — display/audit metadata only (F-5). */
  source?: ComparableSource;
  /** RCN transaction id when source === "rcn" — display/audit metadata only. */
  transactionId?: string;
  /**
   * RCN lokal id when source === "rcn" — one notarial act (`transactionId`)
   * can carry SEVERAL lokale; this distinguishes them (mirrors
   * `Candidate.lokalId`/`candidateKey` in `domain/sample-selection.ts`).
   * Additive, optional: older drafts saved before this field existed keep
   * parsing. Display/audit metadata only, like `transactionId`.
   */
  lokalId?: string;
  /**
   * `coop_transaction.id` when the row came from the office's cooperative
   * register (`source === "rejestr_sm"`) — the unforgeable signal for that
   * source, the way `transactionId` is for RCN (S2a; `assign-provenance.ts`
   * starts deriving from it in S3). Optional, additive, engine ignores it.
   */
  coopTxId?: string;
  /**
   * Provenance status (F-4) — assigned ONLY at the web ACL on draft save
   * (rcn rows enter as "to_verify", manual as "confirmed"); flipped to
   * "confirmed" by the confirm-sample mutation. Optional so legacy
   * snapshots keep parsing. The engine ignores it (like source/transactionId).
   */
  status?: ProvenanceStatus;
};

export type Feature = {
  name: string;
  /** Weight as a fraction (Σ over features = 1.0). UI works in %, converts before calling. */
  weight: number;
  rating: FeatureRating;
  /** Preset pool key (Slice 7, F-6) — display/audit metadata only; the engine never reads it. */
  key?: string;
  /** Per-level rating-scale definitions (Slice 7) — operat content only; the engine never reads them. */
  definitions?: Partial<Record<FeatureRating, string>> | null;
};

export type KcsInput = {
  comparables: Comparable[];
  /** Usable area of the subject property, m². */
  area: number;
  features: Feature[];
  /** RCN fetch provenance for the whole sample (F-5) — display/audit metadata only; computeKcs never reads this. */
  sampleMeta?: SampleMeta | null;
  /**
   * The domain's own selection over the fetched pool (ADR-015 "Dobor proby
   * v3", D7) — proposed/alternates/flags/counts, trimmed for persistence by
   * `toSampleSelectionSnapshot`. Display/audit metadata only; computeKcs
   * never reads this (it consumes `comparables`, assembled from `proposed`
   * at the web ACL).
   */
  sampleSelection?: SampleSelectionSnapshot | null;
  /** Frozen Street View per building (Slice 3, ADR-011) — display only; computeKcs never reads this. */
  streetView?: StreetViewSnapshot | null;
  /** Scalar provenance map (F-4) — see domain/provenance.ts. Optional: legacy snapshots lack it. */
  provenance?: InputsProvenance | null;
  /** Auto-fetched EGiB/MPZP subject snapshot — display/audit metadata only; computeKcs never reads this. */
  subject?: SubjectSnapshot | null;
  /** Fetch provenance for the subject snapshot (F-5) — display/audit metadata only. */
  subjectMeta?: SubjectMetaSnapshot | null;
  /** KW extract snapshot (Slice 6) — document-sourced only; display/audit metadata only; computeKcs never reads this. */
  kw?: KwSnapshot | null;
  /** Extraction provenance for the kw snapshot (F-5) — display/audit metadata only. */
  kwMeta?: KwMetaSnapshot | null;
  /** Step 1 "Lokal ma przynależną piwnicę" (T-12) — render only (basement clause, S4); computeKcs never reads this. Absent on drafts saved before S1. */
  hasBasement?: boolean | null;
  /** Inspection photos manifest + note (Slice 10, FR-2) — display/render only; computeKcs never reads this. */
  inspection?: InspectionSnapshot | null;
  /** LLM prose proposals + appraiser-confirmed text (ADR-014) — display/render only; computeKcs never reads this. */
  prose?: ProseSnapshot | null;
};

export type FeatureShare = Feature & {
  /** Ui — the feature's contribution: weight·vmax (lepsza), weight·vmin (gorsza), weight (przecietna). */
  value: number;
};

export type KcsResult = {
  csr: number;
  cmin: number;
  cmax: number;
  vmin: number;
  vmax: number;
  ui: FeatureShare[];
  sumUi: number;
  unitValue: number;
  wrUnrounded: number;
  /** Market value, rounded to full 100 zł — the operat's headline number. */
  wr: number;
};

/**
 * The operat rounding convention as data — the single source of truth for
 * these numbers, so the help pages import them instead of restating them.
 * Decimal places, except `wrNearest` which is in zł.
 */
export const ROUNDING = {
  csr: 2,
  vmin: 3,
  vmax: 3,
  sumUi: 3,
  unitValue: 2,
  wrNearest: 100,
} as const;

/** Half-up decimal rounding (positive inputs only in this domain). */
const roundTo = (value: number, dp: number): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

export function computeKcs(input: KcsInput): KcsResult {
  if (input.comparables.length === 0) {
    throw new Error("KCS engine: at least one comparable transaction is required");
  }
  if (!(input.area > 0)) {
    throw new Error("KCS engine: subject area must be > 0");
  }
  const prices = input.comparables.map((c) => {
    if (!(c.pricePerM2 > 0)) {
      throw new Error("KCS engine: every comparable price must be > 0");
    }
    return c.pricePerM2;
  });

  const cmin = Math.min(...prices);
  const cmax = Math.max(...prices);
  const csr = roundTo(prices.reduce((sum, p) => sum + p, 0) / prices.length, ROUNDING.csr);
  const vmin = roundTo(cmin / csr, ROUNDING.vmin);
  const vmax = roundTo(cmax / csr, ROUNDING.vmax);

  const ui: FeatureShare[] = input.features.map((f) => ({
    ...f,
    value:
      f.rating === "lepsza" ? f.weight * vmax : f.rating === "gorsza" ? f.weight * vmin : f.weight,
  }));
  const sumUi = roundTo(
    ui.reduce((sum, share) => sum + share.value, 0),
    ROUNDING.sumUi,
  );

  const unitValue = roundTo(csr * sumUi, ROUNDING.unitValue);
  // Groszy precision before the final 100 zł step. Plain currency precision,
  // kept as a literal — ROUNDING names the six steps of the convention above.
  const wrUnrounded = roundTo(unitValue * input.area, 2);
  const wr = Math.round(wrUnrounded / ROUNDING.wrNearest) * ROUNDING.wrNearest;

  return { csr, cmin, cmax, vmin, vmax, ui, sumUi, unitValue, wrUnrounded, wr };
}
