import { describe, expect, it, vi } from "vitest";
import type { Valuation } from "../src/ports/valuation";

/**
 * Focused unit test of `approveValuation`'s status guard (final review,
 * Important #1): re-invoking approve on an already-approved valuation must
 * fail fast with a Polish error BEFORE any regeneration work — otherwise the
 * action would overwrite the stored operat files (mutating a frozen
 * artifact) and only then hit `assertDraft` inside `repo.approve`.
 *
 * `_deps` is automocked (mirrors create-valuation-action.test.ts) so
 * `valuationRepository.get`/`worker.convertToPdf`/`storage.put` become
 * controllable `vi.fn()`s and no real Postgres/HTTP call ever leaves the
 * test process. `@/auth/session` is mocked like docs-route.test.ts does;
 * `next/cache`/`next/navigation` are mocked because their real
 * implementations only work inside an actual Next.js request.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { approveValuation } from "../src/app/actions/approve-valuation";
import { storage, valuationRepository, worker } from "@/app/valuations/_deps";

const getMock = vi.mocked(valuationRepository.get);
const convertToPdfMock = vi.mocked(worker.convertToPdf);
const storagePutMock = vi.mocked(storage.put);

const approved: Valuation = {
  id: "valuation-approved-1",
  address: "ul. Testowa 1, Poznań",
  area: 50,
  wr: 1000000,
  inputs: null,
  amountInWords: "jeden milion złotych",
  docUrl: "/api/docs/operat-valuation-approved-1.pdf",
  docxUrl: "/api/docs/operat-valuation-approved-1.docx",
  purpose: "sprzedaz",
  kwNumber: "KW-TEST-1",
  client: "p. Jan Testowy",
  inspectionDate: "2026-07-01",
  ownerId: "test-user",
  status: "approved",
  approvedAt: new Date("2026-07-15T00:00:00.000Z"),
  signedAt: null,
  supersedesId: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};

describe("approveValuation — status guard (already-approved valuation)", () => {
  it("refuses with a Polish error and never regenerates/overwrites the stored operat files", async () => {
    getMock.mockResolvedValue(approved);

    const result = await approveValuation(approved.id);

    expect(result).toEqual({ error: "Wycena jest już zatwierdzona." });
    expect(storagePutMock).not.toHaveBeenCalled();
    expect(convertToPdfMock).not.toHaveBeenCalled();
  });
});
