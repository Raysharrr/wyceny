import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TDD for the wizard Server Actions (Task 5, Slice 11a) — the "use server"
 * layer between the RHF wizard UI (Task 6) and the repo mutations from
 * Task 4. Mock pattern: `_deps` automocked like tests/inspection-actions.test.ts
 * (storage/valuationRepository become controllable `vi.fn()`s — no real
 * Postgres call ever leaves the test process). `getSession` is hoisted
 * (docs-route.test.ts pattern) instead of a fixed always-authenticated stub,
 * because every action's "no session" branch needs per-test control here.
 * `redirect` is mocked to THROW (like the real next/navigation implementation
 * does) rather than a no-op — createDraft's happy path relies on the throw
 * propagating (its return type is `never` on success), and the "no session"
 * cases need control flow to actually stop at the guard instead of falling
 * through to a null `session.user` dereference. The vitest config has no
 * clearMocks/restoreMocks, so every test resets the mocks it uses in
 * `beforeEach` itself.
 */
const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/auth/session", () => ({ getSession: getSessionMock }));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import {
  createDraft,
  saveSubjectAction,
  saveSampleAction,
  saveFeaturesAction,
  confirmCalculationAction,
} from "../src/app/actions/wizard";
import type {
  Step1Input,
  SampleStepInput,
  FeaturesStepInput,
} from "../src/app/actions/wizard-schemas";
import { saveInspectionDate } from "../src/app/actions/inspection";
import { valuationRepository } from "@/app/valuations/_deps";
import { CalculationNotReadyError } from "@/domain/valuation";
import { normalizeKw } from "@/domain/kw-snapshot";
import type { Valuation } from "@/ports/valuation";
import type { KwSnapshot } from "@/domain/kw-snapshot";

const createMock = vi.mocked(valuationRepository.create);
const getMock = vi.mocked(valuationRepository.get);
const saveSubjectMock = vi.mocked(valuationRepository.saveSubject);
const saveSampleMock = vi.mocked(valuationRepository.saveSample);
const saveFeaturesMock = vi.mocked(valuationRepository.saveFeatures);
const confirmCalculationMock = vi.mocked(valuationRepository.confirmCalculation);
const updateInspectionMock = vi.mocked(valuationRepository.updateInspection);

const VALUATION_ID = "vid";
const SESSION_USER = { id: "test-user", role: "appraiser" as const };

const draftValuation: Valuation = {
  id: VALUATION_ID,
  address: "ul. Testowa 1, Poznań",
  area: 50,
  wr: null,
  inputs: null,
  amountInWords: null,
  docUrl: null,
  docxUrl: null,
  purpose: "sprzedaz",
  kwNumber: null,
  client: null,
  inspectionDate: null,
  ownerId: SESSION_USER.id,
  status: "in_progress",
  approvedAt: null,
  signedAt: null,
  supersedesId: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};

const validStep1Input: Step1Input = {
  address: "ul. Testowa 1, Poznań",
  area: 50,
  purpose: "sprzedaz",
  kwNumber: "PO1P/1/1",
  client: "Jan Kowalski",
};

beforeEach(() => {
  createMock.mockReset();
  getMock.mockReset();
  saveSubjectMock.mockReset();
  saveSampleMock.mockReset();
  saveFeaturesMock.mockReset();
  confirmCalculationMock.mockReset();
  updateInspectionMock.mockReset();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ user: SESSION_USER });
});

