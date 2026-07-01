import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { newWycena } from "../domain/wycena";
import * as schema from "../db/schema";
import type { NewWycenaInput, PortWyceny, SessionUser, Wycena } from "../ports/wyceny";

/**
 * Drizzle/Postgres adapter for {@link PortWyceny}.
 *
 * `listForUser` filters by `ownerId = user.id` only — role-based admin-sees-all
 * and RLS are out of scope here (Task 7). `get` fetches by id without an
 * ownership check for the same reason.
 */
export function wycenyRepo(db: NodePgDatabase<typeof schema>): PortWyceny {
  return {
    async create(input: NewWycenaInput): Promise<Wycena> {
      const toInsert = newWycena(input);
      const [row] = await db.insert(schema.wycena).values(toInsert).returning();
      return row;
    },

    async listForUser(user: SessionUser): Promise<Wycena[]> {
      return db.select().from(schema.wycena).where(eq(schema.wycena.ownerId, user.id));
    },

    async get(id: string, _user: SessionUser): Promise<Wycena | null> {
      const [row] = await db.select().from(schema.wycena).where(eq(schema.wycena.id, id));
      return row ?? null;
    },
  };
}
