import { describe, expect, it, vi } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import type { ProseSnapshot } from "../src/domain/prose-snapshot";
import { approvableInput, confirmedProseFor } from "./fixtures/valuation-inputs";

/**
 * Freeze (Task 7): the operat's prose is rendered from the SNAPSHOT and from
 * nothing else. An LLM is not reproducible — asking it again at sign would
 * produce a different document under the same signature — so the approved
 * text and the signed text must come from one and the same `inputs.prose`.
 *
 * Two properties, both checked below on one valuation walked through approve
 * → sign with the same mocked deps:
 *  1. neither path ever asks the worker for prose (no regeneration, no bill);
 *  2. the document build receives the identical prose in both.
 *
 * `buildDocumentModel` is wrapped rather than replaced — the real one runs, we
 * only look at what it was handed. Today the model drops prose (T8 puts it in
 * the template), so this is where the property is observable at all; once T8
 * lands, `docx-render-signature.test.ts`'s text equality covers the printed
 * paragraphs for free.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const documentInputs: Array<{ inputs: { prose?: ProseSnapshot | null } }> = [];

vi.mock("@/domain/document-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/document-model")>();
  return {
    ...actual,
    // ...args, not just the first one: the function took a second parameter
    // in T11 (`{ preview: true }`), and a wrapper pinned to `[0]` would drop
    // it silently — this file would then be testing a render nobody performs.
    buildDocumentModel: (...args: Parameters<typeof actual.buildDocumentModel>) => {
      documentInputs.push(args[0] as { inputs: { prose?: ProseSnapshot | null } });
      return actual.buildDocumentModel(...args);
    },
  };
});

import { approveValuation } from "../src/app/actions/approve-valuation";
import { signValuationAction } from "../src/app/actions/sign-valuation";
import {
  mapImages,
  profileRepository,
  proseProposal,
  storage,
  valuationRepository,
  worker,
} from "@/app/valuations/_deps";
import { StorageNotFoundError } from "@/ports/storage";

const getMock = vi.mocked(valuationRepository.get);
const approveMock = vi.mocked(valuationRepository.approve);
const signMock = vi.mocked(valuationRepository.sign);
const fetchProposalMock = vi.mocked(proseProposal.fetchProposal);
const getSignatureMock = vi.mocked(profileRepository.getSignature);

const SIGNATURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PROSE = confirmedProseFor("ul. Zamrożona 2, Poznań", approvableInput("test-user").inputs!);

const draft: Valuation = {
  id: "valuation-freeze-1",
  address: "ul. Zamrożona 2, Poznań",
  area: 55,
  wr: 700_000,
  inputs: { ...approvableInput("test-user").inputs!, prose: PROSE },
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

const approved: Valuation = {
  ...draft,
  status: "approved",
  approvedAt: new Date("2026-07-15T10:00:00.000Z"),
  docUrl: `/api/docs/operat-${draft.id}.pdf`,
  docxUrl: `/api/docs/operat-${draft.id}.docx`,
};

describe("prose is frozen between approve and sign (Task 7)", () => {
  it("renders the approved and the signed operat from the identical snapshot, asking the worker nothing", async () => {
    documentInputs.length = 0;
    vi.mocked(worker.amountInWords).mockResolvedValue("siedemset tysięcy złotych");
    vi.mocked(worker.convertToPdf).mockResolvedValue(Buffer.from("pdf-bytes"));
    vi.mocked(storage.put).mockImplementation(async (key: string) => `/api/docs/${key}`);
    // No frozen maps for this valuation: "approved without maps" is the one
    // silent absence, and it keeps this test about the prose.
    vi.mocked(storage.get).mockRejectedValue(new StorageNotFoundError("no maps"));
    vi.mocked(mapImages!.fetchMaps).mockResolvedValue({
      kind: "ok",
      maps: { ewidencyjna: SIGNATURE_PNG, orto: SIGNATURE_PNG },
    });
    getSignatureMock.mockResolvedValue({ bytes: SIGNATURE_PNG, mime: "image/png" });
    // The freeze write answers with the saved row, as the adapter does —
    // `undefined` from a bare vi.fn() reads as "the write did not happen",
    // which approve refuses on rather than issue maps nothing claims.
    vi.mocked(valuationRepository.freezeMaps).mockImplementation(async (_id, _user, address) => ({
      ...draft,
      mapsFrozenFor: address,
    }));

    getMock.mockResolvedValue(draft);
    approveMock.mockResolvedValue(approved);
    expect(await approveValuation(draft.id)).toBeUndefined();

    getMock.mockResolvedValue(approved);
    signMock.mockResolvedValue({ ...approved, status: "signed", signedAt: new Date() });
    expect(await signValuationAction(approved.id)).toBeUndefined();

    expect(documentInputs).toHaveLength(2);
    const [atApprove, atSign] = documentInputs;
    expect(atApprove.inputs.prose).toEqual(PROSE);
    // Byte-for-byte, not merely equivalent: this is a legal document.
    expect(JSON.stringify(atSign.inputs.prose)).toBe(JSON.stringify(atApprove.inputs.prose));

    // The generator is never consulted on either path — the only prose in the
    // operat is the one the appraiser accepted on step 6.
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });
});
