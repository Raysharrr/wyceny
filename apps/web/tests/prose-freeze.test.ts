import { describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import type { Valuation } from "../src/ports/valuation";
import type { ProseSnapshot } from "../src/domain/prose-snapshot";
import {
  FIXTURE_COVER_PHOTO_KEY,
  approvableInput,
  approvableWr,
  confirmedProseFor,
} from "./fixtures/valuation-inputs";

/**
 * Freeze (Task 7): the operat's prose is rendered from the SNAPSHOT and from
 * nothing else. An LLM is not reproducible — asking it again at sign would
 * produce a different document under the same signature — so the approved
 * text and the signed text must come from one and the same `inputs.prose`.
 *
 * Two properties, both checked below on one valuation walked through approve
 * → sign with the same mocked deps:
 *  1. neither path ever asks the worker for prose (no regeneration, no bill);
 *  2. the signed document carries the approved prose.
 *
 * Since ADR-020 wariant (a), (2) holds by construction rather than by
 * agreement: signing renders nothing at all — it puts the scan on the DOCX the
 * approval stored — so the build below runs exactly once, at approve. Storage
 * here really remembers what approve wrote, so the handoff is exercised on the
 * actual bytes rather than on a mock returning something plausible.
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
  // I-21: the amount must be the one this snapshot produces — a fixture that
  // invents a number now trips `documentInputFor` (ADR-016).
  wr: approvableWr(),
  inputs: { ...approvableInput("test-user").inputs!, prose: PROSE },
  amountInWords: null,
  docUrl: null,
  docxUrl: null,
  purpose: "sprzedaz",
  propertyRight: "wlasnosc_lokalu",
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
    // Storage that remembers: the DOCX approve writes is the one sign reads.
    const blobs = new Map<string, Buffer>();
    // Zdjęcie z manifestu fikstury (B-01, M-1) leży w tym samym storage, bo
    // zatwierdzenie czyta bajty każdego klucza z oględzin i bez nich przerywa —
    // nie dochodząc do prozy, o którą tu chodzi.
    blobs.set(FIXTURE_COVER_PHOTO_KEY, SIGNATURE_PNG);
    vi.mocked(storage.put).mockImplementation(async (key: string, bytes: string | Buffer) => {
      blobs.set(key, bytes as Buffer);
      return `/api/docs/${key}`;
    });
    // No frozen maps for this valuation: "approved without maps" is the one
    // silent absence, and it keeps this test about the prose.
    vi.mocked(storage.get).mockImplementation(async (key: string) => {
      const bytes = blobs.get(key);
      if (!bytes) throw new StorageNotFoundError(key);
      return bytes;
    });
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
    // The row as the adapter returns it: the approval's own issue date and the
    // URLs of the files it just wrote — which is what sign reads them by.
    approveMock.mockImplementation(async (_id, _user, urls, now) => ({
      ...approved,
      ...urls,
      approvedAt: now ?? approved.approvedAt,
    }));
    expect(await approveValuation(draft.id)).toBeUndefined();

    const approvedRow = await approveMock.mock.results[0].value;
    getMock.mockResolvedValue(approvedRow);
    signMock.mockResolvedValue({ ...approvedRow, status: "signed", signedAt: new Date() });
    expect(await signValuationAction(approvedRow.id)).toBeUndefined();

    // Once, at approve: signing renders nothing, so there is no second build
    // that could be handed a different prose.
    expect(documentInputs).toHaveLength(1);
    expect(documentInputs[0].inputs.prose).toEqual(PROSE);

    // And the signed DOCX is the approved one with a signature added: its
    // paragraphs are the approved paragraphs, byte-for-byte where they were
    // not touched. This is a legal document.
    const signedDocx = vi
      .mocked(storage.put)
      .mock.calls.find(([key]) => key.endsWith("-signed.docx"))?.[1] as Buffer;
    const approvedDocx = blobs.get(approvedRow.docxUrl!.replace("/api/docs/", "")) as Buffer;
    const textOf = (buf: Buffer) =>
      new PizZip(buf)
        .file("word/document.xml")!
        .asText()
        .replace(/<[^>]+>/g, "");
    expect(textOf(signedDocx)).toBe(textOf(approvedDocx));

    // The generator is never consulted on either path — the only prose in the
    // operat is the one the appraiser accepted on step 6.
    expect(fetchProposalMock).not.toHaveBeenCalled();
  });
});
