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
 * Stub docs are plain text; PDF/DOCX artifacts (Slice 4) are binary — both
 * are stored directly in the `document` table, in one of `content` (text)
 * or `contentBytes` (bytea), chosen by `Buffer.isBuffer(data)`. Exactly one
 * of the two is set per row; `get` prefers `contentBytes` when present.
 */
export function pgStorage(db: NodePgDatabase<typeof schema>): PortStorage {
  return {
    async put(key: string, data: Buffer | string): Promise<string> {
      const isBinary = Buffer.isBuffer(data);
      const values = {
        key,
        content: isBinary ? null : (data as string),
        contentBytes: isBinary ? (data as Buffer) : null,
      };
      await db
        .insert(schema.document)
        .values(values)
        .onConflictDoUpdate({
          target: schema.document.key,
          set: { content: values.content, contentBytes: values.contentBytes },
        });
      return `/api/docs/${encodeURIComponent(key)}`;
    },

    async get(key: string): Promise<Buffer> {
      const [row] = await db.select().from(schema.document).where(eq(schema.document.key, key));
      if (!row) {
        throw new Error(`Storage: key not found: ${key}`);
      }
      if (row.contentBytes) {
        return Buffer.from(row.contentBytes);
      }
      if (row.content == null) {
        throw new Error(`Storage: empty row for key: ${key}`);
      }
      return Buffer.from(row.content);
    },
  };
}
