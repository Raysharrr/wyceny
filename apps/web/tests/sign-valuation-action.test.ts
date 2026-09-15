import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import type { Valuation } from "../src/ports/valuation";
import { approvableWr, approvableInput } from "./fixtures/valuation-inputs";
import { renderOperatDocx, signOperatDocx } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { documentInputFor } from "../src/domain/document-input";
import { computeKcs } from "../src/domain/kcs";
import { withCode } from "./fixtures/with-code";
import { AUTOR_TESTOWY } from "./fixtures/document-model-fixture";

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
  // I-21: the amount must be the one this snapshot produces — a fixture that
  // invents a number now trips `documentInputFor` (ADR-016).
  wr: approvableWr(),
  // approvableInput's KcsInput fixture (F-9: kwNumber uses the short-middle
  // form "PO1P/1/6" like every fixture in the repo — an 8-digit middle
  // matches check-no-pii.sh's KW regex and REDs CI).
  inputs: approvableInput("u1").inputs,
  amountInWords: null,
  docUrl: "/api/docs/operat-v1.pdf",
  docxUrl: "/api/docs/operat-v1.docx",
  purpose: "sprzedaz",
  propertyRight: "wlasnosc_lokalu",
  kwNumber: "PO1P/1/6",
  client: "Jan Testowy",
  inspectionDate: "2026-07-10",
  ownerId: "u1",
  status: "approved",
  approvedAt: new Date("2026-07-19"),
  signedAt: null,
  supersedesId: null,
  mapsFrozenFor: null,
  createdAt: new Date(),
};

