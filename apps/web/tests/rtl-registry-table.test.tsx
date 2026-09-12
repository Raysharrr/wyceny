// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { RegistryTable } from "@/app/rejestr/registry-table";
import { periodFrom } from "@/app/rejestr/period";
import type { CoopTransaction } from "@/ports/coop-registry";

afterEach(cleanup);

const row = (over: Partial<CoopTransaction>): CoopTransaction => ({
  id: "r1",
  cooperative: "SM Syntetyczna",
  address: "os. Zmyślone",
  buildingNumber: "7",
  flatNumber: "3",
  area: 37.91,
  priceTotal: 299999.82,
  pricePerM2: 7913.48,
  date: "2026-05-14",
  priceKind: "nieustalona",
  rightType: null,
  rep: null,
  floor: null,
  rooms: null,
  buildYear: null,
  pos: { x: 1, y: 2 },
  source: "xls",
  dedupeKey: "k",
  ...over,
});

describe("RegistryTable (S2b Task 2)", () => {
  it("shows 'nieznane' for rightType null and 'do poprawki' for pos null — never blank", () => {
    render(
      <RegistryTable
        rows={[
          row({ id: "a" }),
          row({ id: "b", rightType: "spoldzielcze_wlasnosciowe", pos: null, source: "manual" }),
        ]}
      />,
    );
    expect(screen.getByText("nieznane")).toBeInTheDocument();
    expect(screen.getByText("spółdzielcze wł.")).toBeInTheDocument();
    expect(screen.getByText("✓ ustalona")).toBeInTheDocument();
    expect(screen.getByText("do poprawki")).toBeInTheDocument();
    expect(screen.getByText("ręcznie")).toBeInTheDocument();
    expect(screen.getAllByText(/299.999,82/)).toHaveLength(2);
  });
});

describe("periodFrom", () => {
  it("24m / 12m / all", () => {
    const now = new Date("2026-09-12T10:00:00Z");
    expect(periodFrom("24m", now)).toBe("2024-09-12");
    expect(periodFrom("12m", now)).toBe("2025-09-12");
    expect(periodFrom("all", now)).toBeUndefined();
  });
});