describe("createDraft", () => {
  it("valid step-1 payload -> repository.create gets wr:null, empty comparables/features, provenance without weights/ratings; redirect throws", async () => {
    createMock.mockResolvedValueOnce({ ...draftValuation, id: "draft-1" });

    await expect(createDraft(validStep1Input)).rejects.toThrow(
      "REDIRECT:/valuations/draft-1?step=2",
    );

    expect(createMock).toHaveBeenCalledWith({
      address: "ul. Testowa 1, Poznań",
      area: 50,
      wr: null,
      inputs: {
        area: 50,
        comparables: [],
        features: [],
        sampleMeta: null,
        subject: null,
        subjectMeta: null,
        kw: null,
        kwMeta: null,
        provenance: {
          address: { source: "rzeczoznawca", status: "confirmed" },
          area: { source: "rzeczoznawca", status: "confirmed" },
        },
      },
      amountInWords: null,
      docUrl: null,
      purpose: "sprzedaz",
      kwNumber: "PO1P/1/1",
      client: "Jan Kowalski",
      inspectionDate: null,
      ownerId: SESSION_USER.id,
    });
  });

  it("invalid payload (empty client) -> Polish error, no repo call", async () => {
    const result = await createDraft({ ...validStep1Input, client: "" });

    expect(result).toEqual({ error: "Podaj zamawiającego wycenę." });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("kwNumber required when no kw extract attached (superRefine) -> Polish error", async () => {
    const result = await createDraft({ ...validStep1Input, kwNumber: "" });

    expect(result).toEqual({ error: "Podaj numer księgi wieczystej." });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("no session -> redirect('/login'), no repo call", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(createDraft(validStep1Input)).rejects.toThrow("REDIRECT:/login");
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("saveSubjectAction", () => {
  const rawKw: KwSnapshot = {
    source: "akt",
    kwLokalu: "  PO1P/1/1  ",
    kwGruntu: null,
    kwInne: ["  ", "PO1P/2/2 "],
    deweloperski: false,
    powUzytkowaKw: null,
    udzial: "  1/2  ",
    sad: "  Sąd Rejonowy  ",
    wydzial: "  V Wydział  ",
    dataDokumentu: "  2024-01-01  ",
    dzial3: null,
    dzial4: null,
  };

  it("calls repo.saveSubject with normalized kw and a subject provenance fragment", async () => {
    saveSubjectMock.mockResolvedValueOnce(draftValuation);

    const result = await saveSubjectAction(VALUATION_ID, {
      ...validStep1Input,
      kwNumber: undefined,
      kw: rawKw,
    });

    expect(result).toEqual({ ok: true });
    expect(saveSubjectMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      address: "ul. Testowa 1, Poznań",
      area: 50,
      purpose: "sprzedaz",
      kwNumber: normalizeKw(rawKw).kwLokalu,
      client: "Jan Kowalski",
      subject: null,
      subjectMeta: null,
      kw: normalizeKw(rawKw),
      kwMeta: null,
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        area: { source: "rzeczoznawca", status: "confirmed" },
        kw: { source: "akt", status: "to_verify" },
      },
    });
  });

  it("repo returns null (not owner / not draft) -> error", async () => {
    saveSubjectMock.mockResolvedValueOnce(null);

    const result = await saveSubjectAction(VALUATION_ID, validStep1Input);

    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
  });

  it("no session -> redirect('/login')", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(saveSubjectAction(VALUATION_ID, validStep1Input)).rejects.toThrow(
      "REDIRECT:/login",
    );
    expect(saveSubjectMock).not.toHaveBeenCalled();
  });
});

describe("saveSampleAction", () => {
  const sampleInput: SampleStepInput = {
    comparables: [
      { pricePerM2: 9000, area: 40, date: "2024-01", source: "manual" },
      { pricePerM2: 9500, area: 45, date: "2024-02", source: "manual" },
      { pricePerM2: 10500, area: 50, date: "2024-03", source: "rcn", transactionId: "t1" },
    ],
  };

  it("comparables pass through unchanged after assignSampleProvenance (no % conversion — that's a features-step concern)", async () => {
    saveSampleMock.mockResolvedValueOnce(draftValuation);

    const result = await saveSampleAction(VALUATION_ID, sampleInput);

    expect(result).toEqual({ ok: true });
    expect(saveSampleMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      comparables: [
        { pricePerM2: 9000, area: 40, date: "2024-01", source: "manual", status: "confirmed" },
        { pricePerM2: 9500, area: 45, date: "2024-02", source: "manual", status: "confirmed" },
        {
          pricePerM2: 10500,
          area: 50,
          date: "2024-03",
          source: "rcn",
          transactionId: "t1",
          status: "to_verify",
        },
      ],
      sampleMeta: null,
    });
  });

  it("repo returns null -> error", async () => {
    saveSampleMock.mockResolvedValueOnce(null);

    const result = await saveSampleAction(VALUATION_ID, sampleInput);

    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
  });

  it("no session -> redirect('/login')", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(saveSampleAction(VALUATION_ID, sampleInput)).rejects.toThrow("REDIRECT:/login");
    expect(saveSampleMock).not.toHaveBeenCalled();
  });
});

describe("saveFeaturesAction", () => {
  const featuresInput: FeaturesStepInput = {
    features: [
      {
        key: "standard-wykonczenia",
        name: "standard wykończenia",
        weightPct: 50,
        rating: "przecietna",
        definitions: { lepsza: "b", przecietna: "  a   b  ", gorsza: "c" },
      },
      { key: "lokalizacja", name: "lokalizacja", weightPct: 50, rating: "lepsza" },
    ],
  };

  it("converts weightPct/100 to weight, normalizes definitions, and computes the provenance fragment from the EXISTING comparables on the draft (repo.get)", async () => {
    getMock.mockResolvedValueOnce({
      ...draftValuation,
      inputs: {
        area: 50,
        comparables: [
          { pricePerM2: 9000, area: 40, source: "manual", status: "confirmed" },
          { pricePerM2: 9500, area: 60, source: "manual", status: "confirmed" },
        ],
        features: [],
        sampleMeta: null,
        subject: null,
        subjectMeta: null,
        kw: null,
        kwMeta: null,
        provenance: null,
      },
    });
    saveFeaturesMock.mockResolvedValueOnce(draftValuation);

    const result = await saveFeaturesAction(VALUATION_ID, featuresInput);

    expect(result).toEqual({ ok: true });
    expect(getMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER);
    expect(saveFeaturesMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      features: [
        {
          name: "standard wykończenia",
          weight: 0.5,
          rating: "przecietna",
          key: "standard-wykonczenia",
          definitions: { lepsza: "b", przecietna: "a b", gorsza: "c" },
        },
        {
          name: "lokalizacja",
          weight: 0.5,
          rating: "lepsza",
          key: "lokalizacja",
          definitions: {},
        },
      ],
      provenance: {
        weights: { source: "rzeczoznawca", status: "confirmed" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
        featureDefs: { source: "rzeczoznawca", status: "confirmed" },
      },
    });
  });

  it("draft not found (repo.get -> null) -> error, saveFeatures never called", async () => {
    getMock.mockResolvedValueOnce(null);

    const result = await saveFeaturesAction(VALUATION_ID, featuresInput);

    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
    expect(saveFeaturesMock).not.toHaveBeenCalled();
  });

  it("no session -> redirect('/login')", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(saveFeaturesAction(VALUATION_ID, featuresInput)).rejects.toThrow(
      "REDIRECT:/login",
    );
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe("confirmCalculationAction", () => {
  it("CalculationNotReadyError -> Polish gate error", async () => {
    confirmCalculationMock.mockRejectedValueOnce(new CalculationNotReadyError());

    const result = await confirmCalculationAction(VALUATION_ID);

    expect(result).toEqual({ error: "Uzupełnij próbę (krok 3) i cechy (krok 4)." });
  });

  it("happy path -> ok:true", async () => {
    confirmCalculationMock.mockResolvedValueOnce({ ...draftValuation, wr: 500_000 });

    const result = await confirmCalculationAction(VALUATION_ID);

    expect(result).toEqual({ ok: true });
  });

  it("repo returns null -> error", async () => {
    confirmCalculationMock.mockResolvedValueOnce(null);

    const result = await confirmCalculationAction(VALUATION_ID);

    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
  });

  it("no session -> redirect('/login')", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(confirmCalculationAction(VALUATION_ID)).rejects.toThrow("REDIRECT:/login");
    expect(confirmCalculationMock).not.toHaveBeenCalled();
  });
});

describe("saveInspectionDate", () => {
  // NOTE: the spec's validation `/^\d{4}-\d{2}-\d{2}$/.test(date) || date === ""`
  // checks format only, not calendar validity (same convention as
  // subjectSchema.mpzpData) — "2026-13-99" is syntactically well-formed
  // (4-2-2 digit groups) and therefore accepted by this regex. Swapped the
  // brief's calendar-invalid example for a format-invalid one (missing
  // leading zeros) so this case actually exercises the reject path; flagged
  // in the task report for the team lead.
  it.each(["2026-7-1", "abc"])(
    "invalid date format %s -> Polish error, repo not called",
    async (date) => {
      const result = await saveInspectionDate(VALUATION_ID, date);

      expect(result).toEqual({ error: "Podaj datę w formacie RRRR-MM-DD." });
      expect(updateInspectionMock).not.toHaveBeenCalled();
    },
  );

  it("known limitation: format-only validation accepts a calendar-invalid date shaped like RRRR-MM-DD (e.g. month 13) — documented, not a bug fix target here", async () => {
    updateInspectionMock.mockResolvedValueOnce(draftValuation);

    const result = await saveInspectionDate(VALUATION_ID, "2026-13-99");

    expect(result).toBeUndefined();
    expect(updateInspectionMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      kind: "set_date",
      date: "2026-13-99",
    });
  });

  it("valid date -> updateInspection with set_date op", async () => {
    updateInspectionMock.mockResolvedValueOnce(draftValuation);

    const result = await saveInspectionDate(VALUATION_ID, "2026-07-01");

    expect(result).toBeUndefined();
    expect(updateInspectionMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      kind: "set_date",
      date: "2026-07-01",
    });
  });

  it("empty string -> valid (clears the date), passes through to updateInspection", async () => {
    updateInspectionMock.mockResolvedValueOnce(draftValuation);

    const result = await saveInspectionDate(VALUATION_ID, "");

    expect(result).toBeUndefined();
    expect(updateInspectionMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      kind: "set_date",
      date: "",
    });
  });

  it("repo returns null -> error", async () => {
    updateInspectionMock.mockResolvedValueOnce(null);

    const result = await saveInspectionDate(VALUATION_ID, "2026-07-01");

    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
  });

  it("no session -> redirect('/login')", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(saveInspectionDate(VALUATION_ID, "2026-07-01")).rejects.toThrow("REDIRECT:/login");
    expect(updateInspectionMock).not.toHaveBeenCalled();
  });
});
