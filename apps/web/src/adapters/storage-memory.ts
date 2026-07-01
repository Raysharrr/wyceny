import type { PortStorage } from "../ports/storage";

const store = new Map<string, Buffer>();

/**
 * In-memory adapter for {@link PortStorage}, backed by a module-level Map.
 *
 * Fastest offline-testable adapter; persists across requests within a
 * single dev process (enough for the local E2E in Task 9). Production
 * swaps in Vercel Blob behind the same PortStorage at Task 11 (reversible
 * per ADR-013).
 */
export function memoryStorage(): PortStorage {
  return {
    async put(key: string, data: Buffer | string): Promise<string> {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      store.set(key, buf);
      return `/api/docs/${encodeURIComponent(key)}`;
    },

    async get(key: string): Promise<Buffer> {
      const buf = store.get(key);
      if (!buf) {
        throw new Error(`Storage: key not found: ${key}`);
      }
      return buf;
    },
  };
}
