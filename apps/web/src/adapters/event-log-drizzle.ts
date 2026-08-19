import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { AppEvent, EventRow, PortEventLog } from "../ports/event-log";

export function eventLogRepo(db: NodePgDatabase<typeof schema>): PortEventLog {
  return {
    // No transaction on purpose: the caller is usually INSIDE a failed one,
    // and a rollback must not erase the record of its own failure
    // (spec §Architektura, rozstrzygnięcie 2).
    async record(e: AppEvent): Promise<void> {
      await db.insert(schema.eventLog).values({
        level: e.level,
        event: e.event,
        traceId: e.traceId ?? null,
        actorId: e.actorId ?? null,
        valuationId: e.valuationId ?? null,
        meta: (e.meta as never) ?? null,
      });
    },
    async byTrace(traceId: string): Promise<EventRow[]> {
      return rows(
        await db
          .select()
          .from(schema.eventLog)
          .where(eq(schema.eventLog.traceId, traceId))
          .orderBy(schema.eventLog.id),
      );
    },
    async byValuation(valuationId: string): Promise<EventRow[]> {
      return rows(
        await db
          .select()
          .from(schema.eventLog)
          .where(eq(schema.eventLog.valuationId, valuationId))
          .orderBy(schema.eventLog.id),
      );
    },
  };
}

function rows(raw: (typeof schema.eventLog.$inferSelect)[]): EventRow[] {
  return raw.map((r) => ({
    id: r.id,
    at: r.at,
    level: r.level as EventRow["level"],
    event: r.event,
    traceId: r.traceId ?? undefined,
    actorId: r.actorId ?? undefined,
    valuationId: r.valuationId ?? undefined,
    meta: r.meta,
  }));
}
