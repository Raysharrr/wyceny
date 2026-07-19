import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { PortProfile } from "../ports/profile";

export function profileRepo(db: NodePgDatabase<typeof schema>): PortProfile {
  return {
    async getSignature(userId) {
      const [row] = await db
        .select()
        .from(schema.appraiserProfile)
        .where(eq(schema.appraiserProfile.userId, userId));
      return row ? { bytes: row.signatureBytes, mime: row.signatureMime } : null;
    },

    async saveSignature(userId, bytes, mime) {
      await db
        .insert(schema.appraiserProfile)
        .values({ userId, signatureBytes: bytes, signatureMime: mime })
        .onConflictDoUpdate({
          target: schema.appraiserProfile.userId,
          set: { signatureBytes: bytes, signatureMime: mime, updatedAt: new Date() },
        });
    },
  };
}
