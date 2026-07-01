/**
 * Port for document storage (the generated operat).
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

  /** Retrieves the stored data for key; throws if the key is not found. */
  get(key: string): Promise<Buffer>;
}
