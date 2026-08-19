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

describe("failure record", () => {
  it("survives the rollback of the transaction that failed", async () => {
    const traceId = newTraceId();
    await expect(
      db.transaction(async () => {
        await repo.record({ level: "error", event: "boom", traceId });
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    // The point: audit_log writes INSIDE the transaction and would vanish
    // here. The record of a failure must not vanish with the failure.
    expect(await repo.byTrace(traceId)).toHaveLength(1);
  });
});
