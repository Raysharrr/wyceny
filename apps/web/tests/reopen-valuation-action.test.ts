import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";

/**
 * `reopenValuationAction` — „Cofnij zatwierdzenie i popraw” (ADR-020 reguła 6,
 * spec §3 P9). Mirrors `create-new-version-action.test.ts`: `_deps` is
 * automocked so `valuationRepository.reopen` is a controllable `vi.fn()` and
 * no real Postgres call leaves the test process.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "u1", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { reopenValuationAction } from "../src/app/actions/reopen-valuation";
import { valuationRepository } from "@/app/valuations/_deps";
import { NotReopenableError } from "@/domain/valuation";
import { revalidatePath } from "next/cache";

const reopenMock = vi.mocked(valuationRepository.reopen);

const approved: Valuation = {
  id: "v1",
  address: "Testowa 1",
  area: 40,
  wr: 400_000,
  inputs: approvableInput("u1").inputs,
  amountInWords: "czterysta tysięcy złotych",
  docUrl: "/api/docs/operat-v1-1789000000000.pdf",
  docxUrl: "/api/docs/operat-v1-1789000000000.docx",
  purpose: "sprzedaz",
  propertyRight: "wlasnosc_lokalu",
  kwNumber: "PO1P/1/6",
  client: "Jan Testowy",
  inspectionDate: "2026-07-10",
  ownerId: "u1",
  status: "approved",
  approvedAt: new Date("2026-09-15T08:00:00.000Z"),
  signedAt: null,
  supersedesId: null,
  mapsFrozenFor: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

const reopened: Valuation = {
  ...approved,
  status: "in_progress",
  approvedAt: null,
  docUrl: null,
  docxUrl: null,
  amountInWords: null,
  wr: null,
};

describe("reopenValuationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reopens the valuation and refreshes the pages that showed it as approved", async () => {
    reopenMock.mockResolvedValue(reopened);

    const result = await reopenValuationAction("v1");

    expect(result).toBeUndefined();
    expect(reopenMock).toHaveBeenCalledWith("v1", { id: "u1", role: "appraiser" });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/valuations/v1");
  });

  it("answers in Polish when the valuation is not the caller's, or not there", async () => {
    reopenMock.mockResolvedValue(null);

    expect(await reopenValuationAction("v1")).toEqual({
      error: "Nie znaleziono wyceny albo nie masz do niej dostępu.",
    });
  });

  it("answers in Polish when the valuation is signed or was never approved", async () => {
    reopenMock.mockRejectedValue(new NotReopenableError("not an unsigned approval"));

    expect(await reopenValuationAction("v1")).toEqual({
      error: "Cofnąć zatwierdzenie można tylko w operacie zatwierdzonym i jeszcze niepodpisanym.",
    });
  });

  it("does not swallow an unexpected failure as a status refusal", async () => {
    reopenMock.mockRejectedValue(new Error("connection terminated"));

    const result = await reopenValuationAction("v1");

    // A trace code, not the status message — the appraiser must not be told
    // their operat is signed when the database simply blinked.
    expect(result?.error).toContain("kod:");
    expect(result?.error).not.toContain("niepodpisanym");
  });
});
