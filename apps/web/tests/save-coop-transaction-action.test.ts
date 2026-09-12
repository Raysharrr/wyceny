import { describe, expect, it, vi } from "vitest";

/**
 * S2b Task 6: both `save()` failure branches come back in Polish and WITHOUT
 * the address or flat number (F-13); a geocoder miss is a visible
 * "do poprawki", not a silent success.
 */
const saveCalls: unknown[] = [];
let saveResult: { ok: true; row: { id: string } } | { ok: false; reason: "duplicate" | "invalid" } =
  {
    ok: true,
    row: { id: "row-1" },
  };
let hit: { x: number; y: number; source: "uug" } | null = { x: 1, y: 2, source: "uug" };

vi.mock("@/auth/session", () => ({
  getSession: async () => ({ user: { id: "u1", role: "appraiser" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/worker-token", () => ({ mintWorkerToken: () => "tok" }));
vi.mock("@/app/valuations/_deps", () => ({
  coopRegistry: {
    save: async (row: unknown) => {
      saveCalls.push(row);
      return saveResult;
    },
  },
  geocoder: { geocodeMany: async () => [hit] },
  eventLog: { record: async () => {} },
}));

const input = {
  cooperative: "SM Test",
  city: "Poznań",
  date: "2025-08-14",
  address: "os. Tajne",
  buildingNumber: "56",
  flatNumber: "12",
  area: 48.1,
  priceTotal: 521885,
  priceKind: "nieustalona" as const,
  rightType: null,
  floor: null,
  rooms: null,
  buildYear: null,
  rep: null,
};

describe("saveCoopTransaction", () => {
  it("saves with the geocoded pos, source manual", async () => {
    const { saveCoopTransaction } = await import("../src/app/actions/save-coop-transaction");
    const r = await saveCoopTransaction(input);
    expect(r).toEqual({ ok: true, id: "row-1", needsFix: false });
    expect(saveCalls.at(-1)).toMatchObject({ pos: { x: 1, y: 2 }, source: "manual" });
  });

  it("geocoder miss → saved with pos null and needsFix true (never silent)", async () => {
    hit = null;
    const { saveCoopTransaction } = await import("../src/app/actions/save-coop-transaction");
    const r = await saveCoopTransaction(input);
    expect(r).toMatchObject({ ok: true, needsFix: true });
    expect(saveCalls.at(-1)).toMatchObject({ pos: null });
  });

  it("duplicate → Polish message without the address", async () => {
    saveResult = { ok: false, reason: "duplicate" };
    const { saveCoopTransaction } = await import("../src/app/actions/save-coop-transaction");
    const r = await saveCoopTransaction(input);
    expect(r).toEqual({
      ok: false,
      error:
        "Taka transakcja jest już w rejestrze (ten sam adres, mieszkanie i data albo ten sam numer repertorium).",
    });
    expect(JSON.stringify(r)).not.toContain("Tajne");
  });

  it("invalid → 'Powierzchnia i cena muszą być większe od zera.' pinned to a field", async () => {
    saveResult = { ok: false, reason: "invalid" };
    const { saveCoopTransaction } = await import("../src/app/actions/save-coop-transaction");
    const r = await saveCoopTransaction(input);
    expect(r).toEqual({
      ok: false,
      error: "Powierzchnia i cena muszą być większe od zera.",
      field: "area",
    });
    // zod catches it before the port: area 0 never reaches save()
    const before = saveCalls.length;
    const z = await saveCoopTransaction({ ...input, area: 0 });
    expect(z).toMatchObject({ ok: false, error: "Powierzchnia i cena muszą być większe od zera." });
    expect(saveCalls.length).toBe(before);
  });
});
