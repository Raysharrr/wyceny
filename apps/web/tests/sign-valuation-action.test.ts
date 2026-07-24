import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";

// Synthetic 1x1 images (F-9: no real map data in fixtures) — same constants
// as docx-render-maps.test.ts (repo convention: duplicate small fixture
// constants locally rather than importing across test files).
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
const textOf = (buf: Buffer) =>
  new PizZip(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();

/**
 * Focused unit test of `signValuationAction`'s guards and happy path (F-7
 * Task 7). Mirrors `approve-valuation-action.test.ts` / `save-signature-
 * action.test.ts`: `_deps` is automocked so `valuationRepository.get/sign`,
 * `profileRepository.getSignature`, `worker.amountInWords/convertToPdf` and
 * `storage.put` become controllable `vi.fn()`s and no real Postgres/HTTP
 * call ever leaves the test process. `@/auth/session` and
 * `next/cache`/`next/navigation` are mocked the same way those files do.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "u1", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { signValuationAction } from "../src/app/actions/sign-valuation";
import { profileRepository, storage, valuationRepository, worker } from "@/app/valuations/_deps";
import { StorageNotFoundError } from "@/ports/storage";

const getMock = vi.mocked(valuationRepository.get);
const signMock = vi.mocked(valuationRepository.sign);
const getSignatureMock = vi.mocked(profileRepository.getSignature);
const amountInWordsMock = vi.mocked(worker.amountInWords);
const convertToPdfMock = vi.mocked(worker.convertToPdf);
const storagePutMock = vi.mocked(storage.put);
const storageGetMock = vi.mocked(storage.get);

const approvedValuation: Valuation = {
  id: "v1",
  address: "Testowa 1",
  area: 40,
  wr: 400000,
  // approvableInput's KcsInput fixture (F-9: kwNumber uses the short-middle
  // form "PO1P/1/6" like every fixture in the repo — an 8-digit middle
  // matches check-no-pii.sh's KW regex and REDs CI).
  inputs: approvableInput("u1").inputs,
  amountInWords: null,
  docUrl: "/api/docs/operat-v1.pdf",
  docxUrl: "/api/docs/operat-v1.docx",
  purpose: "sprzedaz",
  kwNumber: "PO1P/1/6",
  client: "Jan Testowy",
  inspectionDate: "2026-07-10",
  ownerId: "u1",
  status: "approved",
  approvedAt: new Date("2026-07-19"),
  signedAt: null,
  supersedesId: null,
  createdAt: new Date(),
};

describe("signValuationAction", () => {
  it("refuses an admin who is not the owner, before touching signature/storage/sign", async () => {
    getMock.mockResolvedValue(approvedValuation); // ownerId "u1"; session below is "admin-1"
    vi.mocked(await import("@/auth/session")).getSession.mockResolvedValueOnce({
      user: { id: "admin-1", name: "Admin Testowy", role: "admin" },
    });

    const result = await signValuationAction("v1");

    expect(result?.error).toMatch(/właściciel/i);
    expect(getSignatureMock).not.toHaveBeenCalled();
    expect(storagePutMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });

  it("refuses when there is no signature scan in the profile", async () => {
    getMock.mockResolvedValue(approvedValuation);
    getSignatureMock.mockResolvedValue(null);

    const result = await signValuationAction("v1");

    expect(result?.error).toMatch(/skanu podpisu/i);
    expect(signMock).not.toHaveBeenCalled();
  });

  it("refuses an already-signed valuation", async () => {
    getMock.mockResolvedValue({ ...approvedValuation, status: "signed" });

    const result = await signValuationAction("v1");

    expect(result?.error).toMatch(/już podpisana/i);
  });

  it("refuses a non-approved draft", async () => {
    getMock.mockResolvedValue({ ...approvedValuation, status: "in_progress" });

    const result = await signValuationAction("v1");

    expect(result?.error).toMatch(/tylko zatwierdzon/i);
  });

  it("refuses a legacy approved row (no inputs)", async () => {
    getMock.mockResolvedValue({ ...approvedValuation, inputs: null });

    const result = await signValuationAction("v1");

    expect(result?.error).toMatch(/starego typu|nie można podpisać/i);
  });

  it("renders, converts, stores -signed keys, hashes and signs", async () => {
    getMock.mockResolvedValue(approvedValuation);
    getSignatureMock.mockResolvedValue({
      bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
      mime: "image/png",
    });
    amountInWordsMock.mockResolvedValue("czterysta tysięcy złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    signMock.mockResolvedValue({ ...approvedValuation, status: "signed" });

    const result = await signValuationAction("v1");

    expect(result).toBeUndefined();
    expect(storagePutMock).toHaveBeenCalledWith("operat-v1-signed.docx", expect.any(Buffer));
    expect(storagePutMock).toHaveBeenCalledWith("operat-v1-signed.pdf", expect.any(Buffer));
    const docxCall = storagePutMock.mock.calls.find(([key]) => key === "operat-v1-signed.docx");
    const docxBytes = docxCall?.[1] as Buffer;
    const signArgs = signMock.mock.calls[0][2];
    expect(signArgs.sha256Docx).toBe(createHash("sha256").update(docxBytes).digest("hex"));
    expect(signArgs.sha256Pdf).toBe(
      createHash("sha256").update(Buffer.from("pdf-bytes")).digest("hex"),
    );
    expect(signArgs.docUrl).toBe("/api/docs/operat-v1-signed.pdf");
  });

  it("re-renders from frozen map bytes at sign (Task 7) — byte-identical maps, no wms contact", async () => {
    getMock.mockResolvedValue(approvedValuation);
    getSignatureMock.mockResolvedValue({
      bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
      mime: "image/png",
    });
    amountInWordsMock.mockResolvedValue("czterysta tysięcy złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    // Frozen keys from Task 6 (approve); anything else (e.g. a live WMS
    // fetch) would reject — sign must never contact WMS.
    storageGetMock.mockImplementation((key: string) =>
      key === "mapa-ewidencyjna-v1.png"
        ? Promise.resolve(PNG_1PX)
        : key === "mapa-orto-v1.jpg"
          ? Promise.resolve(JPG_1PX)
          : Promise.reject(new Error("not found")),
    );
    signMock.mockResolvedValue({ ...approvedValuation, status: "signed" });

    const result = await signValuationAction("v1");

    expect(result).toBeUndefined();
    // .findLast, not .find: storagePutMock.mock.calls accumulates across
    // tests in this file (no clearMocks configured) — .find would pick up
    // the earlier happy-path test's docx call instead of this test's own.
    const docxCall = storagePutMock.mock.calls.findLast(([key]) => key === "operat-v1-signed.docx");
    const docxBytes = docxCall?.[1] as Buffer;
    const zip = new PizZip(docxBytes);
    const media = generatedMedia(docxBytes);
    expect(media.length).toBe(3); // signature + 2 frozen maps
    const mediaBuffers = media.map((m) => Buffer.from(zip.file(m)!.asUint8Array()));
    expect(mediaBuffers.some((b) => b.equals(PNG_1PX))).toBe(true);
    expect(mediaBuffers.some((b) => b.equals(JPG_1PX))).toBe(true);
  });

  it("signs without maps when approved without them (Task 7) — honest stub, exactly 1 medium", async () => {
    getMock.mockResolvedValue(approvedValuation);
    getSignatureMock.mockResolvedValue({
      bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
      mime: "image/png",
    });
    amountInWordsMock.mockResolvedValue("czterysta tysięcy złotych");
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    storageGetMock.mockRejectedValue(new StorageNotFoundError("not found"));
    signMock.mockResolvedValue({ ...approvedValuation, status: "signed" });

    const result = await signValuationAction("v1");

    expect(result).toBeUndefined();
    const docxCall = storagePutMock.mock.calls.findLast(([key]) => key === "operat-v1-signed.docx");
    const docxBytes = docxCall?.[1] as Buffer;
    expect(textOf(docxBytes)).toContain("Dokumentacja kartograficzna zostanie uzupełniona.");
    expect(generatedMedia(docxBytes).length).toBe(1); // signature only
  });

  it("returns a Polish error and does not sign when storage.get fails with a transient error (final review, Important #2)", async () => {
    getMock.mockResolvedValue(approvedValuation);
    getSignatureMock.mockResolvedValue({
      bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
      mime: "image/png",
    });
    amountInWordsMock.mockResolvedValue("czterysta tysięcy złotych");
    // A generic Error (e.g. a dead pooled connection) must NOT be treated as
    // "approved without maps" — only StorageNotFoundError may be.
    storageGetMock.mockRejectedValue(new Error("connection reset"));
    // signMock (like storagePutMock, see the .findLast comment above)
    // accumulates calls across tests in this file (no clearMocks
    // configured) — clear it so "not called" below reflects only this test.
    signMock.mockClear();

    const result = await signValuationAction("v1");

    expect(result).toEqual({
      error: "Nie udało się odczytać zamrożonych map operatu — spróbuj ponownie.",
    });
    expect(signMock).not.toHaveBeenCalled();
  });

  describe("inspection photos (Slice 10, Task 8)", () => {
    // Manifest with 2 keys spread across 2 of the 3 sections.
    const photoKeys = {
      otoczenie: "ogledziny-otoczenie-p1-v1.jpg",
      wnetrza: "ogledziny-wnetrza-p2-v1.jpg",
    };

    const approvedValuationWithPhotos: Valuation = {
      ...approvedValuation,
      inputs: {
        ...approvedValuation.inputs!,
        inspection: {
          note: null,
          photos: {
            otoczenie: [photoKeys.otoczenie],
            budynekZewn: [],
            wnetrza: [photoKeys.wnetrza],
          },
        },
      },
    };

    it("aborts (no repo.sign) when a manifest photo key fails to resolve — contrast with maps' silent StorageNotFoundError", async () => {
      getMock.mockResolvedValue(approvedValuationWithPhotos);
      getSignatureMock.mockResolvedValue({
        bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
        mime: "image/png",
      });
      amountInWordsMock.mockResolvedValue("czterysta tysięcy złotych");
      // signMock (see the .findLast comment above) accumulates across tests
      // in this file (no clearMocks configured) — clear it so "not called"
      // below reflects only this test.
      signMock.mockClear();
      // Maps keys also reject with StorageNotFoundError here (silently
      // treated as "approved without maps"); the photo key's identical error
      // must NOT be swallowed the same way — it aborts the sign entirely.
      storageGetMock.mockImplementation((key: string) =>
        key === photoKeys.otoczenie
          ? Promise.resolve(JPG_1PX)
          : Promise.reject(new StorageNotFoundError(`missing: ${key}`)),
      );

      const result = await signValuationAction("v1");

      expect(result).toEqual({
        error: "Nie udało się odczytać zamrożonych zdjęć operatu — spróbuj ponownie.",
      });
      expect(signMock).not.toHaveBeenCalled();
    });

    it("re-renders from frozen photo bytes at sign — embeds photos from the manifest", async () => {
      getMock.mockResolvedValue(approvedValuationWithPhotos);
      getSignatureMock.mockResolvedValue({
        bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
        mime: "image/png",
      });
      amountInWordsMock.mockResolvedValue("czterysta tysięcy złotych");
      convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
      storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
      storageGetMock.mockImplementation((key: string) =>
        key === photoKeys.otoczenie || key === photoKeys.wnetrza
          ? Promise.resolve(JPG_1PX)
          : // Maps absent (StorageNotFoundError) -> honest stub, doesn't affect photos.
            Promise.reject(new StorageNotFoundError(`missing: ${key}`)),
      );
      signMock.mockResolvedValue({ ...approvedValuationWithPhotos, status: "signed" });

      const result = await signValuationAction("v1");

      expect(result).toBeUndefined();
      const docxCall = storagePutMock.mock.calls.findLast(
        ([key]) => key === "operat-v1-signed.docx",
      );
      const docxBytes = docxCall?.[1] as Buffer;
      expect(generatedMedia(docxBytes).length).toBe(3); // signature + 2 photos, no maps
    });

    it("aborts (not a crash) when storage.get resolves undefined for a manifest photo key (fake/buggy storage)", async () => {
      getMock.mockResolvedValue(approvedValuationWithPhotos);
      getSignatureMock.mockResolvedValue({
        bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
        mime: "image/png",
      });
      amountInWordsMock.mockResolvedValue("czterysta tysięcy złotych");
      signMock.mockClear();
      storageGetMock.mockImplementation((key: string) =>
        key === photoKeys.otoczenie
          ? (Promise.resolve(undefined) as unknown as Promise<Buffer>)
          : Promise.reject(new StorageNotFoundError(`missing: ${key}`)),
      );

      const result = await signValuationAction("v1");

      expect(result).toEqual({
        error: "Nie udało się odczytać zamrożonych zdjęć operatu — spróbuj ponownie.",
      });
      expect(signMock).not.toHaveBeenCalled();
    });
  });
});
