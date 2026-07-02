import { describe, expect, it, vi } from "vitest";

/**
 * Focused unit test of `createValuation`'s REJECTION paths only. Validation
 * runs before any I/O (worker call, storage write, DB insert), so these
 * cases never touch the database — only the session lookup is mocked.
 * (See create-valuation.ts's authoritative-validation comment and the
 * `invalid_type` → generic Polish message fix it documents.)
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

import { createValuation, type CreateValuationInput } from "../src/app/actions/create-valuation";

const valid: CreateValuationInput = {
  address: "ul. Kościelna 33A, Poznań",
  area: 50,
  comparables: [
    { date: "2024-07", area: 60, pricePerM2: 12000 },
    { date: "2024-06", area: 61, pricePerM2: 13000 },
    { date: "2024-04", area: 62, pricePerM2: 14000 },
  ],
  features: [
    { name: "standard wykończenia", weightPct: 40, rating: "przecietna" },
    { name: "położenie na piętrze", weightPct: 30, rating: "przecietna" },
    { name: "lokalizacja", weightPct: 10, rating: "przecietna" },
    { name: "powierzchnia użytkowa", weightPct: 10, rating: "przecietna" },
    { name: "pomieszczenia przynależne", weightPct: 4, rating: "przecietna" },
    { name: "dodatkowe", weightPct: 6, rating: "przecietna" },
  ],
};

describe("createValuation — authoritative validation (rejection paths)", () => {
  it("rejects an empty address", async () => {
    const result = await createValuation({ ...valid, address: "" });
    expect(result).toEqual({ error: "Podaj adres nieruchomości." });
  });

  it("rejects fewer than 3 comparables", async () => {
    const result = await createValuation({ ...valid, comparables: valid.comparables.slice(0, 2) });
    expect(result).toEqual({ error: "Podaj co najmniej 3 transakcje porównawcze." });
  });

  it("rejects weights that do not sum to 100%", async () => {
    const features = valid.features.map((f, i) => (i === 0 ? { ...f, weightPct: 30 } : f));
    const result = await createValuation({ ...valid, features });
    expect(result).toEqual({ error: "Suma wag musi wynosić 100%." });
  });

  it("rejects a structurally malformed payload with the generic Polish message, not zod's English default", async () => {
    const malformed = {
      address: 123,
      area: "x",
      comparables: null,
      features: null,
    } as unknown as CreateValuationInput;

    const result = await createValuation(malformed);
    expect(result).toEqual({ error: "Nieprawidłowe dane formularza." });
  });
});
