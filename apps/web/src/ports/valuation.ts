/**
 * Port for the Valuation repository.
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10). The one exception is this
 * type-only import of `KcsInput` — it stays pure because type imports are
 * erased at compile time (no runtime dependency, no I/O).
 */

import type { KcsInput } from "../domain/kcs";

export type Valuation = {
  id: string;
  address: string;
  area: number;
  wr: number;
  inputs: KcsInput | null;
  amountInWords: string | null;
  docUrl: string | null;
  ownerId: string;
  status: "in_progress" | "signed";
  createdAt: Date;
};

export type NewValuationInput = {
  address: string;
  area: number;
  wr: number;
  inputs: KcsInput | null;
  amountInWords: string | null;
  docUrl: string | null;
  ownerId: string;
};

/** Session user shape used by the repo; `role` drives ownership isolation (F-8, ADR-013). */
export type SessionUser = {
  id: string;
  role: "admin" | "appraiser";
};

export interface PortValuation {
  create(input: NewValuationInput): Promise<Valuation>;
  listForUser(user: SessionUser): Promise<Valuation[]>;
  get(id: string, user: SessionUser): Promise<Valuation | null>;
  /**
   * Looks up the Valuation whose `docUrl` matches the given PortStorage key,
   * applying the same ownership rule as `get` (admin → any; appraiser →
   * only their own). Returns `null` both when no such Valuation exists and
   * when it exists but isn't visible to `user` — callers must not
   * distinguish the two (no existence leak). Backs the `/api/docs/[key]`
   * auth gate (Task 11a).
   */
  getByDocKey(key: string, user: SessionUser): Promise<Valuation | null>;
}
