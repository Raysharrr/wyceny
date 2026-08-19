import { describe, expect, it } from "vitest";
import { pickAllowed } from "../src/lib/log";

describe("log allowlist", () => {
  it("keeps permitted keys", () => {
    expect(pickAllowed({ event: "a", traceId: "b", ms: 12 })).toEqual({
      event: "a",
      traceId: "b",
      ms: 12,
    });
  });

  it("drops anything not on the list — this is the RODO gate", () => {
    const out = pickAllowed({ event: "a", address: "ul. Testowa 1", kwNumber: "PO1P/000/1" });
    expect(out).toEqual({ event: "a" });
  });

  it("truncates errMessage to 300 chars", () => {
    const out = pickAllowed({ event: "a", errMessage: "x".repeat(500) });
    expect((out.errMessage as string).length).toBe(300);
  });

  it("drops a permitted key carrying an object — allowlist is by key AND shape", () => {
    expect(pickAllowed({ event: "a", ms: { nested: 1 } })).toEqual({ event: "a" });
  });
});
