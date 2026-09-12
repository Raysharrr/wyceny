import type { ColumnMapping, SkipReason } from "../domain/coop-import";
import type { PropertyRight } from "../domain/property-right";
import type { SessionUser } from "./valuation";

/**
 * Port for the office's own register of cooperative-flat transactions
 * (T-13, blok "Prawo spółdzielcze"). One shared register for the whole
 * office; the cooperative is an attribute of a row, not a partition.
 * Backed by `coop_transaction` / `coop_import_batch` / `coop_column_mapping`
 * (migration 0014). Domain stays pure — this file is types only.
 */

/** Never defaulted: "nieustalona" until the appraiser states which it is (spec §5). */
export const PRICE_KINDS = ["transakcyjna", "ofertowa", "nieustalona"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export type CoopTransaction = {
  id: string;
  cooperative: string;
  /** As typed in the register, trimmed — "Piastowskie", "os. Orła Białego". */
  address: string;
  buildingNumber: string;
  /** "" when the register has no flat column — dedupe then degrades to (address|date|price). */
  flatNumber: string;
  area: number;
  priceTotal: number;
  /** Derived on read: priceTotal / area — NOT a column (spec §4.3). */
  pricePerM2: number;
  /** ISO date "YYYY-MM-DD". */
  date: string;
  priceKind: PriceKind;
  /** null = the register does not say — never a default (spec §5). */
  rightType: PropertyRight | null;
  rep: string | null;
  floor: number | null;
  rooms: number | null;
  buildYear: number | null;
  /** EPSG:2180; null = geocoder failed → "do poprawki", excluded from radius search. */
  pos: { x: number; y: number } | null;
  source: "xls" | "manual";
  dedupeKey: string;
};

/** What the import/domain produces: the adapter assigns `id`, `pricePerM2` is derived. */
export type NewCoopTransaction = Omit<CoopTransaction, "id" | "pricePerM2">;

export type CoopRegistryQuery = {
  cooperative?: string;
  /** Radius search in EPSG:2180 metres; rows with `pos = null` never match. */
  near?: { x: number; y: number; radiusM: number };
  /** ISO date — rows on/after it. */
  from?: string;
  /** Substring of address (case-insensitive). */
  text?: string;
  limit?: number;
  offset?: number;
};

export type CoopImportBatch = {
  id: string;
  cooperative: string;
  fileName: string;
  mapping: ColumnMapping;
  rowsInserted: number;
  rowsSkipped: { row: number; reason: SkipReason }[];
  createdBy: string;
};

export type CoopRegistryStats = {
  total: number;
  byCooperative: Record<string, number>;
  needsGeocoding: number;
  lastImport: { at: string; file: string; rows: number } | null;
};

export interface PortCoopRegistry {
  /** `as` switches the read to `app_role` under the office-level RLS policy (0014); omitted = superuser read. */
  list(q: CoopRegistryQuery, as?: SessionUser): Promise<{ rows: CoopTransaction[]; total: number }>;
  /** Inserts what is new by `dedupeKey`; re-importing the same file yields `inserted: 0`. */
  upsertMany(
    rows: NewCoopTransaction[],
    by: { userId: string; batchId: string | null },
  ): Promise<{ inserted: number; duplicates: number }>;
  /** Manual form: insert, or replace the row with that `id` (e.g. a corrected `pos`). */
  save(row: NewCoopTransaction & { id?: string }, by: { userId: string }): Promise<CoopTransaction>;
  remove(id: string): Promise<void>;
  stats(): Promise<CoopRegistryStats>;
  recordBatch(batch: CoopImportBatch): Promise<void>;
  getMapping(cooperative: string): Promise<ColumnMapping | null>;
  saveMapping(cooperative: string, mapping: ColumnMapping): Promise<void>;
}
