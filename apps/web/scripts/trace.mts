// Usage: pnpm trace <traceId|valuationId>
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { formatTimeline, mergeTimeline } from "../src/lib/trace-timeline";

const id = process.argv[2];
if (!id) {
  process.stderr.write("usage: pnpm trace <traceId|valuationId>\n");
  process.exit(1);
}

// 8 hex chars is a traceId; anything else is treated as a valuation id.
const isTrace = /^[0-9a-f]{8}$/.test(id);

const events = await db
  .select()
  .from(schema.eventLog)
  .where(isTrace ? eq(schema.eventLog.traceId, id) : eq(schema.eventLog.valuationId, id))
  .orderBy(schema.eventLog.id);

// A traceId names one run; the audit rows worth showing are the ones for the
// valuation that run touched.
const valuationId = isTrace ? (events.find((e) => e.valuationId)?.valuationId ?? null) : id;

const audits = valuationId
  ? await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.valuationId, valuationId))
      .orderBy(schema.auditLog.id)
  : [];

process.stdout.write(
  formatTimeline(
    mergeTimeline(
      events.map((e) => ({ at: e.at, level: e.level, event: e.event, meta: e.meta })),
      audits.map((a) => ({ at: a.at, action: a.action, actorId: a.actorId })),
    ),
  ),
);
await pool.end();
