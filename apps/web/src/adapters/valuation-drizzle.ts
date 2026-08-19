import { and, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { KcsInput } from "../domain/kcs";
import {
  applyCalculationConfirm,
  applyFeaturesUpdate,
  applyInspectionOp,
  applyProseConfirmation,
  applyProseProposal,
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
import type { GateOptions } from "../domain/provenance";
import type { ProseSection, ProseSnapshot } from "../domain/prose-snapshot";
import { currentSectionFactsHashes } from "../domain/prose-hash";
import { proseEnabled } from "../lib/prose-enabled";
import * as schema from "../db/schema";
import type { NewValuationInput, PortValuation, SessionUser, Valuation } from "../ports/valuation";

/** True when `user` is allowed to see `row`, per the F-8 ownership rule. */
function canSee(row: Valuation, user: SessionUser): boolean {
  return user.role === "admin" || row.ownerId === user.id;
}

/**
 * A row's `prose`, normalized on read (fix round 1, finding 1): a snapshot
 * persisted before `factsHashes` existed carries `factsHash: string` and no
 * per-section map at all, even though the type says `factsHashes` is always
 * an object — the jsonb column is untyped, so nothing enforced that at
 * write time. Coerced to `{}` here, NOT translated from the old single
 * `factsHash`: that value carries no per-section information, so
 * synthesizing per-section entries from it would mark genuinely stale prose
 * as fresh — the exact failure this feature exists to prevent. An empty
 * object reads every confirmed section as stale instead, which is the
 * promised migration behaviour (`ProseSnapshot.factsHashes` docstring): one
 * regeneration per legacy draft on the next visit to step 6.
 *
 * This covers every read through {@link toValuation} — every method on this
 * repo narrows a raw row through it, `approve`'s in-transaction read
 * included, so a Task 4 F-4 gate built on `repo.get`/`repo.approve` is
 * already covered here too (an earlier draft of this comment claimed
 * otherwise — it was wrong). The `?.` defenses added to the domain
 * functions (`staleProseSections`, `mergeProseProposal`) are not plugging a
 * hole THIS path leaves open; they protect against a caller that reads the
 * jsonb some other way, or builds a `ProseSnapshot` by hand without going
 * through this adapter at all (fix round 2: an `incoming` built by a
 * not-yet-migrated UI action did exactly that).
 */
function normalizeProse(prose: ProseSnapshot | null | undefined): ProseSnapshot | null | undefined {
  if (!prose) return prose;
  return prose.factsHashes ? prose : { ...prose, factsHashes: {} };
}

/**
 * Narrows a raw Drizzle row to {@link Valuation}. `inputs` is an untyped
 * `jsonb` column at the schema level (the schema stays free of domain
 * types, F-10) — this is the one place its shape is asserted back to
 * `KcsInput | null`, since only the caller who wrote the row knows it.
 */
function toValuation(row: typeof schema.valuation.$inferSelect): Valuation {
  const inputs = row.inputs as KcsInput | null;
  return { ...row, inputs: inputs ? { ...inputs, prose: normalizeProse(inputs.prose) } : inputs };
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
    async create(
      input: NewValuationInput,
      audit?: { confirmed?: readonly AuditAction[] },
    ): Promise<Valuation> {
      return db.transaction(async (tx) => {
        const toInsert = newValuation(input);
        const [row] = await tx.insert(schema.valuation).values(toInsert).returning();
        await insertAudit(tx, { valuationId: row.id, actorId: input.ownerId, action: "created" });
        // Same act, same transaction: a draft created from step 1 was also
        // confirmed there, and the trail says so in the same vocabulary the
        // step saves use.
        for (const action of audit?.confirmed ?? []) {
          await insertAudit(tx, { valuationId: row.id, actorId: input.ownerId, action });
        }
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
        // T7 (spec §B): the step-1 button is one act — "Dane się zgadzają —
        // dalej" saves AND confirms, in this transaction, while the data is
        // still on the appraiser's screen. `confirmKwProvenance` is called
        // unconditionally: with no KW extract on the draft it is a no-op.
        const updated = confirmKwProvenance(
          confirmSubjectProvenance(applySubjectUpdate(valuation, u)),
        );
        const [saved] = await tx
          .update(schema.valuation)
          .set({
            inputs: updated.inputs,
            address: updated.address,
            area: updated.area,
            purpose: updated.purpose,
            kwNumber: updated.kwNumber,
            client: updated.client,
            // `updated.wr`, NOT a hardcoded null: `applySubjectUpdate` decides
            // whether the amount survives — it does when the area did not
            // move, since nothing else this step writes reaches `computeKcs`
            // — and a literal here would silently overrule that decision. The
            // sibling saves below still null it outright, because they edit
            // the sample and the features, which ARE two of those inputs.
            wr: updated.wr,
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
        // The confirmation is recorded as its own act, under the same
        // vocabulary the step-7 buttons used: after T8 this save is the ONLY
        // confirm path, and a trail that stopped naming the confirmation
        // would stop showing who vouched for the data under the signature.
        //
        // `subject_confirmed` unconditionally, `kw_confirmed` only with an
        // extract attached — not an inconsistency: the subject confirmation
        // also covers the address's geocoding, which a draft can carry with
        // no subject at all (the RCN fetch geocoded it), so gating this row
        // on `u.subject` would drop it in a case where the save really did
        // flip something. A KW confirmation with no KW extract flips nothing.
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "subject_confirmed" });
        if (u.kw != null) {
          await insertAudit(tx, { valuationId: id, actorId: user.id, action: "kw_confirmed" });
        }
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
        // T7: "Zatwierdź próbę i dalej" really does confirm the sample — see
        // saveSubject above for why the two halves share one transaction.
        const updated = confirmSampleProvenance(applySampleUpdate(valuation, u));
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
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "sample_confirmed" });
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
        // T7: "Zatwierdź cechy i dalej" — same one-act shape as the two above.
        const updated = confirmFeaturesProvenance(applyFeaturesUpdate(valuation, u));
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
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "features_confirmed" });
        return toValuation(saved);
      });
    },

    async saveProse(
      id: string,
      user: SessionUser,
      snapshot: ProseSnapshot,
      usage: { inputTokens: number; outputTokens: number },
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        // .for("update") — same read-modify-write rationale as updateInspection:
        // this rewrites one key of the inputs jsonb, so a concurrent draft save
        // must not be lost to last-write-wins.
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = applyProseProposal(valuation, snapshot);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "prose_generated",
          // Cost is logged even for a generation whose sections were rejected —
          // those tokens were spent. The generated TEXT never enters the audit.
          meta: {
            model: snapshot.model,
            sections: Object.keys(snapshot.sections),
            rejected: snapshot.rejected,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          },
        });
        return toValuation(saved);
      });
    },

    async proseUsage(
      id: string,
      user: SessionUser,
    ): Promise<{ generations: number; inputTokens: number; outputTokens: number }> {
      return db.transaction(async (tx) => {
        // No `setAppRole` here, unlike `get`: the RLS defence-in-depth layer
        // covers `valuation` alone — `audit_log` carries no grant to
        // `app_role` (drizzle/0003, 0009), so switching role would turn this
        // read into a permission error rather than an isolation win.
        // Ownership is therefore enforced the way every mutation on this repo
        // enforces it: in the app layer, before the audit rows are touched.
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        // Zeros, not null: an invisible valuation must read exactly like one
        // nobody has generated for (no existence leak, see the port docs).
        if (!row || !canSee(toValuation(row), user)) {
          return { generations: 0, inputTokens: 0, outputTokens: 0 };
        }

        // `jsonb_typeof` guard: a `prose_generated` row written before the
        // token fields existed has no such keys, and the trail is append-only
        // (F-7) so it cannot be backfilled. It still counts as a generation —
        // it happened — but contributes nothing to the sums, and a bare cast
        // would raise on anything non-numeric that ever reached the column.
        const meta = schema.auditLog.meta;
        const [usage] = await tx
          .select({
            generations: sql<number>`count(*)::int`,
            inputTokens: sql<number>`coalesce(sum(case when jsonb_typeof(${meta} -> 'inputTokens') = 'number' then (${meta} ->> 'inputTokens')::bigint end), 0)::int`,
            outputTokens: sql<number>`coalesce(sum(case when jsonb_typeof(${meta} -> 'outputTokens') = 'number' then (${meta} ->> 'outputTokens')::bigint end), 0)::int`,
          })
          .from(schema.auditLog)
          .where(
            and(eq(schema.auditLog.valuationId, id), eq(schema.auditLog.action, "prose_generated")),
          );
        return usage ?? { generations: 0, inputTokens: 0, outputTokens: 0 };
      });
    },

    async confirmProse(
      id: string,
      user: SessionUser,
      texts: Partial<Record<ProseSection, string>>,
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        // .for("update") — same read-modify-write rationale as saveProse: a
        // concurrent generation must not lose the appraiser's submit to
        // last-write-wins on the inputs jsonb.
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = applyProseConfirmation(valuation, texts, {
          // Computed from the ROW READ IN THIS TRANSACTION, not from the
          // caller's earlier read. Since T7 this is stamped on EVERY confirm
          // (it records the facts the appraiser accepted the text against),
          // not only on prose written entirely by hand. All six sections, not
          // only the ones `texts` fills: a missing entry would leave the
          // just-confirmed section stamped `undefined`, i.e. stale the moment
          // the appraiser submitted it.
          factsHashes: valuation.inputs
            ? currentSectionFactsHashes({ address: valuation.address, inputs: valuation.inputs })
            : {},
          now: new Date(),
        });
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "prose_confirmed",
          // WHICH sections the appraiser took responsibility for — never
          // their text; the operat itself is the record of that.
          meta: { sections: Object.keys(updated.inputs?.prose?.sections ?? {}) },
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

    /**
     * Writes only `mapsFrozenFor`, and writes NO audit row — see the port's
     * docstring for why this one mutation stays out of the trail. The status
     * predicate keeps it draft-only: once the operat is issued, what it
     * carries is settled and this marker must not move under it.
     */
    async freezeMaps(
      id: string,
      user: SessionUser,
      address: string | null,
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        if (toValuation(row).ownerId !== user.id) return null;
        const [saved] = await tx
          .update(schema.valuation)
          .set({ mapsFrozenFor: address })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        return toValuation(saved);
      });
    },

    async approve(
      id: string,
      user: SessionUser,
      docs?: { docUrl: string; docxUrl: string; amountInWords?: string },
      now: Date = new Date(),
      audit?: { mapsSkipped?: boolean; mapsFrozenFor?: string },
      expectedInputs?: KcsInput | null,
      gate?: GateOptions,
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
        //
        // BOTH prose options are derived HERE and REPLACE whatever the caller
        // passed (ADR-012). `gate` is still accepted so the call sites read
        // the same on both sides of the transaction, but nothing in it about
        // prose is trusted:
        //
        //  - the fingerprints, from the row THIS transaction read — matching
        //    hashes handed in from outside (or an empty map, which disables
        //    the check section by section) would otherwise walk stale prose
        //    straight past the invariant;
        //  - `requireProse`, from the kill switch — the larger door next to
        //    it. Taken verbatim, `requireProse: false` (or simply no options
        //    at all) removed the ENTIRE prose group: staleness, missing text
        //    and unconfirmed status together. FR-6 is a deployment decision,
        //    not a per-call one, so the authoritative read belongs inside the
        //    transaction, exactly like the hashes. `proseEnabled()` is the one
        //    place that comparison lives; the action calls it too, for its
        //    fail-fast check before it spends anything on generation.
        const requireProse = proseEnabled();
        const updated = approveValuation(valuation, now, docs, {
          ...gate,
          requireProse,
          currentSectionHashes:
            requireProse && valuation.inputs
              ? currentSectionFactsHashes({ address: valuation.address, inputs: valuation.inputs })
              : undefined,
        });
        const [saved] = await tx
          .update(schema.valuation)
          .set({
            status: updated.status,
            approvedAt: updated.approvedAt,
            docUrl: updated.docUrl,
            docxUrl: updated.docxUrl,
            // Written with the document, from the same string the render was
            // given — see `approveValuation`. The column had never been
            // written by anything before this line existed.
            amountInWords: updated.amountInWords,
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
            ...(audit?.mapsFrozenFor ? { mapsFrozenFor: audit.mapsFrozenFor } : {}),
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
