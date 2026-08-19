import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCode } from "./fixtures/with-code";

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
import { PROSE_WORKER_RESPONDED_PREFIX, ProseWorkerDetailError } from "@/adapters/prose-http";
import { buildProseFacts } from "@/domain/prose";
import { currentSectionFactsHash } from "@/domain/prose-hash";
import { confirmedProseFor } from "./fixtures/valuation-inputs";
import type { KcsInput } from "@/domain/kcs";
import type { ProseSection } from "@/domain/prose-snapshot";
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
  mapsFrozenFor: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

const PROPOSAL = {
  sections: { opis_lokalu: "Lokal o powierzchni 68,40 m2 obejmuje dwa pokoje z kuchnią." },
  rejected: { analiza_rynku: ["9 871,00"], uzasadnienie: [] },
  model: "claude-sonnet-5",
  usage: { inputTokens: 3120, outputTokens: 480 },
};

/** All six sections, in the same order `PROSE_SECTIONS` — the request shape when nothing is persisted yet. */
const ALL_SECTIONS: ProseSection[] = [
  "analiza_rynku",
  "opis_lokalu",
  "otoczenie",
  "zagospodarowanie",
  "standard",
  "uzasadnienie",
];

/**
 * A draft with all six sections already `rzeczoznawca`/`confirmed`
 * (`confirmedProseFor`, fingerprinted against the ORIGINAL `INPUTS`), then
 * ONE comparable's price edited. `analiza_rynku` and `uzasadnienie` are the
 * only sections whose fact subset includes `proba`/the transactions
 * (`PROSE_SECTION_FACTS`, `SECTIONS_USING_TRANSACTIONS` — T1), so editing a
 * price invalidates exactly those two and leaves the other four's fingerprint
 * untouched.
 *
 * Deliberately appraiser-authored, not `ai` (T3 ruling 1): the sections the
 * appraiser already wrote are NOT excluded from the batch — only ordering
 * them lets `mergeProseProposal` demote a stale one from `confirmed` back to
 * `to_verify` and force a re-read. Excluding them here would leave this test
 * unable to tell that guarantee apart from one that simply skips appraiser
 * sections entirely.
 */
