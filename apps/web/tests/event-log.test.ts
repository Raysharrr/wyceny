import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { eventLogRepo } from "../src/adapters/event-log-drizzle";

const repo = eventLogRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await pool.end();
});

describe("event_log", () => {
  it("records and reads back by trace", async () => {
    const traceId = "aaaa1111";
    await repo.record({ level: "error", event: "confirmSample.failed", traceId, actorId: "u1" });
    const rows = await repo.byTrace(traceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("confirmSample.failed");
    expect(rows[0]!.level).toBe("error");
  });

  it("is ordered oldest-first, so a run reads as a timeline", async () => {
    const traceId = "bbbb2222";
    await repo.record({ level: "info", event: "first", traceId });
    await repo.record({ level: "error", event: "second", traceId });
    expect((await repo.byTrace(traceId)).map((r) => r.event)).toEqual(["first", "second"]);
  });
});
