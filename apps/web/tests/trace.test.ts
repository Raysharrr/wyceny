import { describe, expect, it } from "vitest";
import {
  currentTraceId,
  errorWithCode,
  newTraceId,
  traceHeaders,
  withTrace,
} from "../src/lib/trace";

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

describe("nesting", () => {
  it("keeps the outer id instead of minting a second one", async () => {
    const [outer, inner] = await withTrace(async () => {
      const outer = currentTraceId();
      const inner = await withTrace(async () => currentTraceId());
      return [outer, inner];
    });
    // A run that silently splits into two ids stops correlating halfway
    // through — the exact failure this whole slice exists to prevent.
    expect(inner).toBe(outer);
  });
});

describe("errorWithCode", () => {
  it("appends the code the appraiser reads back over the phone", async () => {
    const msg = await withTrace(async () => errorWithCode("Nie udało się potwierdzić próby."));
    expect(msg).toMatch(/^Nie udało się potwierdzić próby\. \(kod: [0-9a-f]{8}\)$/);
  });

  it("leaves the message alone outside a traced run", () => {
    expect(errorWithCode("Coś poszło nie tak.")).toBe("Coś poszło nie tak.");
  });
});

describe("traceHeaders", () => {
  it("carries the id across the web-worker boundary", async () => {
    const headers = await withTrace(async () => traceHeaders());
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is empty outside a traced run, so nothing bogus is sent", () => {
    expect(traceHeaders()).toEqual({});
  });
});
