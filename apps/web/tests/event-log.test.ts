import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { eventLogRepo } from "../src/adapters/event-log-drizzle";
import { newTraceId } from "../src/lib/trace";

const repo = eventLogRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await pool.end();
});

// A fresh traceId per run, not a literal: event_log is append-only in spirit
// (nothing here deletes) so fixed ids accumulate rows across local reruns and
// the second run of the suite fails on rows the first one left behind.
describe("event_log", () => {
  it("records and reads back by trace", async () => {
    const traceId = newTraceId();
    await repo.record({ level: "error", event: "confirmSample.failed", traceId, actorId: "u1" });
    const rows = await repo.byTrace(traceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("confirmSample.failed");
    expect(rows[0]!.level).toBe("error");
  });

  it("is ordered oldest-first, so a run reads as a timeline", async () => {
    const traceId = newTraceId();
    await repo.record({ level: "info", event: "first", traceId });
    await repo.record({ level: "error", event: "second", traceId });
    expect((await repo.byTrace(traceId)).map((r) => r.event)).toEqual(["first", "second"]);
  });
});
