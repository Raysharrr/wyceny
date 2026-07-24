import { describe, expect, it } from "vitest";
import { plural } from "@/components/wizard/plural";

describe("plural", () => {
  it("returns the singular form for 1", () => {
    expect(plural(1, "transakcja", "transakcje", "transakcji")).toBe("transakcja");
  });

  it("returns the few form for 2", () => {
    expect(plural(2, "transakcja", "transakcje", "transakcji")).toBe("transakcje");
  });

  it("returns the many form for 5", () => {
    expect(plural(5, "transakcja", "transakcje", "transakcji")).toBe("transakcji");
  });

  it("returns the many form for 12 (teen exception, not few)", () => {
    expect(plural(12, "transakcja", "transakcje", "transakcji")).toBe("transakcji");
  });

  it("returns the few form for 22 (2-4 outside the 12-14 exception range)", () => {
    expect(plural(22, "transakcja", "transakcje", "transakcji")).toBe("transakcje");
  });

  it("returns the few form for 104 (ends in 4, and 104 % 100 = 4 is outside the 12-14 exception)", () => {
    expect(plural(104, "transakcja", "transakcje", "transakcji")).toBe("transakcje");
  });
});
