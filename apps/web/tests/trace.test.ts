import { describe, expect, it } from "vitest";
import { currentTraceId, newTraceId, withTrace } from "../src/lib/trace";

describe("trace context", () => {
  it("is 8 hex chars — short enough to read over the phone", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("survives an await in a nested call that was never passed it", async () => {
    const seen = await withTrace(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return nested();
    });
    expect(seen).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps concurrent runs isolated — the whole point of ALS", async () => {
    const [a, b] = await Promise.all([
      withTrace(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return nested();
      }),
      withTrace(async () => {
        await new Promise((r) => setTimeout(r, 1));
        return nested();
      }),
    ]);
    expect(a).not.toBe(b);
  });

  it("returns undefined outside any traced run", () => {
    expect(currentTraceId()).toBeUndefined();
  });
});

function nested() {
  return currentTraceId();
}
