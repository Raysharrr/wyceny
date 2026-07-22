import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { exifApp1, jpegOf, sof0, xmpApp1 } from "./fixtures/jpeg-fixtures";

/**
 * TDD for the FR-2 trust boundary (Task 5, Slice 10): processed photo bytes
 * arrive from the CLIENT, so `uploadInspectionPhoto` re-checks every RODO
 * guarantee on raw bytes independently of the worker — JPEG magic, APP1
 * absence (Exif AND XMP, advisor I-2), size, and dimensions — before ever
 * touching storage.
 *
 * Mock pattern copied 1:1 from approve-valuation-action.test.ts:30-52:
 * `@/auth/session` stubbed with a fixed session, `@/app/valuations/_deps`
 * automocked (storage.put/delete, valuationRepository.updateInspection
 * become controllable `vi.fn()`s — no real Postgres/blob call ever leaves
 * the test process), `next/cache`/`next/navigation` stubbed (their real
 * implementations only work inside an actual Next.js request). The vitest
 * config has no clearMocks/restoreMocks, so every test resets the mocks it
 * uses in `beforeEach` itself.
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

import {
  removeInspectionPhoto,
  saveInspectionNote,
  uploadInspectionPhoto,
} from "../src/app/actions/inspection";
import { storage, valuationRepository } from "@/app/valuations/_deps";
import { InspectionLimitError } from "@/domain/valuation";
import type { Valuation } from "@/ports/valuation";

const putMock = vi.mocked(storage.put);
const deleteMock = vi.mocked(storage.delete);
const updateInspectionMock = vi.mocked(valuationRepository.updateInspection);

const VALUATION_ID = "vid";
const SESSION_USER = { id: "test-user", role: "appraiser" };
/** buildPhotoKey("budynekZewn", uuid, "vid") — SECTION_SLUG maps budynekZewn -> "budynek". */
const KEY_RE = /^ogledziny-budynek-[0-9a-f-]+-vid\.jpg$/;

function photoForm(bytes: Buffer): FormData {
  const form = new FormData();
  // Blob's BlobPart wants an ArrayBufferView<ArrayBuffer>; Buffer's `buffer`
  // is typed ArrayBufferLike (ArrayBuffer | SharedArrayBuffer), so a plain
  // `new Blob([bytes], ...)` fails typecheck — copy into a fresh Uint8Array.
  form.set("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
  return form;
}

/** Valid JPEG: no APP1, 800x600 — passes every trust-boundary check. */
const validJpeg = jpegOf([sof0(800, 600)]);

const draftValuation: Valuation = {
  id: VALUATION_ID,
  address: "ul. Testowa 1, Poznań",
  area: 50,
  wr: 500_000,
  inputs: null,
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
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};

beforeEach(() => {
  putMock.mockReset();
  deleteMock.mockReset();
  updateInspectionMock.mockReset();
  // Real PortStorage.delete returns Promise<void>; the automock's default
  // (a bare `undefined`) has no `.catch`, which the compensating-delete
  // error path relies on — restore the real shape as the default.
  deleteMock.mockResolvedValue(undefined);
});

describe("uploadInspectionPhoto — happy path", () => {
  it("stores the photo under a fresh key and records add_photo with the same key", async () => {
    updateInspectionMock.mockResolvedValue(draftValuation);

    const result = await uploadInspectionPhoto(VALUATION_ID, "budynekZewn", photoForm(validJpeg));

    expect(result).toEqual({ key: expect.stringMatching(KEY_RE) });
    const key = (result as { key: string }).key;
    expect(putMock).toHaveBeenCalledWith(key, expect.any(Buffer));
    expect(updateInspectionMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      kind: "add_photo",
      section: "budynekZewn",
      key,
    });
  });
});

