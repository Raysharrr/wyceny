/**
 * Port for document storage (the generated appraisal report).
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10).
 *
 * ADR note: in-memory adapter now (fastest offline-testable option); Vercel
 * Blob wired behind this same port at deploy time (Task 11, reversible per
 * ADR-013).
 */
export interface PortStorage {
  /** Stores data under key, returns a servable URL/path for it. */
  put(key: string, data: Buffer | string): Promise<string>;

  /** Retrieves the stored data for key; throws StorageNotFoundError when the key is missing. */
  get(key: string): Promise<Buffer>;

  /** Deletes the stored data for key. Idempotent — deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
}

/**
 * Thrown by {@link PortStorage.get} when — and only when — the key is
 * missing. Callers that treat "not found" as a meaningful outcome (e.g.
 * sign-valuation.ts's "approved without maps") must check for this specific
 * type; any other error from `get` is a transient storage failure and must
 * NOT be swallowed the same way (final review, Slice 9, Important #2).
 */
export class StorageNotFoundError extends Error {}
