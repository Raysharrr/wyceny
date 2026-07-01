/**
 * Port for the Wycena repository.
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10).
 */

export type Wycena = {
  id: string;
  address: string;
  area: number;
  stubWr: number;
  slownie: string | null;
  docUrl: string | null;
  ownerId: string;
  status: "w_toku" | "podpisany";
  createdAt: Date;
};

export type NewWycenaInput = {
  address: string;
  area: number;
  stubWr: number;
  slownie: string | null;
  docUrl: string | null;
  ownerId: string;
};

/** Session user shape used by the repo; `role` drives ownership isolation (F-8, ADR-013). */
export type SessionUser = {
  id: string;
  role: "admin" | "rzeczoznawca";
};

export interface PortWyceny {
  create(input: NewWycenaInput): Promise<Wycena>;
  listForUser(user: SessionUser): Promise<Wycena[]>;
  get(id: string, user: SessionUser): Promise<Wycena | null>;
  /**
   * Looks up the Wycena whose `docUrl` matches the given PortStorage key,
   * applying the same ownership rule as `get` (admin → any; rzeczoznawca →
   * only their own). Returns `null` both when no such Wycena exists and
   * when it exists but isn't visible to `user` — callers must not
   * distinguish the two (no existence leak). Backs the `/api/docs/[key]`
   * auth gate (Task 11a).
   */
  getByDocKey(key: string, user: SessionUser): Promise<Wycena | null>;
}