describe("uploadInspectionPhoto — trust boundary (raw bytes re-checked server-side)", () => {
  const cases: Array<[string, Buffer]> = [
    ["PNG magic bytes", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["JPEG with EXIF APP1", jpegOf([exifApp1, sof0(800, 600)])],
    ["JPEG with XMP APP1 (advisor I-2: XMP-GPS bypass)", jpegOf([xmpApp1, sof0(800, 600)])],
    ["JPEG 1600x900 (dims > 1200)", jpegOf([sof0(1600, 900)])],
    [
      "payload > 2 MB (size check fires first)",
      Buffer.concat([validJpeg, Buffer.alloc(2 * 1024 * 1024)]),
    ],
  ];

  it.each(cases)("%s -> error, never touches storage or the repo", async (_label, bytes) => {
    const result = await uploadInspectionPhoto(VALUATION_ID, "budynekZewn", photoForm(bytes));

    expect(result).toEqual({ error: "Nieprawidłowy plik zdjęcia." });
    expect(putMock).not.toHaveBeenCalled();
    expect(updateInspectionMock).not.toHaveBeenCalled();
  });
});

describe("uploadInspectionPhoto — compensating delete", () => {
  it("cap reached: InspectionLimitError -> Polish limit error + storage.delete(key)", async () => {
    updateInspectionMock.mockRejectedValueOnce(new InspectionLimitError());

    const result = await uploadInspectionPhoto(VALUATION_ID, "budynekZewn", photoForm(validJpeg));

    expect(result).toEqual({ error: "Limit 50 zdjęć na wycenę został osiągnięty." });
    const putKey = putMock.mock.calls.findLast(() => true)?.[0];
    expect(putKey).toMatch(KEY_RE);
    expect(deleteMock).toHaveBeenCalledWith(putKey);
  });

  it("repo returns null (not owner / not draft / CAS lost) -> error + storage.delete(key)", async () => {
    updateInspectionMock.mockResolvedValueOnce(null);

    const result = await uploadInspectionPhoto(VALUATION_ID, "budynekZewn", photoForm(validJpeg));

    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
    const putKey = putMock.mock.calls.findLast(() => true)?.[0];
    expect(putKey).toMatch(KEY_RE);
    expect(deleteMock).toHaveBeenCalledWith(putKey);
  });
});

describe("removeInspectionPhoto", () => {
  it("repo returns null (not owner / not draft / CAS lost) -> error", async () => {
    updateInspectionMock.mockResolvedValueOnce(null);

    const result = await removeInspectionPhoto(
      VALUATION_ID,
      "budynekZewn",
      "ogledziny-budynek-abc123-vid.jpg",
    );

    expect(result).toEqual({ error: "Nie znaleziono wyceny albo nie masz do niej dostępu." });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("own key (ends with this valuation's id) -> storage.delete called", async () => {
    updateInspectionMock.mockResolvedValueOnce(draftValuation);
    const ownKey = "ogledziny-budynek-abc123-vid.jpg";

    const result = await removeInspectionPhoto(VALUATION_ID, "budynekZewn", ownKey);

    expect(result).toBeUndefined();
    expect(deleteMock).toHaveBeenCalledWith(ownKey);
  });

  it("inherited key (ends with a different valuation's id) -> storage.delete NOT called", async () => {
    updateInspectionMock.mockResolvedValueOnce(draftValuation);
    const inheritedKey = "ogledziny-budynek-abc123-other-valuation.jpg";

    const result = await removeInspectionPhoto(VALUATION_ID, "budynekZewn", inheritedKey);

    expect(result).toBeUndefined();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("saveInspectionNote", () => {
  it("note over 5000 chars -> error, never touches the repo", async () => {
    const result = await saveInspectionNote(VALUATION_ID, "a".repeat(5001));

    expect(result).toEqual({ error: "Notatka może mieć najwyżej 5000 znaków." });
    expect(updateInspectionMock).not.toHaveBeenCalled();
  });

  it("happy path -> repo op set_note", async () => {
    updateInspectionMock.mockResolvedValueOnce(draftValuation);

    const result = await saveInspectionNote(VALUATION_ID, "Klatka schodowa po remoncie.");

    expect(result).toBeUndefined();
    expect(updateInspectionMock).toHaveBeenCalledWith(VALUATION_ID, SESSION_USER, {
      kind: "set_note",
      note: "Klatka schodowa po remoncie.",
    });
  });
});