function setupWithStaleSample() {
  const prose = confirmedProseFor(ADDRESS, INPUTS);
  const editedInputs: KcsInput = {
    ...INPUTS,
    comparables: INPUTS.comparables.map((c, i) =>
      i === 0 ? { ...c, pricePerM2: c.pricePerM2 + 500 } : c,
    ),
  };
  getMock.mockResolvedValue({ ...draft, inputs: { ...editedInputs, prose } });
  fetchProposalMock.mockResolvedValue(PROPOSAL);
  saveProseMock.mockResolvedValue(draft);
  return { fetchProposal: fetchProposalMock };
}

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

  it("NEXT_PUBLIC_PROSE=off -> refuses BEFORE the draft is even read; nothing is spent", async () => {
    // The kill switch has to gate the layer that SPENDS. The step props and
    // the component were both gated; this Server Action is a POST endpoint
    // any authenticated owner can call directly, flag or no flag (T6 review,
    // I-1). On the server the flag is a runtime read, so this refuses on the
    // very next request after it is flipped — no rebuild.
    vi.stubEnv("NEXT_PUBLIC_PROSE", "off");
    getMock.mockResolvedValue(draft);

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: "Generowanie opisów jest wyłączone.",
    });
    expect(getMock).not.toHaveBeenCalled();
    expect(fetchProposalMock).not.toHaveBeenCalled();
    expect(saveProseMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
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
      // draft.inputs.prose is undefined — every generatable section counts as
      // MISSING, so T3's selection sends all six, same as before T3 existed.
      sections: ALL_SECTIONS,
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
      // T2 moved the fingerprint from one hash for the whole valuation to one
      // per section; T3 stamps it only for the sections actually REQUESTED —
      // here, all six. Each one is over its own fact subset AND (for
      // `analiza_rynku`/`uzasadnienie`) the transactions (review I-2): the
      // worker derives `proba.trend_cen` from the latter, so a facts-only
      // fingerprint would miss an edit that reverses the trend the operat
      // asserts.
      factsHashes: Object.fromEntries(
        ALL_SECTIONS.map((section) => [
          section,
          currentSectionFactsHash(section, { address: ADDRESS, inputs: INPUTS }),
        ]),
      ),
      // T5 fix round 1: the same six fingerprints, under a name that means
      // "asked" rather than "answered". Five of these sections came back with
      // NO text (`PROPOSAL` delivers only opis_lokalu) and every one is still
      // recorded here — that is the whole point. The two maps hold the same
      // thing only at this instant; the first merge separates them.
      attempts: Object.fromEntries(
        ALL_SECTIONS.map((section) => [
          section,
          currentSectionFactsHash(section, { address: ADDRESS, inputs: INPUTS }),
        ]),
      ),
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

describe("proposeProse — regenerates only the sections whose facts moved (T3)", () => {
  it("regenerates only the sections whose facts moved", async () => {
    const { fetchProposal } = setupWithStaleSample();

    await proposeProse(VALUATION_ID);

    expect(fetchProposal.mock.calls[0]![0].sections.sort()).toEqual([
      "analiza_rynku",
      "uzasadnienie",
    ]);
  });

  it("a draft where nothing moved is not regenerated at all — the current prose comes back untouched", async () => {
    // Same fixture as above but WITHOUT the price edit: every section is
    // both present and fresh, so the T3 selection is empty and the action
    // must not call the worker at all.
    const prose = confirmedProseFor(ADDRESS, INPUTS);
    getMock.mockResolvedValue({ ...draft, inputs: { ...INPUTS, prose } });

    const result = await proposeProse(VALUATION_ID);

    expect(fetchProposalMock).not.toHaveBeenCalled();
    expect(saveProseMock).not.toHaveBeenCalled();
    expect(result).toEqual({ prose });
  });

  it("opts.sections forces a named section even when it is not stale — the appraiser's own 'redo this one'", async () => {
    const { fetchProposal } = setupWithStaleSample();

    // otoczenie is untouched by the price edit — not stale — yet an explicit
    // request for it must still reach the worker: opts bypasses the
    // missing-or-stale filter entirely, it does not narrow it further.
    await proposeProse(VALUATION_ID, { sections: ["otoczenie"] });

    expect(fetchProposal.mock.calls[0]![0].sections).toEqual(["otoczenie"]);
  });

  it("opts.sections never asks for a section today's facts cannot back", async () => {
    fetchProposalMock.mockResolvedValue(PROPOSAL);
    saveProseMock.mockResolvedValue(draft);
    // No inspection note: otoczenie is not generatable at all from these
    // facts (mirrors the "offers only the sections today's facts can back"
    // case in prose-step-props.test.ts) — uzasadnienie is unaffected.
    getMock.mockResolvedValue({ ...draft, inputs: { ...INPUTS, inspection: undefined } });

    await proposeProse(VALUATION_ID, { sections: ["otoczenie", "uzasadnienie"] });

    expect(fetchProposalMock.mock.calls[0]![0].sections).toEqual(["uzasadnienie"]);
  });

  it("opts.sections trimmed to nothing, with no prior prose to fall back on -> honest error, worker untouched", async () => {
    // otoczenie is not generatable at all (no note) AND nothing was ever
    // generated before: the "nothing needs regenerating, return the current
    // snapshot" short-circuit has no snapshot to return. `valuation.inputs
    // .prose` is undefined here, and the return type promises a REAL
    // ProseSnapshot — asserting it non-null would ship `{ prose: undefined }`
    // to a caller that only checks `"error" in result`.
    getMock.mockResolvedValue({ ...draft, inputs: { ...INPUTS, inspection: undefined } });

    const result = await proposeProse(VALUATION_ID, { sections: ["otoczenie"] });

    expect(result).toEqual({
      error:
        "Za mało danych, żeby wygenerować opisy — uzupełnij próbę, notatkę z oględzin albo dane ewidencyjne.",
    });
    expect(fetchProposalMock).not.toHaveBeenCalled();
    expect(saveProseMock).not.toHaveBeenCalled();
  });
});

describe("proposeProse — failures after the call", () => {
  const GENERIC = "Nie udało się wygenerować opisów — spróbuj ponownie.";

  it("the worker's Polish detail reaches the appraiser, nothing is persisted", async () => {
    getMock.mockResolvedValue(draft);
    fetchProposalMock.mockRejectedValue(
      new ProseWorkerDetailError(
        "Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie.",
      ),
    );

    expect(await proposeProse(VALUATION_ID)).toEqual({
      error: withCode("Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie."),
    });
    expect(saveProseMock).not.toHaveBeenCalled();
  });

  it("the adapter's English status line is replaced with a Polish message", async () => {
    getMock.mockResolvedValue(draft);
    fetchProposalMock.mockRejectedValue(
      new Error(`${PROSE_WORKER_RESPONDED_PREFIX} 422 Unprocessable Entity`),
    );

    expect(await proposeProse(VALUATION_ID)).toEqual({ error: withCode(GENERIC) });
    expect(saveProseMock).not.toHaveBeenCalled();
  });

  /**
   * Two leaks the T5 review found. Only a sentence the WORKER wrote for a
   * human may be shown; everything else is our own plumbing talking, and the
   * appraiser is neither its audience nor allowed to see where it runs.
   */
  it("a dead connection shows the Polish message, not 'fetch failed'", async () => {
    getMock.mockResolvedValue(draft);
    // What undici throws when the host cannot be reached at all.
    fetchProposalMock.mockRejectedValue(new TypeError("fetch failed"));

    expect(await proposeProse(VALUATION_ID)).toEqual({ error: withCode(GENERIC) });
  });

  it("a proxy's HTML error page never reaches the appraiser — no internal address leaks", async () => {
    getMock.mockResolvedValue(draft);
    // A gateway answering with HTML: the JSON parser blows up and quotes the
    // body — internal hostname and all. Fictional host (F-9).
    fetchProposalMock.mockRejectedValue(
      new SyntaxError(
        `Unexpected token '<', "<html><head><title>502 Bad Gateway</title></head><body>worker-internal.invalid:8000</body></html>" is not valid JSON`,
      ),
    );

    const result = await proposeProse(VALUATION_ID);

    expect(result).toEqual({ error: withCode(GENERIC) });
    expect(JSON.stringify(result)).not.toContain("worker-internal");
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

/**
 * The attempts bound, applied where the batch is actually decided (T5 fix
 * round 2).
 *
 * `worthGenerating` in the step decides WHETHER to call; this decides WHAT the
 * call contains, and it is the same money. Without it a section refused at
 * today's facts rides along in every batch that any OTHER section legitimately
 * earns — bought again each time, for as long as its own facts stay put.
 *
 * The bound applies to the AUTOMATIC batch only. Both ways the appraiser can
 * ask — naming sections, or asking for the missing-or-stale set with
 * `includeAttempted` — go through untouched: asking must always work.
 */
describe("proposeProse — an answer already given is not bought again (T5 fix round 2)", () => {
  const editedInputs = (): KcsInput => ({
    ...INPUTS,
    comparables: INPUTS.comparables.map((c, i) =>
      i === 0 ? { ...c, pricePerM2: c.pricePerM2 + 500 } : c,
    ),
  });

  /**
   * The price edit makes `analiza_rynku` AND `uzasadnienie` stale. Only
   * `uzasadnienie` was then re-requested at the edited facts — and refused, so
   * it kept its OLD `factsHashes` entry and is still stale. Exactly the shape
   * that used to be re-bought on every warranted batch.
   */
  function setupWithRefusedSection(inputs: KcsInput = editedInputs()) {
    const prose = confirmedProseFor(ADDRESS, INPUTS);
    prose.attempts = {
      uzasadnienie: currentSectionFactsHash("uzasadnienie", { address: ADDRESS, inputs }),
    };
    getMock.mockResolvedValue({ ...draft, inputs: { ...inputs, prose } });
    fetchProposalMock.mockResolvedValue(PROPOSAL);
    saveProseMock.mockResolvedValue(draft);
    return { prose };
  }

  it("the automatic batch takes the legitimately-stale section and leaves the attempted one out", async () => {
    setupWithRefusedSection();

    await proposeProse(VALUATION_ID);

    expect(fetchProposalMock.mock.calls[0]![0].sections).toEqual(["analiza_rynku"]);
  });

  it("...and the attempted section returns to the batch as soon as ITS OWN facts move", async () => {
    // A second price edit: the fingerprint `uzasadnienie` was attempted at no
    // longer describes the draft, so the recorded attempt stops counting and
    // an automatic retry is warranted again. This is the self-clearing the
    // whole design rests on — a flag could not do it.
    const movedAgain: KcsInput = {
      ...INPUTS,
      comparables: INPUTS.comparables.map((c, i) =>
        i === 0 ? { ...c, pricePerM2: c.pricePerM2 + 900 } : c,
      ),
    };
    const prose = confirmedProseFor(ADDRESS, INPUTS);
    prose.attempts = {
      uzasadnienie: currentSectionFactsHash("uzasadnienie", {
        address: ADDRESS,
        inputs: editedInputs(),
      }),
    };
    getMock.mockResolvedValue({ ...draft, inputs: { ...movedAgain, prose } });
    fetchProposalMock.mockResolvedValue(PROPOSAL);
    saveProseMock.mockResolvedValue(draft);

    await proposeProse(VALUATION_ID);

    expect(fetchProposalMock.mock.calls[0]![0].sections.sort()).toEqual([
      "analiza_rynku",
      "uzasadnienie",
    ]);
  });

  it("the appraiser asking (includeAttempted) puts it back without having to name it", async () => {
    // What the step's own "Wygeneruj ponownie N nieaktualnych sekcji" button
    // sends. The server still decides the batch — the browser never re-derives
    // the missing-or-stale rule — but the bound on re-buying is lifted,
    // because a click IS the ask. Without this the button would silently do
    // nothing on exactly the drafts this bound exists for.
    setupWithRefusedSection();

    await proposeProse(VALUATION_ID, { includeAttempted: true });

    expect(fetchProposalMock.mock.calls[0]![0].sections.sort()).toEqual([
      "analiza_rynku",
      "uzasadnienie",
    ]);
  });

  it("opts.sections bypasses the bound entirely — 'redo this one' always works", async () => {
    setupWithRefusedSection();

    await proposeProse(VALUATION_ID, { sections: ["uzasadnienie"] });

    expect(fetchProposalMock.mock.calls[0]![0].sections).toEqual(["uzasadnienie"]);
  });

  it("everything that needs work was already attempted: the worker is never called", async () => {
    // Both stale sections attempted at today's facts. Nothing automatic is
    // left to buy, and the current snapshot comes back rather than an error —
    // the step calls this unconditionally on mount.
    const inputs = editedInputs();
    const prose = confirmedProseFor(ADDRESS, INPUTS);
    prose.attempts = Object.fromEntries(
      (["analiza_rynku", "uzasadnienie"] as ProseSection[]).map((s) => [
        s,
        currentSectionFactsHash(s, { address: ADDRESS, inputs }),
      ]),
    );
    getMock.mockResolvedValue({ ...draft, inputs: { ...inputs, prose } });

    const result = await proposeProse(VALUATION_ID);

    expect(fetchProposalMock).not.toHaveBeenCalled();
    expect(saveProseMock).not.toHaveBeenCalled();
    expect(result).toEqual({ prose });
  });
});
