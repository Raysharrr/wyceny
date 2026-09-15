/**
 * R-2 (operat-bugfix, paczka 1): `documentInputFor` is the one place the
 * operat's `BuildDocumentInput` is assembled. Before it, approve, sign and the
 * step-7 preview each spelled the object out — and a field added to two of
 * the three means a signed document whose text differs from the approved one.
 *
 * Two halves: the mapping itself on today's fields, and the Server Actions run
 * on ONE valuation with `buildDocumentModel` observed, proving they hand it
 * the same input (the preview's `approvedAt` — today — being the only intended
 * difference, spec §C).
 *
 * Since ADR-020 wariant (a) that is approve and preview only: signing no
 * longer renders anything — it puts the scan on the DOCX the approval stored —
 * so drift cannot reach the signed document at all. That is asserted below as
 * the stronger claim it is: sign builds no model.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput, withConfirmedProse } from "./fixtures/valuation-inputs";

vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "u1", role: "appraiser" } })),
}));
vi.mock("@/app/valuations/_deps");
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// The render is not under test here — only what it is handed.
vi.mock("@/adapters/docx-render", () => ({
  renderOperatDocx: vi.fn(() => Buffer.from("docx")),
  // Signing is not under test here either — only that it renders nothing.
  signOperatDocx: vi.fn(() => Buffer.from("signed-docx")),
  UnsignableDocxError: class UnsignableDocxError extends Error {},
}));
vi.mock("@/domain/document-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/document-model")>();
  return { ...actual, buildDocumentModel: vi.fn(actual.buildDocumentModel) };
});

import { approveValuation } from "../src/app/actions/approve-valuation";
import { previewOperat } from "../src/app/actions/preview-operat";
import { signValuationAction } from "../src/app/actions/sign-valuation";
import { profileRepository, storage, valuationRepository, worker } from "@/app/valuations/_deps";
import { buildDocumentModel } from "@/domain/document-model";
import { documentInputFor } from "@/domain/document-input";
import { computeKcs } from "@/domain/kcs";

const ADDRESS = "Audit approvable";
const APPROVED_AT = new Date("2026-07-19T10:00:00.000Z");

const valuation = (overrides: Partial<Valuation> = {}): Valuation => ({
  id: "v1",
  address: ADDRESS,
  area: 40,
  wr: 400_000,
  inputs: withConfirmedProse(ADDRESS, approvableInput("u1").inputs!),
  amountInWords: null,
  docUrl: "/api/docs/operat-v1.pdf",
  docxUrl: "/api/docs/operat-v1.docx",
  purpose: "sprzedaz",
  propertyRight: "wlasnosc_lokalu",
  kwNumber: "PO1P/1/6",
  client: "Jan Testowy",
  inspectionDate: "2026-07-10",
  ownerId: "u1",
  status: "in_progress",
  approvedAt: APPROVED_AT,
  signedAt: null,
  supersedesId: null,
  mapsFrozenFor: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  ...overrides,
});

describe("documentInputFor — today's fields, verbatim", () => {
  it("maps the valuation and the render-time values onto BuildDocumentInput", () => {
    const v = valuation();
    const kcs = computeKcs(v.inputs!);

    expect(
      documentInputFor(v, { approvedAt: APPROVED_AT, kcs, amountInWords: "słownie" }),
    ).toStrictEqual({
      address: ADDRESS,
      area: 40,
      purpose: "sprzedaz",
      kwNumber: "PO1P/1/6",
      propertyRight: "wlasnosc_lokalu",
      client: "Jan Testowy",
      inspectionDate: "2026-07-10",
      approvedAt: APPROVED_AT,
      inputs: v.inputs,
      kcs,
      amountInWords: "słownie",
    });
  });

  it("keeps the coercions the actions applied: missing client/date → empty string, no KW → null", () => {
    const v = valuation({
      client: null,
      inspectionDate: null,
      kwNumber: null,
      propertyRight: "spoldzielcze_wlasnosciowe",
    });
    const input = documentInputFor(v, {
      approvedAt: APPROVED_AT,
      kcs: computeKcs(v.inputs!),
      amountInWords: "słownie",
    });

    expect(input.client).toBe("");
    expect(input.inspectionDate).toBe("");
    expect(input.kwNumber).toBeNull();
    expect(input.propertyRight).toBe("spoldzielcze_wlasnosciowe");
  });
});

describe("approve / sign / preview hand buildDocumentModel the same input (R-2)", () => {
  const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const build = vi.mocked(buildDocumentModel);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(worker.amountInWords).mockResolvedValue("czterysta tysięcy złotych");
    vi.mocked(worker.convertToPdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(storage.put).mockImplementation(async (key) => `/api/docs/${key}`);
    vi.mocked(storage.get).mockResolvedValue(undefined as never);
    vi.mocked(valuationRepository.freezeMaps).mockImplementation(async () => valuation());
    vi.mocked(valuationRepository.approve).mockImplementation(async () =>
      valuation({ status: "approved" }),
    );
    vi.mocked(valuationRepository.sign).mockImplementation(async () =>
      valuation({ status: "signed" }),
    );
    vi.mocked(profileRepository.getSignature).mockResolvedValue({
      bytes: PNG_1PX,
      mime: "image/png",
    } as never);
  });

  async function inputOf(run: () => Promise<unknown>) {
    build.mockClear();
    const result = (await run()) as { error?: string } | undefined;
    expect(result?.error, "the action refused").toBeUndefined();
    expect(build).toHaveBeenCalledTimes(1);
    return { input: build.mock.calls[0][0], opts: build.mock.calls[0][1] };
  }

  it("builds one input for both, apart from the preview's date", async () => {
    const draft = valuation();
    vi.mocked(valuationRepository.get).mockResolvedValue(draft);
    const approve = await inputOf(() => approveValuation("v1", { skipMaps: true }));
    const preview = await inputOf(() => previewOperat("v1", { skipMaps: true }));

    const withoutDate = (input: typeof approve.input) => ({ ...input, approvedAt: null });
    expect(withoutDate(preview.input)).toStrictEqual(withoutDate(approve.input));

    // Approve renders on the `now` it persists; only the preview may carry a flag.
    expect(vi.mocked(valuationRepository.approve).mock.calls[0][3]).toBe(approve.input.approvedAt);
    expect(approve.opts).toBeUndefined();
    expect(preview.opts).toEqual({ preview: true });
  });

  it("sign builds no model at all — the signed text is the approved file (ADR-020)", async () => {
    vi.mocked(valuationRepository.get).mockResolvedValue(valuation({ status: "approved" }));
    // The DOCX the approval stored; the action only puts the scan on it.
    vi.mocked(storage.get).mockResolvedValue(Buffer.from("approved-docx") as never);
    build.mockClear();

    const result = (await signValuationAction("v1")) as { error?: string } | undefined;

    // A refusal would make `not.toHaveBeenCalled()` vacuous — the signature
    // has to have gone through for the assertion to mean anything.
    expect(result?.error, "the action refused").toBeUndefined();
    expect(build).not.toHaveBeenCalled();
  });

  it("approve and preview assemble the input through documentInputFor, not by hand", () => {
    const sourceOf = (file: string) =>
      fs.readFileSync(path.join(__dirname, "../src/app/actions", file), "utf8");

    for (const file of ["approve-valuation.ts", "preview-operat.ts"]) {
      expect(sourceOf(file), file).toMatch(/\bdocumentInputFor\(/);
      expect(sourceOf(file), file).not.toMatch(/kwNumber:\s*valuation\.kwNumber/);
    }
    // Sign is on the other side of the same rule: a document input it does not
    // assemble is a document input that cannot drift from the approved one.
    const sign = sourceOf("sign-valuation.ts");
    expect(sign).not.toMatch(/\bdocumentInputFor\(/);
    expect(sign).not.toMatch(/\bbuildDocumentModel\(/);
    expect(sign).not.toMatch(/\brenderOperatDocx\(/);
  });
});
