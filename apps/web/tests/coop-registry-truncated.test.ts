import { describe, expect, it } from "vitest";
import { isTruncated, LIST_CAP } from "../src/adapters/coop-registry-drizzle";

describe("isTruncated — the register's cap, without a racing count()", () => {
  it("a capped read that fills the whole page is reported as truncated (5 000 = cap)", () => {
    expect(isTruncated(LIST_CAP, LIST_CAP)).toBe(true);
  });
  it("a capped read short of the page is complete (4 999)", () => {
    expect(isTruncated(LIST_CAP, LIST_CAP - 1)).toBe(false);
  });
  it("a paged read (limit below the cap) is never truncated, only paged", () => {
    expect(isTruncated(50, 50)).toBe(false);
    expect(isTruncated(50, 5_000)).toBe(false);
  });
});
