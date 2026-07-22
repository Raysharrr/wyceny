import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";

/**
 * Focused unit test of `approveValuation`'s status guard (final review,
 * Important #1): re-invoking approve on an already-approved valuation must
 * fail fast with a Polish error BEFORE any regeneration work — otherwise the
 * action would overwrite the stored operat files (mutating a frozen
 * artifact) and only then hit `assertDraft` inside `repo.approve`.
 *
 * Slice 9 (Task 6) extends this with the maps fetch+freeze behaviour: happy
 * path (2 embedded media), maps-unavailable fallback (no writes, draft
 * stays), and the user's conscious skipMaps (audited, honest stub).
 *
 * `_deps` is automocked (mirrors create-valuation-action.test.ts) so
 * `valuationRepository.get/approve`/`worker.amountInWords/convertToPdf`/
 * `storage.put`/`mapImages.fetchMaps` become controllable `vi.fn()`s and no
 * real Postgres/HTTP call ever leaves the test process. `mapImages` is typed
 * `PortMapImages | null`, but MAPS_FETCH is unset in the unit-test env (only
 * the e2e CI job sets it to "off"), so the automocked module resolves it to
 * a real (non-null) adapter object whose `fetchMaps` method gets auto-mocked
 * — hence the non-null assertion below. `@/auth/session` is mocked like
 * docs-route.test.ts does; `next/cache`/`next/navigation` are mocked because
 * their real implementations only work inside an actual Next.js request.
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
import { storage, valuationRepository, worker, mapImages } from "@/app/valuations/_deps";
import { StorageNotFoundError } from "@/ports/storage";
import { InputsChangedError } from "@/domain/valuation";

const getMock = vi.mocked(valuationRepository.get);
const approveMock = vi.mocked(valuationRepository.approve);
const amountInWordsMock = vi.mocked(worker.amountInWords);
const convertToPdfMock = vi.mocked(worker.convertToPdf);
const storagePutMock = vi.mocked(storage.put);
const storageDeleteMock = vi.mocked(storage.delete);
const storageGetMock = vi.mocked(storage.get);
const fetchMapsMock = vi.mocked(mapImages!.fetchMaps);

// Synthetic 1x1 images (F-9: no real map data in fixtures) — same fixture
// bytes as docx-render-maps.test.ts.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
  "base64",
);

const generatedMedia = (buf: Buffer) =>
  Object.keys(new PizZip(buf).files).filter((f) => /^word\/media\/image_generated_/.test(f));

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

describe("approveValuation — maps fetch + freeze (Slice 9, Task 6)", () => {
  beforeEach(() => {
    getMock.mockReset();
    approveMock.mockReset();
    amountInWordsMock.mockReset();
    convertToPdfMock.mockReset();
    storagePutMock.mockReset();
    storageDeleteMock.mockReset();
    fetchMapsMock.mockReset();
  });

  // A gate-passing, document-field-complete draft — approvableInput() already
  // clears the F-4 gate + document-field blockers (fixtures/valuation-inputs.ts).
  const draft: Valuation = {
    id: "valuation-draft-1",
    address: "ul. Kościelna 33A, Poznań",
    area: 71.63,
    wr: 1_044_400,
    inputs: approvableInput("test-user").inputs,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: "sprzedaz",
    kwNumber: "PO1P/1/6",
    client: "Jan Testowy",
    inspectionDate: "2026-07-10",
    ownerId: "test-user",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  const setUpHappyMocks = () => {
    amountInWordsMock.mockResolvedValue("milion czterdzieści cztery tysiące czterysta złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    approveMock.mockResolvedValue({ ...draft, status: "approved" });
  };

  it("fetches + freezes maps, storing the two frozen keys and embedding exactly 2 media", async () => {
    getMock.mockResolvedValue(draft);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    setUpHappyMocks();

    const result = await approveValuation(draft.id);

    expect(result).toBeUndefined();
    expect(fetchMapsMock).toHaveBeenCalledWith(draft.address);
    expect(storagePutMock).toHaveBeenCalledWith(`mapa-ewidencyjna-${draft.id}.png`, PNG_1PX);
    expect(storagePutMock).toHaveBeenCalledWith(`mapa-orto-${draft.id}.jpg`, JPG_1PX);
    // Maps were fetched fresh and frozen this call — nothing orphaned to
    // clean up (final review, Important #1).
    expect(storageDeleteMock).not.toHaveBeenCalled();

    const docxCall = storagePutMock.mock.calls.find(([key]) => key === `operat-${draft.id}.docx`);
    const docxBytes = docxCall?.[1] as Buffer;
    expect(generatedMedia(docxBytes)).toHaveLength(2);
  });

  it("returns mapsUnavailable + Polish error BEFORE any writes; valuation stays draft", async () => {
    getMock.mockResolvedValue(draft);
    fetchMapsMock.mockResolvedValue({ kind: "unavailable", message: "Geoportal padł" });

    const result = await approveValuation(draft.id);

    expect(result).toEqual({
      error: expect.stringContaining("Geoportal padł"),
      mapsUnavailable: true,
    });
    expect(approveMock).not.toHaveBeenCalled();
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  it("skipMaps: approves without fetching maps, audits mapsSkipped, renders the honest stub", async () => {
    getMock.mockResolvedValue(draft);
    // Same failing mock as the unavailable case — proves fetchMaps is never called.
    fetchMapsMock.mockResolvedValue({ kind: "unavailable", message: "Geoportal padł" });
    setUpHappyMocks();

    const result = await approveValuation(draft.id, { skipMaps: true });

    expect(result).toBeUndefined();
    expect(fetchMapsMock).not.toHaveBeenCalled();
    expect(approveMock).toHaveBeenCalledWith(
      draft.id,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mapsSkipped: true },
      draft.inputs,
    );
    const mapaCalls = storagePutMock.mock.calls.filter(([key]) => key.startsWith("mapa-"));
    expect(mapaCalls).toHaveLength(0);
    // skipMaps proceeds with maps === null — any orphaned frozen map keys
    // from a prior failed approve attempt must be cleaned up so a later sign
    // can't find and embed maps this approved document doesn't have (final
    // review, Important #1).
    expect(storageDeleteMock).toHaveBeenCalledWith(`mapa-ewidencyjna-${draft.id}.png`);
    expect(storageDeleteMock).toHaveBeenCalledWith(`mapa-orto-${draft.id}.jpg`);

    const docxCall = storagePutMock.mock.calls.find(([key]) => key === `operat-${draft.id}.docx`);
    const docxBytes = docxCall?.[1] as Buffer;
    const text = new PizZip(docxBytes).file("word/document.xml")!.asText();
    expect(text).toContain("Dokumentacja kartograficzna zostanie uzupełniona.");
  });
});

describe("approveValuation — inspection photos (Slice 10, Task 8)", () => {
  beforeEach(() => {
    getMock.mockReset();
    approveMock.mockReset();
    amountInWordsMock.mockReset();
    convertToPdfMock.mockReset();
    storagePutMock.mockReset();
    storageDeleteMock.mockReset();
    storageGetMock.mockReset();
    fetchMapsMock.mockReset();
  });

  // Manifest with 2 keys spread across 2 of the 3 sections — enough to prove
  // storage.get is called for exactly the manifest keys (not more, not
  // fewer) without the noise of a full 3-section fixture.
  const photoKeys = {
    otoczenie: "ogledziny-otoczenie-p1-valuation-draft-photos-1.jpg",
    budynekZewn: "ogledziny-budynek-p2-valuation-draft-photos-1.jpg",
  };

  const draftWithPhotos: Valuation = {
    id: "valuation-draft-photos-1",
    address: "ul. Fotograficzna 5, Poznań",
    area: 60,
    wr: 900_000,
    inputs: {
      ...approvableInput("test-user").inputs!,
      inspection: {
        note: null,
        photos: {
          otoczenie: [photoKeys.otoczenie],
          budynekZewn: [photoKeys.budynekZewn],
          wnetrza: [],
        },
      },
    },
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: "sprzedaz",
    kwNumber: "PO1P/1/6",
    client: "Jan Testowy",
    inspectionDate: "2026-07-10",
    ownerId: "test-user",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  const setUpHappyMocksWithMaps = () => {
    amountInWordsMock.mockResolvedValue("dziewięćset tysięcy złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    approveMock.mockResolvedValue({ ...draftWithPhotos, status: "approved" });
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
  };

  it("reads exactly the manifest keys via storage.get and embeds maps+photos media", async () => {
    getMock.mockResolvedValue(draftWithPhotos);
    setUpHappyMocksWithMaps();
    storageGetMock.mockImplementation((key: string) =>
      key === photoKeys.otoczenie || key === photoKeys.budynekZewn
        ? Promise.resolve(JPG_1PX)
        : Promise.reject(new Error(`unexpected storage.get(${key})`)),
    );

    const result = await approveValuation(draftWithPhotos.id);

    expect(result).toBeUndefined();
    expect(storageGetMock).toHaveBeenCalledTimes(2);
    expect(storageGetMock).toHaveBeenCalledWith(photoKeys.otoczenie);
    expect(storageGetMock).toHaveBeenCalledWith(photoKeys.budynekZewn);

    const docxCall = storagePutMock.mock.calls.find(
      ([key]) => key === `operat-${draftWithPhotos.id}.docx`,
    );
    const docxBytes = docxCall?.[1] as Buffer;
    expect(generatedMedia(docxBytes)).toHaveLength(2 + 2); // 2 maps + 2 photos
  });

  it("aborts BEFORE repo.approve when a manifest photo key fails to resolve", async () => {
    getMock.mockResolvedValue(draftWithPhotos);
    setUpHappyMocksWithMaps();
    storageGetMock.mockImplementation((key: string) =>
      key === photoKeys.otoczenie
        ? Promise.resolve(JPG_1PX)
        : Promise.reject(new StorageNotFoundError(`missing: ${key}`)),
    );

    const result = await approveValuation(draftWithPhotos.id);

    expect(result).toEqual({
      error: "Nie udało się odczytać zdjęć z oględzin — odśwież stronę i spróbuj ponownie.",
    });
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("aborts (not a crash) when storage.get resolves undefined for a manifest key (fake/buggy storage)", async () => {
    getMock.mockResolvedValue(draftWithPhotos);
    setUpHappyMocksWithMaps();
    storageGetMock.mockImplementation((key: string) =>
      key === photoKeys.otoczenie
        ? Promise.resolve(JPG_1PX)
        : (Promise.resolve(undefined) as unknown as Promise<Buffer>),
    );

    const result = await approveValuation(draftWithPhotos.id);

    expect(result).toEqual({
      error: "Nie udało się odczytać zdjęć z oględzin — odśwież stronę i spróbuj ponownie.",
    });
    expect(approveMock).not.toHaveBeenCalled();
  });
});

describe("approveValuation — InputsChangedError (approve-window drift guard, final review)", () => {
  const draftForDriftTest: Valuation = {
    id: "valuation-drift-1",
    address: "ul. Dryfująca 1, Poznań",
    area: 71.63,
    wr: 1_044_400,
    inputs: approvableInput("test-user").inputs,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: "sprzedaz",
    kwNumber: "PO1P/1/6",
    client: "Jan Testowy",
    inspectionDate: "2026-07-10",
    ownerId: "test-user",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    getMock.mockReset();
    approveMock.mockReset();
    amountInWordsMock.mockReset();
    convertToPdfMock.mockReset();
    storagePutMock.mockReset();
    storageDeleteMock.mockReset();
    fetchMapsMock.mockReset();
  });

  it("returns the Polish drift message when repo.approve rejects with InputsChangedError, no crash", async () => {
    getMock.mockResolvedValue(draftForDriftTest);
    amountInWordsMock.mockResolvedValue("milion czterdzieści cztery tysiące czterysta złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    approveMock.mockRejectedValue(new InputsChangedError(draftForDriftTest.id));

    const result = await approveValuation(draftForDriftTest.id);

    expect(result).toEqual({
      error:
        "Dane wyceny zmieniły się w trakcie zatwierdzania — odśwież stronę i spróbuj ponownie.",
    });
  });
});
