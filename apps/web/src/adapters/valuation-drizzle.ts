import { eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { KcsInput } from "../domain/kcs";
import { approveValuation, confirmSampleProvenance, newValuation } from "../domain/valuation";
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
      const toInsert = newValuation(input);
      const [row] = await db.insert(schema.valuation).values(toInsert).returning();
      return toValuation(row);
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

    // Both mutations run on the superuser pool connection, same trust path
    // as create (app_role/RLS stays read-only, F-8 unchanged); ownership is
    // enforced app-level below. ponytail: load→domain→update without a row
    // lock — single-user-per-valuation flow (ADR-012, Scalability=L); add
    // SELECT ... FOR UPDATE if concurrent editing ever arrives.
    async confirmSample(id: string, user: SessionUser): Promise<Valuation | null> {
      const [row] = await db.select().from(schema.valuation).where(eq(schema.valuation.id, id));
      if (!row) return null;
      const valuation = toValuation(row);
      if (valuation.ownerId !== user.id) return null;
      const updated = confirmSampleProvenance(valuation);
      const [saved] = await db
        .update(schema.valuation)
        .set({ inputs: updated.inputs })
        .where(eq(schema.valuation.id, id))
        .returning();
      return toValuation(saved);
    },

    async approve(id: string, user: SessionUser): Promise<Valuation | null> {
      const [row] = await db.select().from(schema.valuation).where(eq(schema.valuation.id, id));
      if (!row) return null;
      const valuation = toValuation(row);
      if (valuation.ownerId !== user.id) return null;
      const updated = approveValuation(valuation, new Date());
      const [saved] = await db
        .update(schema.valuation)
        .set({ status: updated.status, approvedAt: updated.approvedAt })
        .where(eq(schema.valuation.id, id))
        .returning();
      return toValuation(saved);
    },
  };
}
