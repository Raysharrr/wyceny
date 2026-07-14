import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused unit test of `getSampleProposal` — mirrors
 * create-valuation-action.test.ts's session-mock style. `_deps` is
 * automocked so `sampleProposal.fetchProposal` becomes a controllable
 * `vi.fn()` and no real HTTP call ever leaves the test process.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

import { getSampleProposal } from "../src/app/actions/get-sample-proposal";
import { sampleProposal } from "@/app/valuations/_deps";
import type { SampleProposal } from "@/ports/sample";

const fetchProposalMock = vi.mocked(sampleProposal.fetchProposal);

const validInput = { address: "ul. Kościelna 33A, Poznań", area: 71.63 };

const proposal: SampleProposal = {
  transactions: [{ date: "2026-05", area: 48.5, pricePerM2: 12500, transactionId: "abc-123" }],
  meta: {
    lat: 52.2297,
    lon: 21.0122,
    fetchedAt: "2026-07-14T10:00:00.000Z",
    source: "rcn-wfs-gugik",
    query: { bbox: [52.2117, 20.9832, 52.2477, 21.0412], count: 5000, sort: "dok_data D" },
  },
};

describe("getSampleProposal", () => {
  beforeEach(() => {
    fetchProposalMock.mockReset();
  });

  it("happy path — returns the proposal from the mocked adapter", async () => {
    fetchProposalMock.mockResolvedValue(proposal);

    const result = await getSampleProposal(validInput);

    expect(fetchProposalMock).toHaveBeenCalledWith(validInput.address, validInput.area);
    expect(result).toEqual({ proposal });
  });

  it("adapter throw carrying the worker's Polish detail -> { error } with that message", async () => {
    const detail =
      "Za mało transakcji w okolicy (znaleziono 5) — zawęź adres albo uzupełnij próbę ręcznie.";
    fetchProposalMock.mockRejectedValue(new Error(detail));

    const result = await getSampleProposal(validInput);

    expect(result).toEqual({ error: detail });
  });

  it("adapter throw with the status-text fallback -> generic Polish { error }", async () => {
    fetchProposalMock.mockRejectedValue(
      new Error("worker /sample-proposal responded 500 Internal Server Error"),
    );

    const result = await getSampleProposal(validInput);

    expect(result).toEqual({
      error: "Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie.",
    });
  });

  it("rejects an empty address using the shared schema's rule, without calling the adapter", async () => {
    const result = await getSampleProposal({ ...validInput, address: "" });

    expect(result).toEqual({ error: "Podaj adres nieruchomości." });
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive area using the shared schema's rule, without calling the adapter", async () => {
    const result = await getSampleProposal({ ...validInput, area: 0 });

    expect(result).toEqual({ error: "Powierzchnia musi być większa od zera." });
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });
});
