import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { PortStorage } from "../ports/storage";

/**
 * Postgres-backed adapter for {@link PortStorage} (Task 11a).
 *
 * Persistent — unlike `storage-memory.ts`, survives serverless invocations,
 * which is required before this app can deploy (a fresh invocation would
 * otherwise lose every doc a prior invocation stored, 404-ing every link).
 *
 * Stub docs are plain text, stored directly in the `document` table. A
 * future binary/PDF slice should move `content` to object storage (e.g.
 * Vercel Blob) behind this same `PortStorage` interface — callers never
 * change.
 */
export function pgStorage(db: NodePgDatabase<typeof schema>): PortStorage {
  return {
    async put(key: string, data: Buffer | string): Promise<string> {
      const content = Buffer.isBuffer(data) ? data.toString() : data;
      await db
        .insert(schema.document)
        .values({ key, content })
        .onConflictDoUpdate({ target: schema.document.key, set: { content } });
      return `/api/docs/${encodeURIComponent(key)}`;
    },

    async get(key: string): Promise<Buffer> {
      const [row] = await db.select().from(schema.document).where(eq(schema.document.key, key));
      if (!row) {
        throw new Error(`Storage: key not found: ${key}`);
      }
      return Buffer.from(row.content);
    },
  };
}
