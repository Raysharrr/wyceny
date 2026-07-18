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
  docxUrl: string | null;
  purpose: "sprzedaz" | "zabezpieczenie_kredytu" | "informacyjny" | null;
  kwNumber: string | null;
  client: string | null;
  /** ISO date string (YYYY-MM-DD). */
  inspectionDate: string | null;
  ownerId: string;
  status: "in_progress" | "approved" | "signed";
  approvedAt: Date | null;
  createdAt: Date;
};

export type NewValuationInput = {
  address: string;
  area: number;
  wr: number;
  inputs: KcsInput | null;
  amountInWords: string | null;
  docUrl: string | null;
  docxUrl?: string | null;
  purpose?: Valuation["purpose"];
  kwNumber?: string | null;
  client?: string | null;
  inspectionDate?: string | null;
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
   * Looks up the Valuation whose `docUrl` OR `docxUrl` matches the given
   * PortStorage key (Slice 4 adds a second, DOCX, artifact per Valuation),
   * applying the same ownership rule as `get` (admin → any; appraiser →
   * only their own). Returns `null` both when no such Valuation exists and
   * when it exists but isn't visible to `user` — callers must not
   * distinguish the two (no existence leak). Backs the `/api/docs/[key]`
   * auth gate (Task 11a).
   */
  getByDocKey(key: string, user: SessionUser): Promise<Valuation | null>;
  /**
   * Confirms sample provenance on a draft (rcn rows + geocode → confirmed).
   * Owner-only (admin included only if they own it). Returns null when the
   * valuation doesn't exist or the user isn't the owner; throws for
   * status violations (not a draft).
   */
  confirmSample(id: string, user: SessionUser): Promise<Valuation | null>;
  /**
   * Confirms subject-snapshot provenance on a draft (ewidencja/mpzp →
   * confirmed). Mirrors `confirmSample`'s owner-only null/throw contract.
   */
  confirmSubject(id: string, user: SessionUser): Promise<Valuation | null>;
  /**
   * Confirms KW-extract provenance on a draft (kw — and document-sourced
   * area — → confirmed). Mirrors `confirmSample`'s owner-only null/throw
   * contract.
   */
  confirmKw(id: string, user: SessionUser): Promise<Valuation | null>;
  /**
   * Approves a draft — re-runs the F-4 gate AND the document-field check
   * server-side (never trusts the client). Same null/throw contract as
   * confirmSample; additionally throws ApprovalBlockedError when either the
   * gate or a required document field fails. When `docs` are supplied (the
   * approve action has generated + stored the operat), their URLs are
   * persisted atomically with the status flip (Slice 4, spec §3).
   */
  approve(
    id: string,
    user: SessionUser,
    docs?: { docUrl: string; docxUrl: string },
  ): Promise<Valuation | null>;
}
