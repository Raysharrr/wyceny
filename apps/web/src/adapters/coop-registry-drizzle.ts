import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, ilike, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { ColumnMapping } from "../domain/coop-import";
import type {
  CoopImportBatch,
  CoopRegistryQuery,
  CoopRegistryStats,
  CoopTransaction,
  NewCoopTransaction,
  PortCoopRegistry,
} from "../ports/coop-registry";
import type { SessionUser } from "../ports/valuation";

type Db = NodePgDatabase<typeof schema>;
type Row = typeof schema.coopTransaction.$inferSelect;

function toTransaction(r: Row): CoopTransaction {
  return {
    id: r.id,
    cooperative: r.cooperative,
    address: r.address,
    buildingNumber: r.buildingNumber,
    flatNumber: r.flatNumber,
    area: r.area,
    priceTotal: r.priceTotal,
    // Derived, never stored (spec §4.3) — one source of truth.
    pricePerM2: r.priceTotal / r.area,
    date: r.date,
    priceKind: r.priceKind as CoopTransaction["priceKind"],
    rightType: r.rightType as CoopTransaction["rightType"],
    rep: r.rep,
    floor: r.floor,
    rooms: r.rooms,
    buildYear: r.buildYear,
    pos: r.posX !== null && r.posY !== null ? { x: r.posX, y: r.posY } : null,
    source: r.source as CoopTransaction["source"],
    dedupeKey: r.dedupeKey,
  };
}

function toInsert(
  r: NewCoopTransaction,
  id: string,
  by: { userId: string; batchId: string | null },
): typeof schema.coopTransaction.$inferInsert {
  return {
    id,
    cooperative: r.cooperative,
    address: r.address,
    buildingNumber: r.buildingNumber,
    flatNumber: r.flatNumber,
    area: r.area,
    priceTotal: r.priceTotal,
    date: r.date,
    priceKind: r.priceKind,
    rightType: r.rightType,
    rep: r.rep,
    floor: r.floor,
    rooms: r.rooms,
    buildYear: r.buildYear,
    posX: r.pos?.x ?? null,
    posY: r.pos?.y ?? null,
    source: r.source,
    dedupeKey: r.dedupeKey,
    importBatchId: by.batchId,
    createdBy: by.userId,
  };
}

const t = schema.coopTransaction;
const INSERT_CHUNK = 200;
const DEFAULT_LIMIT = 50;

/**
 * Drizzle adapter for {@link PortCoopRegistry} (tables from migration 0014).
 * Writes run as the pool superuser, like `valuationRepo.create`. Reads run
 * as the superuser too unless `as` is given — then inside a transaction as
 * `app_role` with `app.user_id` set, under the office-level RLS policy
 * (SELECT-only, visible to any logged-in user).
 */
export function coopRegistryRepo(db: Db): PortCoopRegistry {
  return {
    async list(q: CoopRegistryQuery, as?: SessionUser) {
      const where = and(
        q.cooperative ? eq(t.cooperative, q.cooperative) : undefined,
        q.from ? gte(t.date, q.from) : undefined,
        q.text ? ilike(t.address, `%${q.text}%`) : undefined,
        q.near
          ? sql`${t.posX} is not null and ((${t.posX} - ${q.near.x})^2 + (${t.posY} - ${q.near.y})^2) <= ${q.near.radiusM * q.near.radiusM}`
          : undefined,
      );
      const run = async (x: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]) => {
        const rows = await x
          .select()
          .from(t)
          .where(where)
          .orderBy(desc(t.date), t.id)
          .limit(Math.min(q.limit ?? DEFAULT_LIMIT, 500))
          .offset(q.offset ?? 0);
        const [{ n }] = await x.select({ n: count() }).from(t).where(where);
        return { rows: rows.map(toTransaction), total: n };
      };
      if (!as) return run(db);
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_role`);
        await tx.execute(sql`select set_config('app.user_id', ${as.id}, true)`);
        return run(tx);
      });
    },

    async upsertMany(rows, by) {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => toInsert(r, randomUUID(), by));
        const done = await db
          .insert(t)
          .values(chunk)
          .onConflictDoNothing({ target: t.dedupeKey })
          .returning({ id: t.id });
        inserted += done.length;
      }
      return { inserted, duplicates: rows.length - inserted };
    },

    async save(row, by) {
      const values = toInsert(row, row.id ?? randomUUID(), { userId: by.userId, batchId: null });
      // Replace everything but identity and authorship on conflict.
      const update = { ...values };
      delete (update as { id?: string }).id;
      delete (update as { createdBy?: string }).createdBy;
      const [saved] = await db
        .insert(t)
        .values(values)
        .onConflictDoUpdate({ target: t.id, set: update })
        .returning();
      return toTransaction(saved!);
    },

    async remove(id) {
      await db.delete(t).where(eq(t.id, id));
    },

    async stats(): Promise<CoopRegistryStats> {
      const [[{ total }], [{ needsGeocoding }], perCoop, [last]] = await Promise.all([
        db.select({ total: count() }).from(t),
        db.select({ needsGeocoding: count() }).from(t).where(isNull(t.posX)),
        db.select({ cooperative: t.cooperative, n: count() }).from(t).groupBy(t.cooperative),
        db
          .select()
          .from(schema.coopImportBatch)
          .orderBy(desc(schema.coopImportBatch.createdAt))
          .limit(1),
      ]);
      return {
        total,
        byCooperative: Object.fromEntries(perCoop.map((r) => [r.cooperative, r.n])),
        needsGeocoding,
        lastImport: last
          ? { at: last.createdAt.toISOString(), file: last.fileName, rows: last.rowsInserted }
          : null,
      };
    },

    async recordBatch(batch: CoopImportBatch) {
      await db.insert(schema.coopImportBatch).values({
        id: batch.id,
        cooperative: batch.cooperative,
        fileName: batch.fileName,
        mapping: batch.mapping,
        rowsInserted: batch.rowsInserted,
        rowsSkipped: batch.rowsSkipped,
        createdBy: batch.createdBy,
      });
    },

    async getMapping(cooperative) {
      const [row] = await db
        .select()
        .from(schema.coopColumnMapping)
        .where(eq(schema.coopColumnMapping.cooperative, cooperative));
      return row ? (row.mapping as ColumnMapping) : null;
    },

    async saveMapping(cooperative, mapping) {
      await db
        .insert(schema.coopColumnMapping)
        .values({ cooperative, mapping })
        .onConflictDoUpdate({
          target: schema.coopColumnMapping.cooperative,
          set: { mapping, updatedAt: new Date() },
        });
    },
  };
}
