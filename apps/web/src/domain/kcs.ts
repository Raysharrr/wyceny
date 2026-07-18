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
 * csr→2dp, vmin/vmax→3dp, sumUi→3dp, unitValue→2dp, wr→nearest 100 zł;
 * half-up everywhere (values are always positive here). Full-precision math
 * would yield 1 043 900 for Kościelna instead of the operat's 1 044 400.
 */

import type { ProvenanceStatus } from "@wyceny/shared";
import type { SampleMeta } from "../ports/sample";
import type { KwMetaSnapshot, KwSnapshot } from "./kw-snapshot";
import type { InputsProvenance } from "./provenance";
import type { SubjectMetaSnapshot, SubjectSnapshot } from "./subject-snapshot";

export type FeatureRating = "gorsza" | "przecietna" | "lepsza";

export type Comparable = {
  /** Transaction month, e.g. "2024-07" — display metadata only. */
  date?: string;
  /** Usable area in m² — display metadata only. */
  area?: number;
  /** Unit price in zł/m² — the only field the engine consumes. */
  pricePerM2: number;
  /** Provenance: RCN auto-fetch vs manual entry — display/audit metadata only (F-5). */
  source?: "rcn" | "manual";
  /** RCN transaction id when source === "rcn" — display/audit metadata only. */
  transactionId?: string;
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
};

export type KcsInput = {
  comparables: Comparable[];
  /** Usable area of the subject property, m². */
  area: number;
  features: Feature[];
  /** RCN fetch provenance for the whole sample (F-5) — display/audit metadata only; computeKcs never reads this. */
  sampleMeta?: SampleMeta | null;
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
  const csr = roundTo(prices.reduce((sum, p) => sum + p, 0) / prices.length, 2);
  const vmin = roundTo(cmin / csr, 3);
  const vmax = roundTo(cmax / csr, 3);

  const ui: FeatureShare[] = input.features.map((f) => ({
    ...f,
    value:
      f.rating === "lepsza" ? f.weight * vmax : f.rating === "gorsza" ? f.weight * vmin : f.weight,
  }));
  const sumUi = roundTo(
    ui.reduce((sum, share) => sum + share.value, 0),
    3,
  );

  const unitValue = roundTo(csr * sumUi, 2);
  const wrUnrounded = roundTo(unitValue * input.area, 2);
  const wr = Math.round(wrUnrounded / 100) * 100;

  return { csr, cmin, cmax, vmin, vmax, ui, sumUi, unitValue, wrUnrounded, wr };
}
