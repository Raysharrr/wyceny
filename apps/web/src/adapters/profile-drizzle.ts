import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { AppraiserProfile, PortProfile } from "../ports/profile";

/**
 * The three writes below deliberately upsert DISJOINT column sets (each `set:`
 * names only its own columns). `appraiser_profile` is one row per appraiser
 * carrying three independent things — author data, the policy, the signature
 * scan — and a shared `set:` would blank whichever of the other two the caller
 * did not happen to have in hand.
 */
export function profileRepo(db: NodePgDatabase<typeof schema>): PortProfile {
  return {
    async get(userId): Promise<AppraiserProfile | null> {
      const [row] = await db
        .select()
        .from(schema.appraiserProfile)
        .where(eq(schema.appraiserProfile.userId, userId));
      if (!row) return null;
      return {
        fullName: row.fullName,
        licenseNo: row.licenseNo,
        officeBlock: row.officeBlock,
        insuranceDocKey: row.insuranceDocKey,
        insuranceValidUntil: row.insuranceValidUntil,
      };
    },

    async saveAuthor(userId, author) {
      await db
        .insert(schema.appraiserProfile)
        .values({ userId, ...author })
        .onConflictDoUpdate({
          target: schema.appraiserProfile.userId,
          set: { ...author, updatedAt: new Date() },
        });
    },

    async saveInsurance(userId, insurance) {
      const columns = {
        insuranceDocKey: insurance.docKey,
        insuranceValidUntil: insurance.validUntil,
      };
      await db
        .insert(schema.appraiserProfile)
        .values({ userId, ...columns })
        .onConflictDoUpdate({
          target: schema.appraiserProfile.userId,
          set: { ...columns, updatedAt: new Date() },
        });
    },

    async getSignature(userId) {
      const [row] = await db
        .select()
        .from(schema.appraiserProfile)
        .where(eq(schema.appraiserProfile.userId, userId));
      // `row != null` stopped being enough when 0017 dropped the NOT NULL: a
      // profile filled in with author data alone would otherwise hand
      // `{ bytes: null }` to the /profile <img> and straight past the sign
      // action's "scan required" guard (ADR-020 reg. 2). A missing signature
      // has to look missing.
      if (!row?.signatureBytes || !row.signatureMime) return null;
      return { bytes: row.signatureBytes, mime: row.signatureMime };
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
