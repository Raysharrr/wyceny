import { beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.fn();
vi.mock("@/app/valuations/_deps", () => ({ eventLog: { record } }));

beforeEach(() => {
  record.mockReset();
  record.mockResolvedValue(undefined);
});

describe("recordFailure", () => {
  it("persists the failure with its trace and context", async () => {
    const { recordFailure } = await import("../src/app/actions/_record-failure");
    const { withTrace } = await import("../src/lib/trace");

    await withTrace(async () =>
      recordFailure({
        event: "confirmSample.failed",
        error: new Error("worker unreachable"),
        valuationId: "v1",
        actorId: "u1",
      }),
    );

    expect(record).toHaveBeenCalledOnce();
    const entry = record.mock.calls[0]![0];
    expect(entry.level).toBe("error");
    expect(entry.event).toBe("confirmSample.failed");
    expect(entry.traceId).toMatch(/^[0-9a-f]{8}$/);
    expect(entry.valuationId).toBe("v1");
  });

  it("never lets a logging failure replace the failure it is logging", async () => {
    // recordFailure runs INSIDE a catch block. If the database is down and
    // this throws, the throw escapes that catch, the real cause is lost, and
    // the appraiser gets a raw exception instead of a Polish message — the
    // exact inverse of what this slice is for.
    record.mockRejectedValue(new Error("database is down"));
    const { recordFailure } = await import("../src/app/actions/_record-failure");

    await expect(
      recordFailure({ event: "confirmSample.failed", error: new Error("original cause") }),
    ).resolves.toBeUndefined();
  });
});