describe("signValuationAction", () => {
  it("refuses an admin who is not the owner, before touching signature/storage/sign", async () => {
    getMock.mockResolvedValue(approvedValuation); // ownerId "u1"; session below is "admin-1"
    vi.mocked(await import("@/auth/session")).getSession.mockResolvedValueOnce({
      user: { id: "admin-1", name: "Admin Testowy", email: "admin@dembscy.pl", role: "admin" },
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

  const scan = () => fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png"));
  const approvedKey = `operat-v1-${approvedValuation.approvedAt!.getTime()}.docx`;

  /** The DOCX approve stored — rendered with a template that no longer ships (I-21). */
  const storedApprovedDocx = () => {
    const template = new PizZip(
      fs.readFileSync(path.join(process.cwd(), "templates", "operat-szablon.docx")),
    );
    const xml = template.file("word/document.xml")!.asText();
    template.file(
      "word/document.xml",
      xml.replace(
        "Imię i nazwisko rzeczoznawcy majątkowego:",
        "Tekst szablonu z dnia zatwierdzenia:",
      ),
    );
    return renderOperatDocx(
      buildDocumentModel(
        documentInputFor(approvedValuation, {
          approvedAt: approvedValuation.approvedAt!,
          kcs: computeKcs(approvedValuation.inputs!),
          amountInWords: "czterysta tysięcy złotych",
          // The author block is baked in at APPROVAL (ADR-020 cz. 1 + wariant
          // (a) cz. 2): this fixture stands in for the approval that produced
          // the stored DOCX, so the name in it is the one signing carries.
          author: AUTOR_TESTOWY,
        }),
      ),
      {
        maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX },
        template: template.generate({ type: "nodebuffer" }) as Buffer,
      },
    );
  };

  const setUpSign = (approvedDocx: Buffer) => {
    getMock.mockResolvedValue(approvedValuation);
    getSignatureMock.mockResolvedValue({ bytes: scan(), mime: "image/png" });
    convertToPdfMock.mockReset();
    convertToPdfMock.mockResolvedValue(Buffer.from("pdf-bytes"));
    storagePutMock.mockReset();
    storagePutMock.mockImplementation(async (key: string) => `/api/docs/${key}`);
    storageGetMock.mockReset();
    storageGetMock.mockImplementation((key: string) =>
      key === approvedKey
        ? Promise.resolve(approvedDocx)
        : Promise.reject(new StorageNotFoundError(`missing: ${key}`)),
    );
    amountInWordsMock.mockClear();
    signMock.mockReset();
    signMock.mockResolvedValue({ ...approvedValuation, status: "signed" });
  };

  const signedDocx = () =>
    storagePutMock.mock.calls.find(([key]) => key === "operat-v1-signed.docx")?.[1] as Buffer;

  it("I-21: signs the STORED approved DOCX — its text, not a re-render with today's template", async () => {
    const approvedDocx = storedApprovedDocx();
    setUpSign(approvedDocx);

    expect(await signValuationAction("v1")).toBeUndefined();

    const signed = signedDocx();
    expect(textOf(signed)).toBe(textOf(approvedDocx));
    expect(textOf(signed)).toContain("Tekst szablonu z dnia zatwierdzenia:");
    // Nothing is rebuilt: no amount in words, no model, no maps or photos read.
    expect(amountInWordsMock).not.toHaveBeenCalled();
    expect(storageGetMock.mock.calls.map(([key]) => key)).toEqual([approvedKey]);
    // The approved media stay, the scan is the one addition.
    expect(generatedMedia(signed)).toHaveLength(generatedMedia(approvedDocx).length + 1);
  });

  it("converts the SIGNED DOCX to PDF, stores -signed keys, hashes both and signs", async () => {
    setUpSign(storedApprovedDocx());

    expect(await signValuationAction("v1")).toBeUndefined();

    const docxBytes = signedDocx();
    expect(convertToPdfMock).toHaveBeenCalledWith(docxBytes);
    expect(storagePutMock).toHaveBeenCalledWith("operat-v1-signed.pdf", Buffer.from("pdf-bytes"));
    const signArgs = signMock.mock.calls[0][2];
    expect(signArgs.sha256Docx).toBe(createHash("sha256").update(docxBytes).digest("hex"));
    expect(signArgs.sha256Pdf).toBe(
      createHash("sha256").update(Buffer.from("pdf-bytes")).digest("hex"),
    );
    expect(signArgs.docUrl).toBe("/api/docs/operat-v1-signed.pdf");
    expect(signArgs.docxUrl).toBe("/api/docs/operat-v1-signed.docx");
  });

  const LEGACY_REFUSAL =
    "Tego operatu nie można podpisać — zatwierdzono go przed aktualizacją programu. Użyj „Cofnij zatwierdzenie i popraw”, popraw operat i zatwierdź go ponownie.";

  /**
   * ADR-020 cz. 1 (I-18) po wariancie (a) cz. 2 — odwrotnie niż przed merge'em
   * z #57. Tamten test pilnował, że podpis czyta profil ZALOGOWANEGO, bo podpis
   * renderował operat od nowa i blok autora powstawał w tym momencie; jego
   * własny komentarz zapowiadał, że „znika to dopiero z wariantem (a)".
   *
   * Teraz podpis nie renderuje nic, więc nie ma czego wypełniać danymi autora:
   * blok w pliku pochodzi z zatwierdzenia, które czyta profil WŁAŚCICIELA
   * (`approve-valuation.ts`), a podpisać może wyłącznie właściciel — więc
   * dokument nadal nosi dane osoby, która go podpisuje. Zmiana danych biura
   * między zatwierdzeniem a podpisem nie rozjeżdża już obu plików: podpisany
   * jest zatwierdzonym, co do bajta poza znacznikiem.
   */
  it("nie czyta profilu przy podpisie — blok autora pochodzi z zatwierdzonego pliku", async () => {
    setUpSign(storedApprovedDocx());

    expect(await signValuationAction("v1")).toBeUndefined();

    expect(vi.mocked(profileRepository.get)).not.toHaveBeenCalled();
    // Skan podpisu to jedyny odczyt profilu, jaki tu zostaje.
    expect(getSignatureMock).toHaveBeenCalledWith("u1");
  });

  it("refuses a DOCX approved before the update (no file under the approval's key) — pointing at the reopen button", async () => {
    setUpSign(storedApprovedDocx());
    storageGetMock.mockImplementation((key: string) =>
      Promise.reject(new StorageNotFoundError(`missing: ${key}`)),
    );

    expect(await signValuationAction("v1")).toEqual({ error: LEGACY_REFUSAL });
    expect(storagePutMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });

  it("refuses a stored DOCX that carries no signature marker, with the same message", async () => {
    // A signed file is the simplest DOCX without the marker.
    setUpSign(signOperatDocx(storedApprovedDocx(), scan()));

    expect(await signValuationAction("v1")).toEqual({ error: LEGACY_REFUSAL });
    expect(storagePutMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });

  it("a transient storage error is not read as 'approved before the update' — error with code, no sign", async () => {
    setUpSign(storedApprovedDocx());
    storageGetMock.mockRejectedValue(new Error("connection reset"));

    expect(await signValuationAction("v1")).toEqual({
      error: withCode("Nie udało się odczytać zatwierdzonego operatu — spróbuj ponownie."),
    });
    expect(signMock).not.toHaveBeenCalled();
  });
});
