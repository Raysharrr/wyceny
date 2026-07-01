import type { PortStorage } from "../ports/storage";

// Keyed on `globalThis`, not a plain module-level variable: Next.js bundles
// Server Actions and Route Handlers into separate chunks, each of which can
// get its own evaluation of this module (confirmed empirically in Task 9's
// E2E — a module-level `Map` here meant the create-valuation action's `put`
// and the `/api/docs/[key]` route's `get` landed in two different Maps,
// producing a 404 for every freshly-created doc). `globalThis` is the one
// thing guaranteed to be shared across chunks within a single process.
const GLOBAL_KEY = Symbol.for("wyceny.memoryStorage.store");

type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: Map<string, Buffer> };

function getStore(): Map<string, Buffer> {
  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, Buffer>();
  }
  return g[GLOBAL_KEY];
}

/**
 * In-memory adapter for {@link PortStorage}, backed by a `globalThis`-scoped
 * Map (see note above on why not a plain module-level Map).
 *
 * Fastest offline-testable adapter; persists across requests within a
 * single dev process (enough for the local E2E in Task 9). Production
 * swaps in Vercel Blob behind the same PortStorage at Task 11 (reversible
 * per ADR-013).
 */
export function memoryStorage(): PortStorage {
  const store = getStore();

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
