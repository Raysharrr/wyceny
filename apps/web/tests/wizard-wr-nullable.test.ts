import { describe, expect, it } from "vitest";
import { documentFieldBlockers } from "../src/domain/document-model";

const base = {
  purpose: "sprzedaz" as const,
  kwNumber: "PO1P/1/6",
  client: "p. Test",
  inspectionDate: "2026-07-01",
};

describe("documentFieldBlockers — wr (Slice 11a)", () => {
  it("blocks approval when wr is null (calculation not confirmed)", () => {
    const blockers = documentFieldBlockers({ ...base, wr: null });
    expect(blockers.some((b) => b.path === "wr")).toBe(true);
  });
  it("no wr blocker when wr is set", () => {
    const blockers = documentFieldBlockers({ ...base, wr: 1_044_400 });
    expect(blockers.some((b) => b.path === "wr")).toBe(false);
  });
});
