import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { coopDedupeKey, type ColumnMapping } from "../domain/coop-import";
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

function isDedupeConflict(err: unknown): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const pg = e.code ? e : e.cause;
  return pg?.code === "23505" && pg.constraint === "coop_transaction_dedupe";
}
const INSERT_CHUNK = 200;
/** Paged listing (screens) — a radius query is a POOL, not a page: see `LIST_CAP`. */
const DEFAULT_PAGE = 50;
/** Absolute ceiling per call; `truncated` says when it bit (port doc on `CoopRegistryQuery.near`). */
const LIST_CAP = 5000;

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
      // No implicit page for a radius query: S3 builds the candidate pool
      // from it, and 50 newest rows would silently stand in for every row
      // within the radius (review 1 §3).
      const limit = Math.min(q.limit ?? (q.near ? LIST_CAP : DEFAULT_PAGE), LIST_CAP);
      const offset = q.offset ?? 0;
      const run = async (x: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]) => {
        const rows = await x
          .select()
          .from(t)
          .where(where)
          .orderBy(desc(t.date), t.id)
          .limit(limit)
          .offset(offset);
        const [{ n }] = await x.select({ n: count() }).from(t).where(where);
        const hasMore = offset + rows.length < n;
        // One meaning each: hasMore = there is a next page; truncated = the
        // ceiling itself bit, so the pool is incomplete (review 2 §10).
        return {
          rows: rows.map(toTransaction),
          total: n,
          hasMore,
          truncated: limit === LIST_CAP && hasMore,
        };
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
      // Import guards area > 0 (bad_number); the manual path must too, or
      // pricePerM2 becomes Infinity (review 1 §16).
      if (!(row.area > 0) || !(row.priceTotal > 0)) return { ok: false, reason: "invalid" };
      // The key is derived here, never taken from the form (review 2 §7).
      const values = toInsert({ ...row, dedupeKey: coopDedupeKey(row) }, row.id ?? randomUUID(), {
        userId: by.userId,
        batchId: null,
      });
      // A correction replaces the facts, never identity, authorship or
      // provenance: source and import batch stay as imported (review 1 §7).
      const update = { ...values };
      for (const k of ["id", "createdBy", "source", "importBatchId"] as const) delete update[k];
      try {
        const [saved] = await db
          .insert(t)
          .values(values)
          .onConflictDoUpdate({ target: t.id, set: update })
          .returning();
        return { ok: true, row: toTransaction(saved!) };
      } catch (err) {
        // 23505 on coop_transaction_dedupe: the Postgres DETAIL carries the
        // dedupe key (address + flat) — swallowed here, never re-thrown (F-13).
        if (isDedupeConflict(err)) return { ok: false, reason: "duplicate" };
        throw err;
      }
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
          // An open (or abandoned) batch has no final counters — the tile shows the last one that closed.
          .where(isNotNull(schema.coopImportBatch.finishedAt))
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
      const counters = {
        rowsInserted: batch.rowsInserted,
        rowsSkipped: batch.rowsSkipped,
        rowsWarned: batch.rowsWarned,
        finishedAt: batch.finishedAt ? new Date(batch.finishedAt) : null,
      };
      await db
        .insert(schema.coopImportBatch)
        .values({
          id: batch.id,
          cooperative: batch.cooperative,
          fileName: batch.fileName,
          mapping: batch.mapping,
          createdBy: batch.createdBy,
          ...counters,
        })
        .onConflictDoUpdate({ target: schema.coopImportBatch.id, set: counters });
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
