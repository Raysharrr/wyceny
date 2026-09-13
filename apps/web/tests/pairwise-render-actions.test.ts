import { beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { pairwiseReference } from "./fixtures/pairwise-document-fixture";
import { approvableInput, confirmedProseFor } from "./fixtures/valuation-inputs";
import { pairwiseBasis } from "../src/domain/pairwise-state";
import type { Valuation } from "../src/ports/valuation";
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "s4-owner", role: "appraiser" } })),
}));
vi.mock("@/app/valuations/_deps");
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { previewOperat } from "../src/app/actions/preview-operat";
import { approveValuation } from "../src/app/actions/approve-valuation";
import { signValuationAction } from "../src/app/actions/sign-valuation";
import {
  worker,
  storage,
  valuationRepository,
  profileRepository,
  proseProposal,
} from "@/app/valuations/_deps";
import { StorageNotFoundError } from "../src/ports/storage";
const textOf = (buf: Buffer) =>
  new PizZip(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();
const signature = fs.readFileSync("tests/fixtures/signature-synthetic.png");
let current: Valuation;
beforeEach(() => {
  vi.clearAllMocks();
  const inputs = {
    ...pairwiseReference("a"),
    methodConfirmed: true,
    provenance: approvableInput("s4-owner").inputs!.provenance,
  };
  inputs.comparables = inputs.comparables.map((c) => ({ ...c, status: "confirmed" }));
  inputs.pairwise!.confirmedBasis = pairwiseBasis(inputs);
  inputs.prose = confirmedProseFor("ul. Testowa 1, Nowogród", inputs);
  current = {
    ...approvableInput("s4-owner"),
    id: "s4-render",
    address: "ul. Testowa 1, Nowogród",
    area: inputs.area,
    inputs,
    wr: 740900,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    mapsFrozenFor: null,
    createdAt: new Date("2026-09-13"),
  } as Valuation;
  vi.mocked(valuationRepository.get).mockImplementation(async () => current);
  vi.mocked(valuationRepository.freezeMaps).mockImplementation(async () => current);
  vi.mocked(valuationRepository.approve).mockImplementation(async () => {
    current = {
      ...current,
      status: "approved",
      approvedAt: new Date(),
      docUrl: "/api/docs/s4.pdf",
      docxUrl: "/api/docs/s4.docx",
    };
    return current;
  });
  vi.mocked(valuationRepository.sign).mockImplementation(async () => ({
    ...current,
    status: "signed",
  }));
  vi.mocked(storage.put).mockImplementation(async (key) => `/api/docs/${key}`);
  vi.mocked(storage.get).mockRejectedValue(new StorageNotFoundError("absent"));
  vi.mocked(worker.amountInWords).mockResolvedValue(
    "siedemset czterdzieści tysięcy dziewięćset złotych",
  );
  vi.mocked(worker.convertToPdf).mockResolvedValue(Buffer.from("isolated-conversion-stub"));
  vi.mocked(profileRepository.getSignature).mockResolvedValue({
    bytes: signature,
    mime: "image/png",
  });
});
describe("PP production action dispatch", () => {
  it.each(["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const)(
    "preview → approve → sign uses PP for %s",
    async (propertyRight) => {
      current.propertyRight = propertyRight;
      expect(await previewOperat(current.id, { skipMaps: true })).not.toHaveProperty("error");
      expect(await approveValuation(current.id, { skipMaps: true })).toBeUndefined();
      expect(await signValuationAction(current.id)).toBeUndefined();
      const docs = vi.mocked(worker.convertToPdf).mock.calls.map(([buf]) => textOf(buf));
      expect(docs).toHaveLength(3);
      for (const text of docs) {
        expect(text.replace(/\u00a0/g, " ")).toContain("740 900");
        expect(text).toContain("Tabela 3. Obliczenie skorygowanej");
      }
      expect(docs[2]).toBe(docs[1]);
      expect(
        vi.mocked(worker.amountInWords).mock.calls.every(([amount]) => amount === 740900),
      ).toBe(true);
      expect(proseProposal.fetchProposal).not.toHaveBeenCalled();
    },
  );
  it("incomplete PP never reaches conversion or approval", async () => {
    current.inputs!.pairwise!.comparisons[current.inputs!.pairwise!.selectedComparableIds[0]][
      current.inputs!.features[0].key!
    ].multiplier = null;
    expect(await previewOperat(current.id, { skipMaps: true })).toHaveProperty("error");
    expect(await approveValuation(current.id, { skipMaps: true })).toHaveProperty("error");
    expect(worker.convertToPdf).not.toHaveBeenCalled();
    expect(valuationRepository.approve).not.toHaveBeenCalled();
  });
  it.each([0, 1])(
    "signs the pre-update fractional approval %i against the frozen 9b text hash",
    async (i) => {
      const record = JSON.parse(
        fs.readFileSync("../../tools/spike/2026-09-13-legacy-render/baseline.json", "utf8"),
      ).records[i];
      const input = record.input;
      input.inputs.features[0].key = "retired-legacy-key"; // Never revalidate archived catalog keys.
      current = {
        ...current,
        ...input,
        status: "approved",
        approvedAt: new Date(input.approvedAt),
        docxUrl: "/api/docs/old.docx",
        docUrl: "/api/docs/old.pdf",
      };
      vi.mocked(worker.amountInWords).mockResolvedValue(input.amountInWords);
      expect(await signValuationAction(current.id)).toBeUndefined();
      const doc = vi.mocked(worker.convertToPdf).mock.calls[0][0];
      expect(createHash("sha256").update(textOf(doc)).digest("hex")).toBe(record.textSha256);
    },
  );
});
