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

import type { Feature, KcsInput } from "./valuation-input";
// Existing consumers keep their imports; there is one shared input model.
export * from "./valuation-input";

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
