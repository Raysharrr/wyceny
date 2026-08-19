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
import { previewOperat } from "../src/app/actions/preview-operat";
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
const freezeMapsMock = vi.mocked(valuationRepository.freezeMaps);

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
    freezeMapsMock.mockReset();
    // The adapter answers with the saved row; `undefined` from a bare vi.fn()
    // would read as "the freeze write did not happen", which approve refuses on.
    freezeMapsMock.mockImplementation(async (_id, _user, address) => ({
      ...draft,
      mapsFrozenFor: address,
    }));
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
    // clean up (final review, Important #1). The preview blob dropped after
    // the flip is a different matter, asserted in its own test below.
    const deleted = storageDeleteMock.mock.calls.map(([key]) => key);
    expect(deleted.filter((key) => key.startsWith("mapa-"))).toEqual([]);

    // Which address the embedded maps came from is evidence and belongs on
    // the one row per issue (Slice 14) — the freeze marker itself is rewritten
    // by every preview and stays out of the trail.
    expect(approveMock).toHaveBeenCalledWith(
      draft.id,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mapsFrozenFor: draft.address },
      draft.inputs,
      { requireProse: true },
    );

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
    // ...and the freeze marker goes with them (Slice 14): left standing, it
    // would tell the next reader this valuation has maps it just deleted.
    expect(freezeMapsMock).toHaveBeenCalledWith(draft.id, expect.anything(), null);

    const docxCall = storagePutMock.mock.calls.find(([key]) => key === `operat-${draft.id}.docx`);
    const docxBytes = docxCall?.[1] as Buffer;
    const text = new PizZip(docxBytes).file("word/document.xml")!.asText();
    expect(text).toContain("Dokumentacja kartograficzna zostanie uzupełniona.");
  });

  it("a freeze that does not take stops the issue and leaves no maps behind", async () => {
    getMock.mockResolvedValue(draft);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    setUpHappyMocks();
    // Owner-only adapter, or a row that stopped being a draft: `null`, no throw.
    freezeMapsMock.mockResolvedValue(null);

    const result = await approveValuation(draft.id);

    // Bytes without a marker that describes them are the state this whole
    // design exists to prevent, so they go. And with them has to go the issue:
    // sign re-renders from exactly these keys and reads their absence as
    // "approved without maps", silently — so a document approved WITH maps
    // over deleted bytes would come out of the office unillustrated.
    expect(result).toEqual({ error: expect.stringContaining("stanu map operatu") });
    expect(approveMock).not.toHaveBeenCalled();
    expect(storageDeleteMock).toHaveBeenCalledWith(`mapa-ewidencyjna-${draft.id}.png`);
    expect(storageDeleteMock).toHaveBeenCalledWith(`mapa-orto-${draft.id}.jpg`);
  });

  it("issuing drops the preview blob — two files differing only by their date invite the wrong one", async () => {
    getMock.mockResolvedValue(draft);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    setUpHappyMocks();

    await approveValuation(draft.id);

    expect(storageDeleteMock).toHaveBeenCalledWith(`podglad-${draft.id}.pdf`);
  });

  it("a storage failure while dropping the preview does not undo an approval that already happened", async () => {
    getMock.mockResolvedValue(draft);
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
    setUpHappyMocks();
    storageDeleteMock.mockRejectedValue(new Error("storage down"));

    const result = await approveValuation(draft.id);

    // The status flip is committed by now: reporting a failure here would
    // send the appraiser to re-approve an operat that is already issued.
    expect(result).toBeUndefined();
    expect(approveMock).toHaveBeenCalled();
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
    freezeMapsMock.mockReset();
    // The adapter answers with the saved row; `undefined` from a bare vi.fn()
    // would read as "the freeze write did not happen", which approve refuses on.
    freezeMapsMock.mockImplementation(async (_id, _user, address) => ({
      ...draftWithPhotos,
      mapsFrozenFor: address,
    }));
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
    freezeMapsMock.mockReset();
    // The adapter answers with the saved row; `undefined` from a bare vi.fn()
    // would read as "the freeze write did not happen", which approve refuses on.
    freezeMapsMock.mockImplementation(async (_id, _user, address) => ({
      ...draftBase,
      mapsFrozenFor: address,
    }));
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
      // Maps were fetched and embedded here, so the audit meta names the
      // address they came from (Slice 14) — this call carries no skip.
      { mapsFrozenFor: draftBase.address },
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
      { mapsFrozenFor: draftBase.address },
      expect.anything(),
      { requireProse: false },
    );
    vi.unstubAllEnvs();
  });

  /**
   * Task 11: the step-7 preview marks a section the appraiser has not
   * written; the ISSUED operat must stay silent about it. The kill switch is
   * the one way a prose-less draft reaches the render at all, which makes
   * this the only place the issued path can be tested against the worst case
   * — all six sections empty. The template contains no "brak treści" of its
   * own, so the assertion cannot pass on static text.
   */
  it("the issued operat carries no preview marker, not even with the prose requirement off (Task 11)", async () => {
    // try/finally, unlike the test above: this is the LAST test in the
    // describe, so a failure here would leak NEXT_PUBLIC_PROSE=off into the
    // next one — turning one red into a confusing cascade during exactly the
    // debugging session that matters.
    vi.stubEnv("NEXT_PUBLIC_PROSE", "off");
    try {
      getMock.mockResolvedValue(withProse(null));

      expect(await approveValuation(draftBase.id)).toBeUndefined();

      const docxCall = storagePutMock.mock.calls.find(
        ([key]) => key === `operat-${draftBase.id}.docx`,
      );
      const text = new PizZip(docxCall![1] as Buffer)
        .file("word/document.xml")!
        .asText()
        .replace(/<[^>]+>/g, "");
      expect(text).not.toContain("[PODGLĄD: BRAK TREŚCI]");
      expect(text).not.toContain("w wydanym operacie to miejsce pozostanie puste");
    } finally {
      vi.unstubAllEnvs();
    }
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
    freezeMapsMock.mockReset();
    // The adapter answers with the saved row; `undefined` from a bare vi.fn()
    // would read as "the freeze write did not happen", which approve refuses on.
    freezeMapsMock.mockImplementation(async (_id, _user, address) => ({
      ...draftForDriftTest,
      mapsFrozenFor: address,
    }));
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

/**
 * Task 12 — issuing reuses what the appraiser just read.
 *
 * Before this task the two paths were independent: the preview fetched the
 * §8.1 maps and froze them, and then the issue went back to the WMS and
 * fetched its own. Two consequences, one of them serious. The cheap one is a
 * duplicated multi-second call. The serious one is that the document under
 * the signature was composed from bytes nobody had looked at — the whole
 * complaint this slice answers, in the one part of the operat that comes from
 * outside.
 *
 * These tests need a mock pair the earlier blocks do not: `getMock` must
 * REFLECT the freeze (a fixed row with `mapsFrozenFor: null` would make every
 * reuse assertion vacuous), and `storage` must round-trip put→get (otherwise
 * `readFrozenMaps` finds nothing and approve fetches again — the test would
 * pass, or fail, for the wrong reason). Hence the mutable `current` row and
 * the in-memory blob map below.
 */
describe("approveValuation — issuing reuses the maps the preview froze (Slice 14, Task 12)", () => {
  const draftT12: Valuation = {
    id: "valuation-t12-1",
    address: "ul. Klonowa 7, m. Nowogród",
    area: 71.63,
    wr: 1_044_400,
    inputs: {
      ...approvableInput("test-user").inputs!,
      prose: confirmedProseFor("ul. Klonowa 7, m. Nowogród", approvableInput("test-user").inputs!),
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

  /** The row as the repository would hold it — rewritten by `freezeMaps`. */
  let current: Valuation;
  /** Storage that actually remembers, so a freeze can be read back. */
  const blobs = new Map<string, Buffer>();

  const mapKeys = [`mapa-ewidencyjna-${draftT12.id}.png`, `mapa-orto-${draftT12.id}.jpg`];
  const deletedKeys = () => storageDeleteMock.mock.calls.map(([key]) => key);
  const putKeys = () => storagePutMock.mock.calls.map(([key]) => key);
  const issuedDocx = () =>
    storagePutMock.mock.calls.find(([key]) => key === `operat-${draftT12.id}.docx`)?.[1] as Buffer;

  beforeEach(() => {
    getMock.mockReset();
    approveMock.mockReset();
    amountInWordsMock.mockReset();
    convertToPdfMock.mockReset();
    storagePutMock.mockReset();
    storageDeleteMock.mockReset();
    storageGetMock.mockReset();
    fetchMapsMock.mockReset();
    freezeMapsMock.mockReset();

    current = { ...draftT12 };
    blobs.clear();

    getMock.mockImplementation(async () => current);
    // Faithful to the adapter (`valuation-drizzle.ts:592-613`): owner-only,
    // and a CAS on `in_progress` — the SAME two predicates `approve` applies
    // (`:615+`). That equivalence is what the skipMaps arm now rests on, so a
    // fake that answered unconditionally would make these tests agree with a
    // production adapter that does not.
    freezeMapsMock.mockImplementation(async (_id, user, address) => {
      if (current.ownerId !== user.id || current.status !== "in_progress") return null;
      current = { ...current, mapsFrozenFor: address };
      return current;
    });
    storagePutMock.mockImplementation(async (key: string, bytes: Buffer | string) => {
      blobs.set(key, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
      return `/api/docs/${key}`;
    });
    storageGetMock.mockImplementation(async (key: string) => {
      const bytes = blobs.get(key);
      if (!bytes) throw new StorageNotFoundError(key);
      return bytes;
    });
    storageDeleteMock.mockImplementation(async (key: string) => {
      blobs.delete(key);
    });
    amountInWordsMock.mockResolvedValue("milion czterdzieści cztery tysiące czterysta złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("%PDF-fake"));
    // Same two predicates again — a caller who may not freeze may not approve.
    approveMock.mockImplementation(async (_id, user) =>
      current.ownerId !== user.id || current.status !== "in_progress"
        ? null
        : { ...current, status: "approved" as const },
    );
    fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
  });

  it("issuing after a preview does not go back to Geoportal", async () => {
    const preview = await previewOperat(draftT12.id);
    expect(preview).toEqual({ url: expect.stringContaining(`/api/podglad/${draftT12.id}`) });
    expect(fetchMapsMock).toHaveBeenCalledTimes(1);
    fetchMapsMock.mockClear();

    const result = await approveValuation(draftT12.id);

    expect(result).toBeUndefined();
    expect(fetchMapsMock).not.toHaveBeenCalled();
    // Reused, not skipped: the issued operat carries the same two images the
    // appraiser saw. Asserting only the absent fetch would pass just as well
    // for an operat that quietly came out with no maps at all.
    expect(generatedMedia(issuedDocx())).toHaveLength(2);
  });

  /**
   * The refactor's most expensive way to go wrong, and one no existing test
   * would have caught (every other happy path here FETCHES).
   *
   * The mapless arm of approve deletes the two map keys and lifts the marker —
   * correct when nothing was embedded, catastrophic if a reuse falls through
   * to it: `repo.approve` would commit an operat rendered WITH maps over bytes
   * that no longer exist, and `signValuationAction` re-renders from exactly
   * those keys and reads their absence as "approved without maps" — silently.
   * The office would send out an illustrated operat and a signed one without
   * §8.1.
   *
   * Measured, not assumed: mutating that arm to fire on the reuse path
   * reddens this case. Re-spelling its condition as "did not fetch" does NOT,
   * because today the two coincide — which is worth knowing, since it means
   * the guard here is on the OUTCOME, not on a particular spelling.
   */
  it("reuse touches neither the bytes nor the marker — it only reads them", async () => {
    await previewOperat(draftT12.id);
    storagePutMock.mockClear();
    storageDeleteMock.mockClear();
    freezeMapsMock.mockClear();

    const result = await approveValuation(draftT12.id);

    expect(result).toBeUndefined();
    expect(deletedKeys().filter((key) => key.startsWith("mapa-"))).toEqual([]);
    expect(putKeys().filter((key) => key.startsWith("mapa-"))).toEqual([]);
    expect(freezeMapsMock).not.toHaveBeenCalled();
    // ...and the bytes are still there for `signValuationAction` to re-render from.
    for (const key of mapKeys) expect(blobs.has(key)).toBe(true);
  });

  /**
   * The address on the audit row is the only lasting record of which parcel
   * the embedded maps depict, so in the reuse branch it comes from the MARKER
   * the bytes were frozen under — not from the row, which says which parcel
   * the valuation is about. Here the two agree by construction
   * (`mapsFrozenForCurrentAddress` compares them), which is the point: this
   * pins the source of the claim, not a divergence.
   *
   * Honest about its own strength: swapping the marker for the row in the
   * reuse branch reddens NOTHING (measured). This case cannot fail today and
   * is defence in depth — it costs one line and it is the line that stays
   * right if the equality ever stops holding.
   */
  it("audits the address the reused bytes were frozen under", async () => {
    await previewOperat(draftT12.id);

    await approveValuation(draftT12.id);

    expect(approveMock).toHaveBeenCalledWith(
      draftT12.id,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { mapsFrozenFor: draftT12.address },
      draftT12.inputs,
      { requireProse: true },
    );
  });

  /**
   * A marker is a claim about bytes, and bytes can be gone (an eviction, a
   * failed put, a half-finished cleanup) while the claim stands. Absence has
   * to mean "fetch again", exactly as the preview reads it — the alternative
   * is an operat issued without §8.1 because a claim was believed.
   */
  it("a marker whose bytes are gone falls back to a fetch instead of issuing without maps", async () => {
    await previewOperat(draftT12.id);
    blobs.delete(mapKeys[0]);
    fetchMapsMock.mockClear();

    const result = await approveValuation(draftT12.id);

    expect(result).toBeUndefined();
    expect(fetchMapsMock).toHaveBeenCalledWith(draftT12.address);
    expect(generatedMedia(issuedDocx())).toHaveLength(2);
  });

  /**
   * The freeze that does not take, now told apart by WHY (Task 10 fixed the
   * same defect on the preview side with the same positive condition).
   *
   * Two concurrent approves: the loser spends seconds inside the WMS call, the
   * winner commits meanwhile, and the loser's `freezeMaps` comes back `null`
   * because the row is no longer a draft. Deleting on that unattributed `null`
   * would take the WINNER's frozen bytes with it, and the winner's signature
   * would then be applied to a document without the §8.1 maps its approved
   * copy carries.
   */
  it("leaves the bytes alone when the freeze failed because the row is no longer our draft", async () => {
    freezeMapsMock.mockResolvedValue(null);
    // Approve's OWN read still sees the draft it set out to issue; the fresh
    // read the guard makes, seconds later, is the one that finds the winner's
    // committed row. Anything else would trip the fast status guard at the top
    // of the action and never reach the freeze at all.
    getMock.mockImplementationOnce(async () => current);
    getMock.mockImplementation(async () => ({ ...current, status: "approved" as const }));

    const result = await approveValuation(draftT12.id);

    // The refusal is unconditional — whose bytes those are decides only
    // whether they are deleted, never whether this approve goes through.
    expect(result).toEqual({ error: expect.stringContaining("stanu map operatu") });
    expect(approveMock).not.toHaveBeenCalled();
    expect(deletedKeys().filter((key) => key.startsWith("mapa-"))).toEqual([]);
  });

  it("drops the bytes when the freeze failed and this is still our draft", async () => {
    freezeMapsMock.mockResolvedValue(null);

    const result = await approveValuation(draftT12.id);

    expect(result).toEqual({ error: expect.stringContaining("stanu map operatu") });
    expect(approveMock).not.toHaveBeenCalled();
    expect(deletedKeys()).toEqual(expect.arrayContaining(mapKeys));
  });

  /**
   * The OTHER arm's version of the same loss, found in review.
   *
   * The mapless arm deletes both keys, and until now it did so with no
   * evidence that they were still this draft's to delete — the defect the
   * fetch arm had fixed. Task 12 made it worse from both ends: the winner now
   * REUSES the frozen bytes and never re-puts them, so there is no healing
   * write behind the loser's delete, and the winner no longer waits on the
   * WMS, so it commits sooner. The chain is the same one this task closed on
   * the other side — bytes deleted, `signValuationAction` reads their absence
   * as "approved without maps", and a signed operat silently loses §8.1 that
   * the approved copy has.
   *
   * The fix is an ordering, not a second read: lift the marker FIRST and
   * delete only if the lift took. `freezeMaps` is owner-only and CAS's on
   * `in_progress` — the same two predicates as `approve` — so "the lift took"
   * IS "this approve may commit", established by a locking write rather than
   * an unlocked read. What matters at commit time is that the BYTES are gone,
   * because sign reads the bytes and never the marker.
   */
  it("a skipMaps issue that lost the race leaves the winner's frozen bytes alone", async () => {
    await previewOperat(draftT12.id);
    storageDeleteMock.mockClear();
    // This call's own read still found the draft it set out to issue — a
    // SNAPSHOT, not a live reference, or the fast status guard at the top of
    // the action would see the winner's row and refuse before reaching the
    // arm under test. The winner commits during the seconds that follow.
    const asItWasRead = current;
    getMock.mockImplementationOnce(async () => asItWasRead);
    current = { ...current, status: "approved" as const };

    const result = await approveValuation(draftT12.id, { skipMaps: true });

    expect(deletedKeys().filter((key) => key.startsWith("mapa-"))).toEqual([]);
    for (const key of mapKeys) expect(blobs.has(key)).toBe(true);
    // And it does not issue anything either — `repo.approve` refuses on the
    // same predicate that refused the lift.
    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
  });

  /**
   * The case that tells the two candidate fixes apart.
   *
   * `get` admits an admin (F-8) while `freezeMaps` and `approve` are both
   * owner-only, so an admin's skipMaps attempt is refused — but a cleanup
   * conditioned on a fresh READ would see a perfectly ordinary draft and
   * delete the OWNER's frozen bytes on the way out of an issue that never
   * happens. Conditioning on the WRITE cannot: the same guard that refuses
   * the approve refuses the lift.
   */
  it("an admin's refused skipMaps attempt does not take the owner's bytes with it", async () => {
    await previewOperat(draftT12.id);
    storageDeleteMock.mockClear();
    // Same session, different owner: visible through `get`, untouchable
    // through `freezeMaps`/`approve`.
    current = { ...current, ownerId: "some-other-appraiser" };

    const result = await approveValuation(draftT12.id, { skipMaps: true });

    expect(deletedKeys().filter((key) => key.startsWith("mapa-"))).toEqual([]);
    for (const key of mapKeys) expect(blobs.has(key)).toBe(true);
    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
  });
});
