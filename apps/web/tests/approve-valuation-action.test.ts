import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import type { Valuation } from "../src/ports/valuation";
import type { ProseSnapshot } from "../src/domain/prose-snapshot";
import { approvableInput, confirmedProse, confirmedProseFor } from "./fixtures/valuation-inputs";

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
import { ApprovalBlockedError, InputsChangedError } from "@/domain/valuation";

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
  mapsFrozenFor: null,
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
    inputs: {
      ...approvableInput("test-user").inputs!,
      prose: confirmedProseFor("ul. Kościelna 33A, Poznań", approvableInput("test-user").inputs!),
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
    mapsFrozenFor: null,
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
      // FR-6: the app layer's kill-switch answer travels into the transaction
      // so the in-tx gate (ADR-012) applies the same rule as the fail-fast one.
      { requireProse: true },
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
      prose: confirmedProseFor(
        "ul. Fotograficzna 5, Poznań",
        // The manifest is not part of the prose facts, so the base inputs
        // give the same fingerprint as the draft below.
        approvableInput("test-user").inputs!,
      ),
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
    mapsFrozenFor: null,
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

/**
 * Prose gate (FR-6, Task 7). The UI cannot produce any of these states — the
 * step-6 submit stamps every non-blank field `rzeczoznawca`/`confirmed` — so
 * each one is a payload that skipped the UI and called the Server Action
 * directly. Same class as `assign-provenance.test.ts`'s "tampering is
 * ignored": a client-claimed status buys nothing.
 */
describe("approveValuation — prose gate + tampering (FR-6, Task 7)", () => {
  const draftBase: Valuation = {
    id: "valuation-prose-1",
    address: "ul. Opisowa 7, Poznań",
    area: 55,
    wr: 700_000,
    inputs: {
      ...approvableInput("test-user").inputs!,
      prose: confirmedProseFor("ul. Opisowa 7, Poznań", approvableInput("test-user").inputs!),
    },
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "Jan Testowy",
    inspectionDate: "2026-07-10",
    ownerId: "test-user",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    mapsFrozenFor: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  const withProse = (prose: ProseSnapshot | null): Valuation => ({
    ...draftBase,
    inputs: { ...draftBase.inputs!, prose },
  });

  /** Prose that describes THIS draft — the only kind that clears the gate. */
  const currentProse = () =>
    confirmedProseFor(draftBase.address, approvableInput("test-user").inputs!);

  beforeEach(() => {
    getMock.mockReset();
    approveMock.mockReset();
    amountInWordsMock.mockReset();
    convertToPdfMock.mockReset();
    storagePutMock.mockReset();
    storageDeleteMock.mockReset();
    fetchMapsMock.mockReset();
    amountInWordsMock.mockResolvedValue("siedemset tysięcy złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    approveMock.mockResolvedValue({ ...draftBase, status: "approved" });
  });

  it("approves a draft whose six sections the appraiser accepted", async () => {
    getMock.mockResolvedValue(draftBase);

    expect(await approveValuation(draftBase.id)).toBeUndefined();
    expect(approveMock).toHaveBeenCalled();
  });

  it("refuses a draft that never reached step 6 — no document is generated", async () => {
    getMock.mockResolvedValue(withProse(null));

    const result = await approveValuation(draftBase.id);

    expect(result!.error).toBe(
      "Zatwierdzenie zablokowane — Opisy sekcji nie zostały wygenerowane.",
    );
    expect(result!.blockers!.map((b) => b.path)).toEqual(["prose"]);
    expect(approveMock).not.toHaveBeenCalled();
    expect(storagePutMock).not.toHaveBeenCalled();
    expect(convertToPdfMock).not.toHaveBeenCalled();
  });

  it("refuses a payload that kept the automat's text and skipped the appraiser (tampering)", async () => {
    const prose = currentProse();
    prose.sections.analiza_rynku = {
      value: "Propozycja automatu, nigdy nieprzeczytana — dane testowe.",
      provenance: { source: "ai", status: "to_verify" },
    };
    getMock.mockResolvedValue(withProse(prose));

    const result = await approveValuation(draftBase.id);

    expect(result!.error).toBe(
      "Zatwierdzenie zablokowane — Analiza i charakterystyka rynku — do weryfikacji.",
    );
    expect(result!.blockers!.map((b) => b.path)).toEqual(["prose.analiza_rynku"]);
    expect(approveMock).not.toHaveBeenCalled();
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  it("refuses a payload that self-declares confirmed over an empty text (tampering)", async () => {
    const prose = currentProse();
    prose.sections.uzasadnienie = {
      value: "",
      provenance: { source: "rzeczoznawca", status: "confirmed" },
    };
    getMock.mockResolvedValue(withProse(prose));

    const result = await approveValuation(draftBase.id);

    expect(result!.error).toBe(
      "Zatwierdzenie zablokowane — Uzasadnienie wyniku — pozycja na tle próby — brak tekstu.",
    );
    expect(result!.blockers!.map((b) => b.path)).toEqual(["prose.uzasadnienie"]);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("refuses the SECTION that describes a superseded sample, naming only it (T4)", async () => {
    // The appraiser confirmed six sections, then went back and edited the
    // sample. Nothing about the snapshot's provenance changed — only the
    // facts underneath it did, which is exactly what the stored fingerprint
    // stops matching. The refusal has to name the section whose facts moved,
    // not the whole block: five of these six still describe the draft in
    // front of the appraiser, and sending them back to re-read all six turns
    // the check into a ritual.
    const prose = currentProse();
    prose.factsHashes.uzasadnienie = "f".repeat(64);
    getMock.mockResolvedValue(withProse(prose));

    const result = await approveValuation(draftBase.id);

    expect(result!.error).toBe(
      "Zatwierdzenie zablokowane — Uzasadnienie wyniku — pozycja na tle próby — dane się zmieniły, przejrzyj ponownie.",
    );
    expect(result!.blockers!.map((b) => b.path)).toEqual(["prose.uzasadnienie"]);
    expect(approveMock).not.toHaveBeenCalled();
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  it("refuses a pre-fingerprint snapshot, naming ALL six stale sections (the migration path)", async () => {
    // A draft persisted before per-section fingerprints existed: the adapter
    // normalizes it to an empty map on read, so all six read stale and the
    // appraiser makes one pass through step 6. `confirmedProse()` carries a
    // fingerprint from some earlier state of the draft, which is the same
    // thing from the gate's point of view.
    //
    // The summary line still names the first (unchanged since T4), but the
    // result now carries every blocker — see the T8 block below for why.
    getMock.mockResolvedValue(withProse(confirmedProse()));

    const result = await approveValuation(draftBase.id);

    expect(result!.error).toBe(
      "Zatwierdzenie zablokowane — Analiza i charakterystyka rynku — dane się zmieniły, przejrzyj ponownie.",
    );
    expect(result!.blockers!.map((b) => b.path)).toEqual([
      "prose.analiza_rynku",
      "prose.opis_lokalu",
      "prose.otoczenie",
      "prose.zagospodarowanie",
      "prose.standard",
      "prose.uzasadnienie",
    ]);
    expect(approveMock).not.toHaveBeenCalled();
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  /**
   * T8 (carried from the Task 4 review): the refusal used to surface
   * `blockers[0].label` and nothing else. That was tolerable while the message
   * was one global sentence; now that step 7 renders a link per blocker, a
   * draft with problems on three different steps would otherwise be fixed one
   * round trip at a time — clear one, retry, discover the next.
   *
   * The `error` string is deliberately unchanged: it is the one-line summary,
   * and six assertions in this file and one in the action bar's tests pin it.
   */
  it("carries EVERY blocker, across groups, not just the one the summary names", async () => {
    const prose = currentProse();
    prose.sections.standard = {
      value: "Propozycja automatu — dane testowe.",
      provenance: { source: "ai", status: "to_verify" },
    };
    getMock.mockResolvedValue({
      ...withProse(prose),
      // Two more problems, on two other steps: an unconfirmed geocoding
      // (step 1) and a missing inspection date (step 2).
      inspectionDate: null,
      inputs: {
        ...withProse(prose).inputs!,
        provenance: {
          ...withProse(prose).inputs!.provenance!,
          geocode: { source: "geokoder", status: "to_verify" },
        },
      },
    });

    const result = await approveValuation(draftBase.id);

    expect(result!.blockers!.map((b) => b.path)).toEqual([
      "provenance.geocode",
      "prose.standard",
      "inspectionDate",
    ]);
    expect(result!.error).toBe("Zatwierdzenie zablokowane — Geokodowanie adresu — do weryfikacji.");
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("hands the SAME requirement to the repo, so the in-transaction gate sees it too", async () => {
    getMock.mockResolvedValue(draftBase);

    await approveValuation(draftBase.id);

    expect(approveMock).toHaveBeenCalledWith(
      draftBase.id,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      draftBase.inputs,
      { requireProse: true },
    );
  });

  it("NEXT_PUBLIC_PROSE=off: the kill switch removes the requirement entirely (CI smoke)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PROSE", "off");
    getMock.mockResolvedValue(withProse(null));

    expect(await approveValuation(draftBase.id)).toBeUndefined();
    expect(approveMock).toHaveBeenCalledWith(
      draftBase.id,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      expect.anything(),
      { requireProse: false },
    );
    vi.unstubAllEnvs();
  });
});

describe("approveValuation — InputsChangedError (approve-window drift guard, final review)", () => {
  const draftForDriftTest: Valuation = {
    id: "valuation-drift-1",
    address: "ul. Dryfująca 1, Poznań",
    area: 71.63,
    wr: 1_044_400,
    inputs: {
      ...approvableInput("test-user").inputs!,
      prose: confirmedProseFor("ul. Dryfująca 1, Poznań", approvableInput("test-user").inputs!),
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
    mapsFrozenFor: null,
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

  /**
   * The SECOND refusal site (T8 fix round 1). The gate runs twice: once here
   * before generation, and again inside `repo.approve`'s write transaction
   * (ADR-012) — where it can refuse a draft this action read as clean, because
   * the owner edited it in the seconds the operat took to render.
   *
   * That path was the one the T8 review found unpinned: deleting
   * `blockers: error.blockers` from the catch left the whole suite green,
   * because every other prose/gate test refuses at the FIRST site. Then the
   * appraiser hitting the race would get a plain sentence and no links, from a
   * screen whose whole job since T8 is to link back — the one moment the draft
   * really did change under them.
   *
   * `getMock` returns a clean draft on purpose, so the first gate passes and
   * only the throw can produce the result.
   */
  it("carries the blockers from the in-transaction gate too, not just the pre-generation one", async () => {
    getMock.mockResolvedValue(draftForDriftTest);
    amountInWordsMock.mockResolvedValue("milion czterdzieści cztery tysiące czterysta złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    const blockers = [
      { path: "provenance.geocode", label: "Geokodowanie adresu — do weryfikacji." },
      { path: "prose.standard", label: "Opis standardu wykończenia — do weryfikacji." },
    ];
    approveMock.mockRejectedValue(new ApprovalBlockedError(blockers));

    const result = await approveValuation(draftForDriftTest.id);

    expect(result!.error).toBe("Zatwierdzenie zablokowane — Geokodowanie adresu — do weryfikacji.");
    expect(result!.blockers).toEqual(blockers);
  });

  /**
   * The same catch's other arm: `blockers[0]?.label` tolerates an empty list,
   * so the generic sentence has to survive one.
   *
   * The empty array is NOT behaviourally distinct from an absent field — the
   * renderer keys on `blockers?.length`, falsy either way, so both fall back to
   * the plain paragraph. This is a second pin on the same line as the case
   * above, covering the other branch of the `??`, and nothing more. Spelled out
   * because an earlier version of this comment claimed a distinction that does
   * not exist.
   */
  it("degrades to the generic sentence when the throw carries no blockers", async () => {
    getMock.mockResolvedValue(draftForDriftTest);
    amountInWordsMock.mockResolvedValue("milion czterdzieści cztery tysiące czterysta złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    approveMock.mockRejectedValue(new ApprovalBlockedError([]));

    const result = await approveValuation(draftForDriftTest.id);

    expect(result!.error).toBe(
      "Zatwierdzenie zablokowane — operat zawiera niezweryfikowane wartości.",
    );
    expect(result!.blockers).toEqual([]);
  });
});
