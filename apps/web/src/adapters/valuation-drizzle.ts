import { and, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { KcsInput } from "../domain/kcs";
import {
  applyCalculationConfirm,
  applyFeaturesUpdate,
  applyInspectionOp,
  applySampleUpdate,
  applySubjectUpdate,
  approveValuation,
  confirmFeaturesProvenance,
  confirmKwProvenance,
  confirmSampleProvenance,
  confirmSubjectProvenance,
  InputsChangedError,
  newValuation,
  newVersionOf,
  signValuation,
  type AuditAction,
  type FeaturesUpdate,
  type SampleUpdate,
  type SubjectUpdate,
} from "../domain/valuation";
import { totalInspectionPhotos } from "../domain/inspection";
import * as schema from "../db/schema";
import type { NewValuationInput, PortValuation, SessionUser, Valuation } from "../ports/valuation";

/** True when `user` is allowed to see `row`, per the F-8 ownership rule. */
function canSee(row: Valuation, user: SessionUser): boolean {
  return user.role === "admin" || row.ownerId === user.id;
}

/**
 * Narrows a raw Drizzle row to {@link Valuation}. `inputs` is an untyped
 * `jsonb` column at the schema level (the schema stays free of domain
 * types, F-10) — this is the one place its shape is asserted back to
 * `KcsInput | null`, since only the caller who wrote the row knows it.
 */
function toValuation(row: typeof schema.valuation.$inferSelect): Valuation {
  return { ...row, inputs: row.inputs as KcsInput | null };
}

type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Switches the transaction to `app_role` and sets the session GUCs the RLS
 * policy (`drizzle/0003_wycena_rls.sql`, renamed onto `valuation` by
 * `drizzle/0005_english_domain_rename.sql`) reads. Shared by every read
 * method below — DRYs the three-line boilerplate that
 * `listForUser`/`get`/`getByDocKey` would otherwise each repeat.
 */
async function setAppRole(tx: Tx, user: SessionUser) {
  await tx.execute(sql`set local role app_role`);
  await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
  await tx.execute(sql`select set_config('app.role', ${user.role}, true)`);
}

/** One audit row per mutation, inside the mutation's transaction (FR-12). */
async function insertAudit(
  tx: Tx,
  entry: { valuationId: string; actorId: string; action: AuditAction; meta?: unknown },
) {
  await tx.insert(schema.auditLog).values({
    valuationId: entry.valuationId,
    actorId: entry.actorId,
    action: entry.action,
    meta: entry.meta ?? null,
  });
}

/**
 * Drizzle/Postgres adapter for {@link PortValuation}.
 *
 * Ownership isolation (F-8, ADR-013) has two layers:
 *  - App-layer filter (primary, always correct even if RLS is
 *    misconfigured): `listForUser` branches on role; `get`/`getByDocKey`
 *    re-check ownership after fetch via `canSee`.
 *  - Postgres RLS on `valuation` (defense-in-depth, see
 *    `drizzle/0003_wycena_rls.sql` + `drizzle/0005_english_domain_rename.sql`).
 *    The app connects as the `postgres` superuser, which always bypasses
 *    RLS, so every read method runs its query inside a transaction that
 *    switches to the non-superuser `app_role` via `SET LOCAL ROLE` and sets
 *    `app.user_id`/`app.role` via `set_config(..., true)` (transaction-scoped
 *    — pooling-safe, unlike a plain `SET`), done by `setAppRole`. `create` is
 *    unaffected: it keeps running as the superuser pool connection (no role
 *    switch), matching the SELECT-only RLS policy.
 */
export function valuationRepo(db: NodePgDatabase<typeof schema>): PortValuation {
  return {
    async create(input: NewValuationInput): Promise<Valuation> {
      return db.transaction(async (tx) => {
        const toInsert = newValuation(input);
        const [row] = await tx.insert(schema.valuation).values(toInsert).returning();
        await insertAudit(tx, { valuationId: row.id, actorId: input.ownerId, action: "created" });
        return toValuation(row);
      });
    },

    async listForUser(user: SessionUser): Promise<Valuation[]> {
      return db.transaction(async (tx) => {
        await setAppRole(tx, user);

        const rows =
          user.role === "admin"
            ? await tx.select().from(schema.valuation)
            : await tx.select().from(schema.valuation).where(eq(schema.valuation.ownerId, user.id));
        return rows.map(toValuation);
      });
    },

    async get(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        await setAppRole(tx, user);

        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        return canSee(valuation, user) ? valuation : null;
      });
    },

    async getByDocKey(key: string, user: SessionUser): Promise<Valuation | null> {
      const docUrl = `/api/docs/${encodeURIComponent(key)}`;
      return db.transaction(async (tx) => {
        await setAppRole(tx, user);

        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(or(eq(schema.valuation.docUrl, docUrl), eq(schema.valuation.docxUrl, docUrl)));
        if (!row) return null;
        const valuation = toValuation(row);
        return canSee(valuation, user) ? valuation : null;
      });
    },

    // All five mutations below run on the superuser pool connection, same
    // trust path as create (app_role/RLS stays read-only, F-8 unchanged);
    // ownership is enforced app-level. Each wraps its select→domain→update
    // in a transaction: the CAS re-check in the UPDATE's WHERE closes the
    // select→update race (0 rows means a concurrent status flip won — the
    // stale write is silently dropped instead of applied), and the audit
    // row commits atomically with the mutation (FR-12) — a domain throw
    // (e.g. not-a-draft, missing inputs) rolls back the whole transaction,
    // so a failed mutation leaves zero audit rows.
    async confirmSample(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = confirmSampleProvenance(valuation);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "sample_confirmed" });
        return toValuation(saved);
      });
    },

    async confirmSubject(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = confirmSubjectProvenance(valuation);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "subject_confirmed" });
        return toValuation(saved);
      });
    },

    async confirmKw(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = confirmKwProvenance(valuation);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "kw_confirmed" });
        return toValuation(saved);
      });
    },

    async confirmFeatures(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = confirmFeaturesProvenance(valuation);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "features_confirmed" });
        return toValuation(saved);
      });
    },

    async updateInspection(id, user, op) {
      return db.transaction(async (tx) => {
        // .for("update") — UNLIKE the confirm* siblings: the manifest is a
        // read-modify-write on inputs jsonb and photo uploads repeat, so two
        // tabs adding photos concurrently would lose a manifest key (last
        // write wins) and orphan its bytes (advisor I-1). The row lock
        // serializes writers; confirm* flips are idempotent so they stay as-is.
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = applyInspectionOp(valuation, op);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs, inspectionDate: updated.inspectionDate })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "inspection_updated",
          meta: {
            op:
              op.kind === "add_photo"
                ? "photo_added"
                : op.kind === "remove_photo"
                  ? "photo_removed"
                  : op.kind === "set_date"
                    ? "date_updated"
                    : "note_updated",
            ...(op.kind === "add_photo" || op.kind === "remove_photo"
              ? { section: op.section }
              : {}),
            total: totalInspectionPhotos(updated.inputs?.inspection),
          },
        });
        return toValuation(saved);
      });
    },

    async saveSubject(id: string, user: SessionUser, u: SubjectUpdate): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        // .for("update") — same read-modify-write rationale as updateInspection.
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = applySubjectUpdate(valuation, u);
        const [saved] = await tx
          .update(schema.valuation)
          .set({
            inputs: updated.inputs,
            address: updated.address,
            area: updated.area,
            purpose: updated.purpose,
            kwNumber: updated.kwNumber,
            client: updated.client,
            wr: null,
          })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "subject_updated",
          meta: { kwAttached: u.kw != null },
        });
        return toValuation(saved);
      });
    },

    async saveSample(id: string, user: SessionUser, u: SampleUpdate): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = applySampleUpdate(valuation, u);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs, wr: null })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "sample_updated",
          meta: { count: u.comparables.length },
        });
        return toValuation(saved);
      });
    },

    async saveFeatures(
      id: string,
      user: SessionUser,
      u: FeaturesUpdate,
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = applyFeaturesUpdate(valuation, u);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs, wr: null })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "features_updated",
          meta: { count: u.features.length },
        });
        return toValuation(saved);
      });
    },

    async confirmCalculation(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        // May throw CalculationNotReadyError — bubbles, rolls back the tx,
        // zero audit rows (same contract as InspectionLimitError above).
        const updated = applyCalculationConfirm(valuation);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ wr: updated.wr })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "calculation_confirmed",
          meta: { wr: updated.wr },
        });
        return toValuation(saved);
      });
    },

    async approve(
      id: string,
      user: SessionUser,
      docs?: { docUrl: string; docxUrl: string },
      now: Date = new Date(),
      audit?: { mapsSkipped?: boolean },
      expectedInputs?: KcsInput | null,
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        // Closes the approve-window drift: the action reads the draft, spends
        // seconds generating the operat, THEN calls approve — during that
        // window the owner can still mutate draft inputs (final review). Both
        // sides come from the same pg jsonb driver parse, so a JSON.stringify
        // comparison is exact when nothing changed and differs the instant
        // updateInspection/confirm* touches the row.
        if (
          expectedInputs !== undefined &&
          JSON.stringify(valuation.inputs) !== JSON.stringify(expectedInputs)
        ) {
          throw new InputsChangedError(id);
        }
        // Re-runs the full gate (F-4 + document fields) in the domain — this is
        // the atomic status flip; a caller that stored files first but fails
        // here leaves harmless orphan files (same keys, overwritten on retry).
        const updated = approveValuation(valuation, now, docs);
        const [saved] = await tx
          .update(schema.valuation)
          .set({
            status: updated.status,
            approvedAt: updated.approvedAt,
            docUrl: updated.docUrl,
            docxUrl: updated.docxUrl,
          })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "approved",
          meta: {
            docUrl: updated.docUrl,
            docxUrl: updated.docxUrl,
            ...(audit?.mapsSkipped ? { mapsSkipped: true } : {}),
          },
        });
        return toValuation(saved);
      });
    },

    async sign(
      id: string,
      user: SessionUser,
      docs: { docUrl: string; docxUrl: string; sha256Docx: string; sha256Pdf: string },
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = signValuation(valuation, new Date());
        const [saved] = await tx
          .update(schema.valuation)
          .set({
            status: updated.status,
            signedAt: updated.signedAt,
            docUrl: docs.docUrl,
            docxUrl: docs.docxUrl,
          })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "approved")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "signed",
          meta: { sha256Docx: docs.sha256Docx, sha256Pdf: docs.sha256Pdf, docUrl: docs.docUrl },
        });
        return toValuation(saved);
      });
    },

    async createNewVersion(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const copy = newVersionOf(valuation);
        const [inserted] = await tx.insert(schema.valuation).values(copy).returning();
        await insertAudit(tx, {
          valuationId: inserted.id,
          actorId: user.id,
          action: "version_created",
          meta: { supersedes: id },
        });
        return toValuation(inserted);
      });
    },
  };
}
