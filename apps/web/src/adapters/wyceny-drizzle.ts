import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { newWycena } from "../domain/wycena";
import * as schema from "../db/schema";
import type { NewWycenaInput, PortWyceny, SessionUser, Wycena } from "../ports/wyceny";

/**
 * Drizzle/Postgres adapter for {@link PortWyceny}.
 *
 * Ownership isolation (F-8, ADR-013) has two layers:
 *  - App-layer filter (primary, always correct even if RLS is
 *    misconfigured): `listForUser` branches on role; `get` re-checks
 *    ownership after fetch.
 *  - Postgres RLS on `wycena` (defense-in-depth, see
 *    `drizzle/0003_wycena_rls.sql`). The app connects as the `postgres`
 *    superuser, which always bypasses RLS, so `listForUser`/`get` run their
 *    query inside a transaction that switches to the non-superuser
 *    `app_role` via `SET LOCAL ROLE` and sets `app.user_id`/`app.role` via
 *    `set_config(..., true)` (transaction-scoped — pooling-safe, unlike a
 *    plain `SET`). `create` is unaffected: it keeps running as the
 *    superuser pool connection (no role switch), matching the SELECT-only
 *    RLS policy.
 */
export function wycenyRepo(db: NodePgDatabase<typeof schema>): PortWyceny {
  return {
    async create(input: NewWycenaInput): Promise<Wycena> {
      const toInsert = newWycena(input);
      const [row] = await db.insert(schema.wycena).values(toInsert).returning();
      return row;
    },

    async listForUser(user: SessionUser): Promise<Wycena[]> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_role`);
        await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
        await tx.execute(sql`select set_config('app.role', ${user.role}, true)`);

        if (user.role === "admin") {
          return tx.select().from(schema.wycena);
        }
        return tx.select().from(schema.wycena).where(eq(schema.wycena.ownerId, user.id));
      });
    },

    async get(id: string, user: SessionUser): Promise<Wycena | null> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_role`);
        await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
        await tx.execute(sql`select set_config('app.role', ${user.role}, true)`);

        const [row] = await tx.select().from(schema.wycena).where(eq(schema.wycena.id, id));
        if (!row) return null;
        if (user.role !== "admin" && row.ownerId !== user.id) return null;
        return row;
      });
    },
  };
}
