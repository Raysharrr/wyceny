import { describe, expect, it, vi } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";

/**
 * Focused unit test of `createNewVersionAction` (F-7 Task 9). Mirrors
 * `sign-valuation-action.test.ts`: `_deps` is automocked so
 * `valuationRepository.createNewVersion` becomes a controllable `vi.fn()`
 * and no real Postgres call ever leaves the test process. `@/auth/session`
 * and `next/cache`/`next/navigation` are mocked the same way.
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

import { createNewVersionAction } from "../src/app/actions/create-new-version";
import { valuationRepository } from "@/app/valuations/_deps";
import { redirect } from "next/navigation";

const createNewVersionMock = vi.mocked(valuationRepository.createNewVersion);

const signedValuation: Valuation = {
  id: "v1",
  address: "Testowa 1",
  area: 40,
  wr: 400000,
  inputs: approvableInput("u1").inputs,
  amountInWords: null,
  docUrl: "/api/docs/operat-v1-signed.pdf",
  docxUrl: "/api/docs/operat-v1-signed.docx",
  purpose: "sprzedaz",
  kwNumber: "PO1P/1/6",
  client: "Jan Testowy",
  inspectionDate: "2026-07-10",
  ownerId: "u1",
  status: "signed",
  approvedAt: new Date("2026-07-19"),
  signedAt: new Date("2026-07-19"),
  supersedesId: null,
  createdAt: new Date(),
};

describe("createNewVersionAction", () => {
  it("creates the copy and redirects to the new draft", async () => {
    createNewVersionMock.mockResolvedValue({ ...signedValuation, id: "v2", status: "in_progress" });

    await createNewVersionAction("v1");

    expect(createNewVersionMock).toHaveBeenCalledWith("v1", { id: "u1", role: "appraiser" });
    expect(redirect).toHaveBeenCalledWith("/valuations/v2");
  });

  it("maps a not-found/not-owner result to a Polish error", async () => {
    createNewVersionMock.mockResolvedValue(null);

    const result = await createNewVersionAction("v1");

    expect(result?.error).toMatch(/nie znaleziono|nie masz do niej dostępu/i);
  });

  it("maps a status violation to a Polish error", async () => {
    createNewVersionMock.mockRejectedValue(new Error("not signed"));

    const result = await createNewVersionAction("v1");

    expect(result?.error).toMatch(/tylko z podpisan/i);
  });
});
