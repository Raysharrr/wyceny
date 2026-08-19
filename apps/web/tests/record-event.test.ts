import { beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.fn();
vi.mock("@/app/valuations/_deps", () => ({ eventLog: { record } }));

beforeEach(() => {
  record.mockReset();
  record.mockResolvedValue(undefined);
});

describe("recordEvent", () => {
  it("writes the event", async () => {
    const { recordEvent } = await import("../src/app/actions/_record-failure");
    await recordEvent({ level: "info", event: "proposal.sample", meta: { count: 12 } });
    expect(record).toHaveBeenCalledOnce();
  });

  it("never throws when the write fails — telemetry must not break the feature", async () => {
    // The table may simply not exist yet: migrations are applied by the
    // production build, so a freshly deployed preview runs the new code
    // against the old schema. An unguarded insert would turn a successful
    // RCN fetch into a raw Postgres message on the appraiser's screen.
    record.mockRejectedValue(new Error('relation "event_log" does not exist'));
    const { recordEvent } = await import("../src/app/actions/_record-failure");
    await expect(recordEvent({ level: "info", event: "proposal.sample" })).resolves.toBeUndefined();
  });

  it("gives up rather than hanging when the database stops answering", async () => {
    // pg's Pool defaults to connectionTimeoutMillis: 0 — queue forever. A sick
    // database is the usual reason we are logging at all, so an unbounded
    // await here parks the very request that was trying to report it.
    record.mockImplementation(() => new Promise(() => {}));
    const { recordEvent } = await import("../src/app/actions/_record-failure");
    await expect(recordEvent({ level: "info", event: "slow" })).resolves.toBeUndefined();
  }, 10_000);
});
