/** Shared valuation snapshot (T-06–T-09, F-3/F-10). Pure, additive contracts. */
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
 * `proposed`/`alternates` inside {@link ValuationInput.sampleSelection}. Declared
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
  /** Stable row id assigned at save, also for incomplete registry identities. */
  id?: string;
  /** Transaction month, e.g. "2024-07" — display metadata only. */
  date?: string;
  /** Usable area in m² — display metadata only. */
  area?: number;
  /** Saved unit price in zł/m². Neither method changes import/storage precision. */
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
  /** Historical absence means three levels. */
  ratingScale?: RatingScale;
  /** Catalog key or `inne`; required and unique for PP cell identity. Ignored by KCS arithmetic. */
  key?: string;
  /** Per-level definitions: validated for new operations and included in the PP confirmation basis. */
  definitions?: Partial<Record<FeatureRating, string>> | null;
};

export type ValuationInput = {
  method?: ValuationMethod;
  methodConfirmed?: boolean;
  pairwise?: PairwiseSnapshot | null;
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

export type ValuationMethod = "kcs" | "pp";
export type RatingScale = "two" | "three";
export type PairwiseCell = {
  rating: FeatureRating | null;
  multiplier: number | null;
  overrideReason?: string;
};
export type PairwiseSnapshot = {
  selectedComparableIds: string[];
  comparisons: Record<string, Record<string, PairwiseCell>>;
  /** Server stamps pairwiseBasis after a deliberate confirmation. */
  confirmedBasis?: string;
};
export type CalculationIssue = { path: string; label: string };
/** Compatibility alias, never a separate snapshot model. */
export type KcsInput = ValuationInput;

export class ValuationCalculationError extends Error {
  constructor(public readonly issues: CalculationIssue[]) {
    super(issues.map((issue) => issue.label).join("; "));
    this.name = "ValuationCalculationError";
  }
}

/** Missing method is historical KCS only for reading/arithmetic, not readiness. */
export function resolveMethod(input: ValuationInput): ValuationMethod {
  if (input.method === undefined) return "kcs";
  if (input.method === "kcs" || input.method === "pp") return input.method;
  throw new ValuationCalculationError([{ path: "method", label: "Nieznana metoda wyceny." }]);
}
