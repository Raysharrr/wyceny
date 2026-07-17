import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused unit test of `createValuation`. Two groups:
 *
 *  - REJECTION paths: validation runs before any I/O (worker call, storage
 *    write, DB insert), so these cases never touch `_deps` — only the
 *    session lookup needs mocking. (See create-valuation.ts's
 *    authoritative-validation comment and the `invalid_type` → generic
 *    Polish message fix it documents.)
 *  - SUCCESS path (Slice 4): document generation was removed from create —
 *    `worker`/`storage` must NOT be called, and the repo receives the four
 *    new document fields with `amountInWords`/`docUrl`/`docxUrl` all `null`
 *    (documents are generated at approval, not draft creation). `_deps` is
 *    automocked (mirrors get-sample-proposal-action.test.ts's style) so
 *    `valuationRepository.create`/`worker.amountInWords`/`storage.put`
 *    become controllable `vi.fn()`s and no real Postgres/HTTP call ever
 *    leaves the test process. `next/navigation`'s `redirect` is mocked to a
 *    no-op spy — the real one throws (`NEXT_REDIRECT`) to interrupt
 *    rendering, which only makes sense inside an actual Next.js request.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { redirect } from "next/navigation";
import { createValuation, type CreateValuationInput } from "../src/app/actions/create-valuation";
import { storage, valuationRepository, worker } from "@/app/valuations/_deps";
import { EMPTY_SUBJECT } from "../src/lib/subject-form";

const createMock = vi.mocked(valuationRepository.create);
const amountInWordsMock = vi.mocked(worker.amountInWords);
const storagePutMock = vi.mocked(storage.put);
const redirectMock = vi.mocked(redirect);

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
  purpose: "sprzedaz",
  kwNumber: "KW-TEST-1",
  client: "p. Jan Testowy",
  inspectionDate: "2026-07-01",
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

  it("rejects a missing purpose", async () => {
    const withoutPurpose: Record<string, unknown> = { ...valid };
    delete withoutPurpose.purpose;
    const result = await createValuation(withoutPurpose as unknown as CreateValuationInput);
    expect(result).toEqual({ error: "Wybierz cel wyceny." });
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

describe("createValuation — success path (Slice 4: no document generation at draft time)", () => {
  beforeEach(() => {
    createMock.mockReset();
    amountInWordsMock.mockReset();
    storagePutMock.mockReset();
    redirectMock.mockReset();
  });

  it("persists the four document fields, skips worker/storage, and redirects to the new valuation", async () => {
    createMock.mockResolvedValue({
      id: "valuation-test-1",
      address: valid.address,
      area: valid.area,
      wr: 1000000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      docxUrl: null,
      purpose: valid.purpose,
      kwNumber: valid.kwNumber,
      client: valid.client,
      inspectionDate: valid.inspectionDate,
      ownerId: "test-user",
      status: "in_progress",
      approvedAt: null,
      createdAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    await createValuation(valid);

    expect(amountInWordsMock).not.toHaveBeenCalled();
    expect(storagePutMock).not.toHaveBeenCalled();

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: valid.address,
        area: valid.area,
        amountInWords: null,
        docUrl: null,
        docxUrl: null,
        purpose: valid.purpose,
        kwNumber: valid.kwNumber,
        client: valid.client,
        inspectionDate: valid.inspectionDate,
        ownerId: "test-user",
      }),
    );

    expect(redirectMock).toHaveBeenCalledWith("/valuations/valuation-test-1");
  });

  it("persists the subject/subjectMeta snapshot with ewidencja provenance to_verify (Task 6)", async () => {
    createMock.mockResolvedValue({
      id: "valuation-test-2",
      address: valid.address,
      area: valid.area,
      wr: 1000000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      docxUrl: null,
      purpose: valid.purpose,
      kwNumber: valid.kwNumber,
      client: valid.client,
      inspectionDate: valid.inspectionDate,
      ownerId: "test-user",
      status: "in_progress",
      approvedAt: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    });

    const withSubject: CreateValuationInput = {
      ...valid,
      subject: { obreb: "Jeżyce", nrDzialki: "161" },
      subjectMeta: {
        x: 1,
        y: 2,
        teryt: "306401",
        fetchedAt: "2026-07-14T09:00:00.000Z",
        source: "geopoz-gugik",
        mpzpAbsent: false,
      },
    };

    await createValuation(withSubject);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({
          subject: withSubject.subject,
          subjectMeta: withSubject.subjectMeta,
          provenance: expect.objectContaining({
            ewidencja: { source: "ewidencja", status: "to_verify" },
            mpzp: { source: "mpzp", status: "to_verify" },
          }),
        }),
      }),
    );
  });

  it("drops an untouched subject section — no snapshot persisted, no ewidencja/mpzp provenance (Fix A)", async () => {
    createMock.mockResolvedValue({
      id: "valuation-test-3",
      address: valid.address,
      area: valid.area,
      wr: 1000000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      docxUrl: null,
      purpose: valid.purpose,
      kwNumber: valid.kwNumber,
      client: valid.client,
      inspectionDate: valid.inspectionDate,
      ownerId: "test-user",
      status: "in_progress",
      approvedAt: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    });

    // Mirrors what the untouched "Dane przedmiotu" section actually submits —
    // RHF seeds `defaultValues.subject` with `EMPTY_SUBJECT`, no `subjectMeta`.
    // Cast: `EMPTY_SUBJECT` is typed as the schema's pre-coercion input shape
    // (numeric fields are `unknown`), while `CreateValuationInput` expects the
    // post-coercion output shape — both describe the same runtime object.
    const untouched: CreateValuationInput = {
      ...valid,
      subject: { ...EMPTY_SUBJECT } as CreateValuationInput["subject"],
    };

    await createValuation(untouched);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({ subject: null, subjectMeta: null }),
      }),
    );
    const call = createMock.mock.calls[0][0] as { inputs: { provenance: Record<string, unknown> } };
    expect(call.inputs.provenance).not.toHaveProperty("ewidencja");
    expect(call.inputs.provenance).not.toHaveProperty("mpzp");
  });

  it("persists a subject with only rokBudowy set — a single non-empty field is enough (Fix A)", async () => {
    createMock.mockResolvedValue({
      id: "valuation-test-4",
      address: valid.address,
      area: valid.area,
      wr: 1000000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      docxUrl: null,
      purpose: valid.purpose,
      kwNumber: valid.kwNumber,
      client: valid.client,
      inspectionDate: valid.inspectionDate,
      ownerId: "test-user",
      status: "in_progress",
      approvedAt: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    });

    const rokBudowyOnly: CreateValuationInput = {
      ...valid,
      subject: { ...EMPTY_SUBJECT, rokBudowy: 1938 } as CreateValuationInput["subject"],
    };

    await createValuation(rokBudowyOnly);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({
          subject: expect.objectContaining({ rokBudowy: 1938 }),
        }),
      }),
    );
  });

  it("persists a subject with only mpzpAbsent: true set — a lone true flag is non-empty (Fix A)", async () => {
    createMock.mockResolvedValue({
      id: "valuation-test-5",
      address: valid.address,
      area: valid.area,
      wr: 1000000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      docxUrl: null,
      purpose: valid.purpose,
      kwNumber: valid.kwNumber,
      client: valid.client,
      inspectionDate: valid.inspectionDate,
      ownerId: "test-user",
      status: "in_progress",
      approvedAt: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    });

    const mpzpAbsentOnly: CreateValuationInput = {
      ...valid,
      subject: { ...EMPTY_SUBJECT, mpzpAbsent: true } as CreateValuationInput["subject"],
    };

    await createValuation(mpzpAbsentOnly);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({
          subject: expect.objectContaining({ mpzpAbsent: true }),
        }),
      }),
    );
  });
});
