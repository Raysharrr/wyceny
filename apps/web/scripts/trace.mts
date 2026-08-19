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

// 8 hex chars is a traceId; a UUID is a valuation. Anything else used to be
// handed to Postgres as if it were a uuid, which answered with
// `invalid input syntax for type uuid` and a stack trace — a typo in a code
// read over the phone deserves better than that.
const isTrace = /^[0-9a-f]{8}$/.test(id);
const isValuation = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
if (!isTrace && !isValuation) {
  process.stderr.write(
    `"${id}" is neither an 8-character code nor a valuation id.\n` +
      "usage: pnpm trace <traceId|valuationId>\n",
  );
  await pool.end();
  process.exit(1);
}

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

// Silence is ambiguous: "no such run" and "the reader is broken" look
// identical, and the appraiser reading a code aloud can easily mis-say a
// character. Say which it is.
if (events.length === 0 && audits.length === 0) {
  process.stdout.write(
    `Brak śladu dla ${isTrace ? `kodu ${id}` : `wyceny ${id}`}.\n` +
      (isTrace
        ? "Sprawdź, czy kod został odczytany poprawnie, albo czy zdarzenie nie jest starsze niż retencja.\n"
        : "Ta wycena nie ma jeszcze żadnych zapisów.\n"),
  );
  await pool.end();
  process.exit(0);
}

process.stdout.write(
  formatTimeline(
    mergeTimeline(
      events.map((e) => ({ at: e.at, level: e.level, event: e.event, meta: e.meta })),
      audits.map((a) => ({ at: a.at, action: a.action, actorId: a.actorId })),
    ),
  ),
);
await pool.end();
