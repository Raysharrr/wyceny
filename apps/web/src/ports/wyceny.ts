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

/** Session user shape used by the repo now; `role` is used for access control in Task 7. */
export type SessionUser = {
  id: string;
  role: "admin" | "rzeczoznawca";
};

export interface PortWyceny {
  create(input: NewWycenaInput): Promise<Wycena>;
  listForUser(user: SessionUser): Promise<Wycena[]>;
  get(id: string, user: SessionUser): Promise<Wycena | null>;
}
