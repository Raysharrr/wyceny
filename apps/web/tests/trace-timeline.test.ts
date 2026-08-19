import { describe, expect, it } from "vitest";
import { formatTimeline, mergeTimeline } from "../src/lib/trace-timeline";

const t = (s: number) => new Date(Date.UTC(2026, 7, 19, 7, 0, s));

describe("trace timeline", () => {
  it("interleaves operational events with audit rows, oldest first", () => {
    const merged = mergeTimeline(
      [{ id: 1, at: t(2), level: "error", event: "confirmSample.failed" }] as never,
      [{ id: 1, at: t(1), action: "created", actorId: "u1" }] as never,
    );
    expect(merged.map((e) => e.label)).toEqual(["audit: created", "error: confirmSample.failed"]);
  });

  it("renders one line per entry with a timestamp", () => {
    const out = formatTimeline(
      mergeTimeline([{ id: 1, at: t(1), level: "info", event: "x" }] as never, []),
    );
    expect(out).toContain("07:00:01");
    expect(out.trim().split("\n")).toHaveLength(1);
  });
});
