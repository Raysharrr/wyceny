import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { newWycena } from "../domain/wycena";
import * as schema from "../db/schema";
import type { NewWycenaInput, PortWyceny, SessionUser, Wycena } from "../ports/wyceny";

/** True when `user` is allowed to see `row`, per the F-8 ownership rule. */
function canSee(row: Wycena, user: SessionUser): boolean {
  return user.role === "admin" || row.ownerId === user.id;
}

type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Switches the transaction to `app_role` and sets the session GUCs the RLS
 * policy (`drizzle/0003_wycena_rls.sql`) reads. Shared by every read method
 * below — DRYs the three-line boilerplate that `listForUser`/`get`/
 * `getByDocKey` would otherwise each repeat.
 */
async function setAppRole(tx: Tx, user: SessionUser) {
  await tx.execute(sql`set local role app_role`);
  await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
  await tx.execute(sql`select set_config('app.role', ${user.role}, true)`);
}

/**
 * Drizzle/Postgres adapter for {@link PortWyceny}.
 *
 * Ownership isolation (F-8, ADR-013) has two layers:
 *  - App-layer filter (primary, always correct even if RLS is
 *    misconfigured): `listForUser` branches on role; `get`/`getByDocKey`
 *    re-check ownership after fetch via `canSee`.
 *  - Postgres RLS on `wycena` (defense-in-depth, see
 *    `drizzle/0003_wycena_rls.sql`). The app connects as the `postgres`
 *    superuser, which always bypasses RLS, so every read method runs its
 *    query inside a transaction that switches to the non-superuser
 *    `app_role` via `SET LOCAL ROLE` and sets `app.user_id`/`app.role` via
 *    `set_config(..., true)` (transaction-scoped — pooling-safe, unlike a
 *    plain `SET`), done by `setAppRole`. `create` is unaffected: it keeps
 *    running as the superuser pool connection (no role switch), matching
 *    the SELECT-only RLS policy.
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
        await setAppRole(tx, user);

        if (user.role === "admin") {
          return tx.select().from(schema.wycena);
        }
        return tx.select().from(schema.wycena).where(eq(schema.wycena.ownerId, user.id));
      });
    },

    async get(id: string, user: SessionUser): Promise<Wycena | null> {
      return db.transaction(async (tx) => {
        await setAppRole(tx, user);

        const [row] = await tx.select().from(schema.wycena).where(eq(schema.wycena.id, id));
        if (!row || !canSee(row, user)) return null;
        return row;
      });
    },

    async getByDocKey(key: string, user: SessionUser): Promise<Wycena | null> {
      const docUrl = `/api/docs/${encodeURIComponent(key)}`;
      return db.transaction(async (tx) => {
        await setAppRole(tx, user);

        const [row] = await tx.select().from(schema.wycena).where(eq(schema.wycena.docUrl, docUrl));
        if (!row || !canSee(row, user)) return null;
        return row;
      });
    },
  };
}
