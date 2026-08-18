import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Action `proposeProse` (ADR-014, T5) — the same mock shape as
 * `inspection-actions.test.ts`: `@/auth/session` stubbed,
 * `@/app/valuations/_deps` automocked (so neither Postgres nor the worker is
 * ever touched), `next/cache` and `next/navigation` stubbed.
 *
 * `redirect` THROWS here on purpose: Next's real one unwinds the action, and
 * a mock that returns would let the code after it run against a null session.
 *
 * F-9: every address, number and note below is invented (ul. Klonowa,
 * m. Nowogród).
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

import { proposeProse } from "../src/app/actions/propose-prose";
import { proseProposal, valuationRepository } from "@/app/valuations/_deps";
import { PROSE_WORKER_RESPONDED_PREFIX } from "@/adapters/prose-http";
import { buildProseFacts } from "@/domain/prose";
import { currentProseFactsHash } from "@/domain/prose-hash";
import type { KcsInput } from "@/domain/kcs";
import type { Valuation } from "@/ports/valuation";

const fetchProposalMock = vi.mocked(proseProposal.fetchProposal);
const getMock = vi.mocked(valuationRepository.get);
const saveProseMock = vi.mocked(valuationRepository.saveProse);

const VALUATION_ID = "vid";
const SESSION_USER = { id: "test-user", role: "appraiser" };
const ADDRESS = "ul. Klonowa 14/3, Nowogród";
const NOTE = "Układ: 2 pokoje, kuchnia, łazienka; otoczenie: zabudowa wielorodzinna.";

const INPUTS: KcsInput = {
  area: 68.4,
  comparables: [
    { date: "2024-11", area: 58.1, pricePerM2: 9240, source: "rcn", transactionId: "tx-1" },
    { date: "2025-03", area: 79.9, pricePerM2: 12480, source: "rcn", transactionId: "tx-2" },
    { date: "2024-12", area: 64, pricePerM2: 10725, source: "manual" },
  ],
  features: [
    { key: "standard_wykonczenia", name: "standard wykończenia", weight: 1, rating: "lepsza" },
  ],
  inspection: { note: NOTE, photos: { otoczenie: [], budynekZewn: [], wnetrza: [] } },
};

const draft: Valuation = {
  id: VALUATION_ID,
  address: ADDRESS,
  area: 68.4,
  wr: null,
  inputs: INPUTS,
  amountInWords: null,
  docUrl: null,
  docxUrl: null,
  purpose: "sprzedaz",
  kwNumber: null,
  client: null,
  inspectionDate: null,
  ownerId: "test-user",
  status: "in_progress",
  approvedAt: null,
  signedAt: null,
  supersedesId: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

const PROPOSAL = {
  sections: { opis_lokalu: "Lokal o powierzchni 68,40 m2 obejmuje dwa pokoje z kuchnią." },
  rejected: { analiza_rynku: ["9 871,00"], uzasadnienie: [] },
  model: "claude-sonnet-5",
  usage: { inputTokens: 3120, outputTokens: 480 },
};

beforeEach(() => {
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ user: SESSION_USER });
  getMock.mockReset();
  saveProseMock.mockReset();
  fetchProposalMock.mockReset();
  process.env.WORKER_SHARED_SECRET = "test-secret";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-18T07:30:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("proposeProse — gates before any token is spent", () => {
  it("no session -> redirect to /login, worker untouched", async () => {
    getSessionMock.mockResolvedValue(null as never);

    await expect(proposeProse(VALUATION_ID)).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });

  it("someone else's valuation (repo returns null) -> error, worker untouched", async () => {
    getMock.mockResolvedValue(null);

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: "Nie znaleziono wyceny albo nie masz do niej dostępu.",
    });
    expect(getMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER);
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });

  it("not a draft -> error, worker untouched (an approved operat is frozen)", async () => {
    getMock.mockResolvedValue({ ...draft, status: "approved" });

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: "Opisy można wygenerować tylko dla szkicu wyceny.",
    });
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });

  it("nothing to write from -> honest error, worker untouched", async () => {
    getMock.mockResolvedValue({
      ...draft,
      inputs: { area: 68.4, comparables: [], features: [] },
    });

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error:
        "Za mało danych, żeby wygenerować opisy — uzupełnij próbę, notatkę z oględzin albo dane ewidencyjne.",
    });
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });

  it("no shared secret -> configuration error, worker untouched", async () => {
    delete process.env.WORKER_SHARED_SECRET;
    getMock.mockResolvedValue(draft);

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: "Generowanie opisów nie jest skonfigurowane — skontaktuj się z administratorem.",
    });
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });
});

describe("proposeProse — happy path", () => {
  it("sends facts + transactions, persists an ai/to_verify snapshot with the usage", async () => {
    getMock.mockResolvedValue(draft);
    fetchProposalMock.mockResolvedValue(PROPOSAL);
    saveProseMock.mockResolvedValue(draft);

    const result = await proposeProse(VALUATION_ID);

    const facts = buildProseFacts({ address: ADDRESS, inputs: INPUTS });
    expect(fetchProposalMock).toHaveBeenCalledWith({
      token: expect.stringMatching(/^\d+\.[0-9a-f]+\.[0-9a-f]{64}$/),
      sections: [
        "analiza_rynku",
        "opis_lokalu",
        "otoczenie",
        // No EGiB snapshot here — the inspection note alone keeps this one alive.
        "zagospodarowanie",
        "standard",
        "uzasadnienie",
      ],
      facts,
      transactions: [
        { data: "11-2024", cena_m2: 9240 },
        { data: "03-2025", cena_m2: 12480 },
        { data: "12-2024", cena_m2: 10725 },
      ],
    });

    const expectedSnapshot = {
      sections: {
        opis_lokalu: {
          value: PROPOSAL.sections.opis_lokalu,
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      rejected: PROPOSAL.rejected,
      // Over the facts AND the transactions (review I-2): the worker derives
      // `proba.trend_cen` from the latter, so a facts-only fingerprint would
      // miss an edit that reverses the trend the operat asserts.
      factsHash: currentProseFactsHash({ address: ADDRESS, inputs: INPUTS }),
      model: "claude-sonnet-5",
      generatedAt: "2026-08-18T07:30:00.000Z",
    };
    expect(saveProseMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, expectedSnapshot, {
      inputTokens: 3120,
      outputTokens: 480,
    });
    expect(result).toEqual({ prose: expectedSnapshot });
  });
});

describe("proposeProse — failures after the call", () => {
  it("the worker's Polish detail reaches the appraiser, nothing is persisted", async () => {
    getMock.mockResolvedValue(draft);
    fetchProposalMock.mockRejectedValue(
      new Error("Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie."),
    );

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: "Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie.",
    });
    expect(saveProseMock).not.toHaveBeenCalled();
  });

  it("the adapter's English status line is replaced with a Polish message", async () => {
    getMock.mockResolvedValue(draft);
    fetchProposalMock.mockRejectedValue(
      new Error(`${PROSE_WORKER_RESPONDED_PREFIX} 422 Unprocessable Entity`),
    );

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: "Nie udało się wygenerować opisów — spróbuj ponownie.",
    });
    expect(saveProseMock).not.toHaveBeenCalled();
  });

  it("repo returns null (CAS lost / status flipped mid-flight) -> error", async () => {
    getMock.mockResolvedValue(draft);
    fetchProposalMock.mockResolvedValue(PROPOSAL);
    saveProseMock.mockResolvedValue(null);

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: "Nie znaleziono wyceny albo nie masz do niej dostępu.",
    });
  });
});
