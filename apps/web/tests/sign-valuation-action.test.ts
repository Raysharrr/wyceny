import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";

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

const getMock = vi.mocked(valuationRepository.get);
const signMock = vi.mocked(valuationRepository.sign);
const getSignatureMock = vi.mocked(profileRepository.getSignature);
const amountInWordsMock = vi.mocked(worker.amountInWords);
const convertToPdfMock = vi.mocked(worker.convertToPdf);
const storagePutMock = vi.mocked(storage.put);

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
});
