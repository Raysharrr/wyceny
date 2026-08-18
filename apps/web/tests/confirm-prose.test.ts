import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Action `confirmProse` (ADR-014, FR-6, T6) — the appraiser's step-6
 * submit. Same mock shape as `propose-prose.test.ts`: `@/auth/session`
 * stubbed, `@/app/valuations/_deps` automocked, `next/cache` and
 * `next/navigation` stubbed (`redirect` THROWS, like Next's real one).
 *
 * The load-bearing property here is the ACL (ADR-010): whatever the browser
 * sends is TEXT. Provenance is assigned on this side or not at all — a
 * payload claiming `{source, status}` must not reach the repo.
 *
 * F-9: every address and note below is invented (ul. Klonowa, m. Nowogród).
 */
const getSessionMock = vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } }));

vi.mock("@/auth/session", () => ({ getSession: () => getSessionMock() }));
vi.mock("@/app/valuations/_deps");
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { confirmProse } from "../src/app/actions/confirm-prose";
import { valuationRepository } from "@/app/valuations/_deps";
import type { Valuation } from "@/ports/valuation";

const confirmProseMock = vi.mocked(valuationRepository.confirmProse);

const VALUATION_ID = "vid";
const SESSION_USER = { id: "test-user", role: "appraiser" };
const TEXT = "Lokal obejmuje dwa pokoje, kuchnię w aneksie i łazienkę z WC.";

beforeEach(() => {
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ user: SESSION_USER });
  confirmProseMock.mockReset();
  confirmProseMock.mockResolvedValue({ id: VALUATION_ID } as Valuation);
});

describe("confirmProse", () => {
  it("no session -> redirect to /login, nothing persisted", async () => {
    getSessionMock.mockResolvedValue(null as never);

    await expect(confirmProse(VALUATION_ID, { opis_lokalu: TEXT })).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(confirmProseMock).not.toHaveBeenCalled();
  });

  it("passes the appraiser's texts through to the repo", async () => {
    expect(await confirmProse(VALUATION_ID, { opis_lokalu: TEXT, otoczenie: "" })).toBeUndefined();

    expect(confirmProseMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      analiza_rynku: "",
      opis_lokalu: TEXT,
      otoczenie: "",
      zagospodarowanie: "",
      standard: "",
      uzasadnienie: "",
    });
  });

  it("keeps only the six known sections — an unknown key never reaches the repo", async () => {
    await confirmProse(VALUATION_ID, {
      opis_lokalu: TEXT,
      __proto__: "x",
      wnioski_koncowe: "sekcja, której nie ma",
    } as never);

    const payload = confirmProseMock.mock.calls[0][2];
    expect(Object.keys(payload).sort()).toEqual([
      "analiza_rynku",
      "opis_lokalu",
      "otoczenie",
      "standard",
      "uzasadnienie",
      "zagospodarowanie",
    ]);
  });

  it("a non-string value degrades to blank instead of reaching the jsonb column", async () => {
    // ADR-010: the browser may send anything; a client-supplied
    // `{value, provenance}` must never be stored as the section's text.
    await confirmProse(VALUATION_ID, {
      opis_lokalu: { value: TEXT, provenance: { source: "rzeczoznawca", status: "confirmed" } },
    } as never);

    expect(confirmProseMock.mock.calls[0][2].opis_lokalu).toBe("");
  });

  it("someone else's valuation (repo returns null) -> Polish error", async () => {
    confirmProseMock.mockResolvedValue(null);

    expect(await confirmProse(VALUATION_ID, { opis_lokalu: TEXT })).toEqual({
      error: "Nie znaleziono wyceny albo nie masz do niej dostępu.",
    });
  });

  it("a throwing repo (frozen operat, lost CAS) -> Polish error, never a stack trace", async () => {
    confirmProseMock.mockRejectedValue(new Error("Valuation vid is not a draft"));

    expect(await confirmProse(VALUATION_ID, { opis_lokalu: TEXT })).toEqual({
      error: "Nie udało się zapisać opisów — spróbuj ponownie.",
    });
  });
});
