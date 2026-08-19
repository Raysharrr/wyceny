import { describe, expect, it } from "vitest";
import { errFields, pickAllowed } from "../src/lib/log";

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

describe("errFields", () => {
  it("truncates at the source, not only on the way to stdout", () => {
    // `recordFailure` puts errFields' output into `event_log.meta`, and meta
    // does NOT pass through pickAllowed. Truncating only in pickAllowed
    // therefore capped the stdout copy while the database kept the full text
    // — which is where an external API's echo of our address would land.
    const error = new Error("x".repeat(500));
    error.stack = "y".repeat(5000);
    const fields = errFields(error);
    expect(fields.errMessage).toHaveLength(300);
    expect(fields.errStack).toHaveLength(2000);
  });

  it("leaves short values alone", () => {
    const fields = errFields(new Error("boom"));
    expect(fields.errMessage).toBe("boom");
  });

  it("truncates a non-Error thrown value too", () => {
    expect(errFields("z".repeat(400)).errMessage).toHaveLength(300);
  });
});
