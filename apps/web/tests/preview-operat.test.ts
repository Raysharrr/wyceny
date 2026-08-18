import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import type { Valuation } from "../src/ports/valuation";
import type { Step1Input } from "../src/app/actions/wizard-schemas";
import { approvableInput, confirmedProseFor } from "./fixtures/valuation-inputs";
import { PROSE_SECTIONS, PROSE_SECTION_LABEL } from "../src/domain/prose-snapshot";

/**
 * TDD for `previewOperat` (Slice 14, Task 9): step 7 stops asking the
 * appraiser to take responsibility for a document they cannot see, and
 * renders the real thing instead.
 *
 * Mock pattern mirrors approve-valuation-action.test.ts: `_deps` is
 * automocked so repo/worker/storage/maps become controllable `vi.fn()`s and
 * no Postgres or HTTP call ever leaves the test process. What is NOT mocked
 * here is the state itself — the repo fake below keeps ONE mutable
 * valuation, so `saveSubjectAction` really does move the address that the
 * second test then previews against. Stubbing `get` with a fixed object
 * would have made that test pass without the production code ever comparing
 * anything.
 *
 * Storage is a real in-memory map for the same reason: the freeze is a
 * claim about bytes under the map keys, and a `put`/`get` pair that never
 * talk to each other cannot falsify it.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import { previewOperat } from "../src/app/actions/preview-operat";
import { approveValuation } from "../src/app/actions/approve-valuation";
import { saveSubjectAction } from "../src/app/actions/wizard";
import {
  storage,
  valuationRepository,
  worker,
  mapImages,
  proseProposal,
} from "@/app/valuations/_deps";
import { StorageNotFoundError } from "@/ports/storage";

const getMock = vi.mocked(valuationRepository.get);
const approveMock = vi.mocked(valuationRepository.approve);
const saveSubjectMock = vi.mocked(valuationRepository.saveSubject);
const freezeMapsMock = vi.mocked(valuationRepository.freezeMaps);
const amountInWordsMock = vi.mocked(worker.amountInWords);
const convertToPdfMock = vi.mocked(worker.convertToPdf);
const storagePutMock = vi.mocked(storage.put);
const storageGetMock = vi.mocked(storage.get);
const storageDeleteMock = vi.mocked(storage.delete);
const fetchMapsMock = vi.mocked(mapImages!.fetchMaps);
const fetchProposalMock = vi.mocked(proseProposal.fetchProposal);

// Synthetic 1x1 images (F-9: no real map data in fixtures) — same fixture
// bytes as approve-valuation-action.test.ts.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
  "base64",
);

const ID = "11111111-2222-3333-4444-555555555555";
const ADDRESS = "ul. Klonowa 5, Nowogród";
const NEW_ADDRESS = "ul. Brzozowa 8/21, Nowogród";

const EWIDENCYJNA_KEY = `mapa-ewidencyjna-${ID}.png`;
const ORTO_KEY = `mapa-orto-${ID}.jpg`;
const PREVIEW_KEY = `podglad-${ID}.pdf`;

const subjectInput: Step1Input = {
  address: ADDRESS,
  area: 71.63,
  purpose: "sprzedaz",
  kwNumber: "KW-TEST-1",
  client: "Jan Testowy",
};

function draft(): Valuation {
  const inputs = approvableInput("test-user").inputs!;
  return {
    id: ID,
    address: ADDRESS,
    area: 71.63,
    wr: 1_044_400,
    inputs: { ...inputs, prose: confirmedProseFor(ADDRESS, inputs) },
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
}

/**
 * Moves the draft to `address` in the state the wizard would leave behind
 * after the appraiser corrects it: step 1 nulls `wr`, so steps 5 and 6 have to
 * be redone, and the descriptions are re-confirmed against the new facts.
 * Without that the F-4 gate would refuse before approve ever reaches its maps.
 */
function reconfirmAt(address: string) {
  const inputs = approvableInput("test-user").inputs!;
  current = {
    ...current,
    address,
    wr: 1_044_400,
    inputs: { ...inputs, prose: confirmedProseFor(address, inputs) },
  };
}

/**
 * The repo's freeze write, as the adapter performs it. Named so a test can put
 * it back after forcing the `null` return (a write that legitimately did not
 * happen — see the tests that use it).
 *
 * The status predicate is the adapter's, not decoration: `valuation-drizzle.ts`
 * scopes the UPDATE with `and(eq(id), eq(status, "in_progress"))` and returns
 * `null` when it matches nothing. Without it here, the ONE cause of `null` that
 * a concurrent approve produces cannot be reproduced in this file at all, and
 * the interleaving probe below would be a stub asserting on itself.
 */
const freezeMapsFake = async (_id: string, _user: unknown, address: string | null) => {
  if (current.status !== "in_progress") return null;
  current = { ...current, mapsFrozenFor: address };
  return current;
};

/** The one row every mock below reads and writes — see the file docstring. */
let current: Valuation;
/** The one blob store, so a freeze can be falsified by deleting its bytes. */
let blobs: Map<string, Buffer | string>;

const generatedMedia = (buf: Buffer) =>
  Object.keys(new PizZip(buf).files).filter((f) => /^word\/media\/image_generated_/.test(f));

const docText = (buf: Buffer) =>
  new PizZip(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "")
    .replace(/\u00A0/g, " ");

beforeEach(() => {
  current = draft();
  blobs = new Map();

  for (const mock of [
    getMock,
    approveMock,
    saveSubjectMock,
    freezeMapsMock,
    amountInWordsMock,
    convertToPdfMock,
    storagePutMock,
    storageGetMock,
    storageDeleteMock,
    fetchMapsMock,
    fetchProposalMock,
  ]) {
    mock.mockReset();
  }

  getMock.mockImplementation(async () => current);
  saveSubjectMock.mockImplementation(async (_id, _user, u) => {
    current = { ...current, address: u.address, area: u.area, wr: null };
    return current;
  });
  freezeMapsMock.mockImplementation(freezeMapsFake);

  storagePutMock.mockImplementation(async (key, data) => {
    blobs.set(key, data);
    return `/api/docs/${key}`;
  });
  storageGetMock.mockImplementation(async (key) => {
    const data = blobs.get(key);
    if (data === undefined) throw new StorageNotFoundError(`missing: ${key}`);
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  });
  storageDeleteMock.mockImplementation(async (key) => {
    blobs.delete(key);
  });

  amountInWordsMock.mockResolvedValue("jeden milion czterdzieści cztery tysiące czterysta złotych");
  convertToPdfMock.mockResolvedValue(Buffer.from("%PDF-1.7 podgląd"));
  fetchMapsMock.mockResolvedValue({ kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } });
});

describe("previewOperat — the render and its frozen maps (Task 9)", () => {
  it("fetches the maps once and freezes them on the valuation", async () => {
    await previewOperat(ID);
    await previewOperat(ID);

    expect(fetchMapsMock).toHaveBeenCalledTimes(1);
    expect(current.mapsFrozenFor).toBe(ADDRESS);
    expect(blobs.has(EWIDENCYJNA_KEY)).toBe(true);
    expect(blobs.has(ORTO_KEY)).toBe(true);
  });

  it("a changed address unfreezes them — the map must show THIS parcel", async () => {
    // Maps are derived from the address: geokoder -> parcel -> bbox -> WMS.
    // Before this plan they were fetched at approval, so an address edit always
    // got fresh ones. Freezing them at preview introduces the failure this test
    // exists to prevent: previewing, correcting the address, then issuing a
    // signed operat carrying the PREVIOUS parcel's cadastral map and orthophoto.
    await previewOperat(ID);

    const saved = await saveSubjectAction(ID, { ...subjectInput, address: NEW_ADDRESS });
    expect(saved).toEqual({ ok: true });

    fetchMapsMock.mockClear();
    await previewOperat(ID);

    expect(fetchMapsMock).toHaveBeenCalledTimes(1);
    expect(fetchMapsMock).toHaveBeenCalledWith(NEW_ADDRESS);
    expect(current.mapsFrozenFor).toBe(NEW_ADDRESS);
  });

  it("never calls the language model", async () => {
    await previewOperat(ID);

    expect(fetchProposalMock).not.toHaveBeenCalled();
  });

  it("renders the document itself — two maps embedded, PDF stored under a stable key", async () => {
    const result = await previewOperat(ID);

    expect(result).toEqual({ url: expect.stringContaining(`/api/podglad/${ID}`) });
    const docx = convertToPdfMock.mock.calls[0][0];
    expect(generatedMedia(docx)).toHaveLength(2);
    expect(blobs.get(PREVIEW_KEY)).toEqual(Buffer.from("%PDF-1.7 podgląd"));
  });

  it("the URL changes when the rendered document does — the reader must not re-serve a stale render", async () => {
    const first = await previewOperat(ID);
    convertToPdfMock.mockResolvedValue(Buffer.from("%PDF-1.7 podgląd po poprawce"));
    const second = await previewOperat(ID);

    expect(first).toHaveProperty("url");
    expect(second).toHaveProperty("url");
    expect((second as { url: string }).url).not.toBe((first as { url: string }).url);
  });

  // Task 11: the second — and last — difference between the preview and the
  // issued operat (spec §C). A section the appraiser has not written yet is
  // passed over in silence when the document is issued; here it has to be
  // visible, or step 7 asks them to take responsibility for a document whose
  // gaps it hid from them. Read from the docx handed to the PDF converter,
  // i.e. the bytes the preview is actually made of.
  it("marks every section the appraiser has not written yet (Task 11)", async () => {
    current = { ...current, inputs: { ...current.inputs!, prose: null } };

    await previewOperat(ID);

    const text = docText(convertToPdfMock.mock.calls[0][0]);
    for (const section of PROSE_SECTIONS) {
      expect(text, section).toContain(`${PROSE_SECTION_LABEL[section]} — brak treści`);
    }
  });

  it("marks nothing in a draft whose six sections are written", async () => {
    await previewOperat(ID);

    expect(docText(convertToPdfMock.mock.calls[0][0])).not.toContain("brak treści");
  });

  it("approves nothing and writes no issued-document key (F-4)", async () => {
    await previewOperat(ID);

    expect(approveMock).not.toHaveBeenCalled();
    const writtenKeys = storagePutMock.mock.calls.map(([key]) => key);
    expect(writtenKeys).not.toContain(`operat-${ID}.pdf`);
    expect(writtenKeys).not.toContain(`operat-${ID}.docx`);
    expect(current.docUrl).toBeNull();
    expect(current.docxUrl).toBeNull();
  });

  it("refuses on a valuation that is no longer a draft", async () => {
    current = { ...current, status: "approved" };

    const result = await previewOperat(ID);

    expect(result).toEqual({ error: expect.stringContaining("zatwierdzona") });
    expect(convertToPdfMock).not.toHaveBeenCalled();
  });

  it("re-fetches when the frozen bytes are gone — the freeze is a claim about storage", async () => {
    await previewOperat(ID);
    blobs.delete(ORTO_KEY);

    fetchMapsMock.mockClear();
    await previewOperat(ID);

    expect(fetchMapsMock).toHaveBeenCalledTimes(1);
  });

  it("a maps failure stops the render and offers the choice, like approval does", async () => {
    fetchMapsMock.mockResolvedValue({ kind: "unavailable", message: "Geoportal nie odpowiada." });

    const result = await previewOperat(ID);

    expect(result).toEqual({
      error: expect.stringContaining("Geoportal nie odpowiada."),
      mapsUnavailable: true,
    });
    expect(convertToPdfMock).not.toHaveBeenCalled();
    expect(current.mapsFrozenFor).toBeNull();
  });

  it("skipMaps renders without maps, drops the frozen bytes and lifts the freeze", async () => {
    await previewOperat(ID);
    expect(current.mapsFrozenFor).toBe(ADDRESS);

    fetchMapsMock.mockClear();
    const result = await previewOperat(ID, { skipMaps: true });

    expect(result).toHaveProperty("url");
    expect(fetchMapsMock).not.toHaveBeenCalled();
    expect(generatedMedia(convertToPdfMock.mock.calls.at(-1)![0])).toHaveLength(0);
    expect(blobs.has(EWIDENCYJNA_KEY)).toBe(false);
    expect(blobs.has(ORTO_KEY)).toBe(false);
    expect(current.mapsFrozenFor).toBeNull();
  });

  it("an approve that fails after storing maps cannot leave the marker on the old address", async () => {
    // The whole sequence, with no concurrency anywhere in it: preview at A
    // freezes maps for A; the appraiser corrects the address to B and redoes
    // steps 5-6 as the wizard forces them to; approve fetches and stores maps
    // for B and then fails (conversion here, but photos or the drift check do
    // just as well); the appraiser reverts to A. If approve stored bytes for B
    // while leaving the marker on A, the next preview would reuse B's parcel
    // under address A — and once Task 12 pairs issuing with the freeze, so
    // would the signed operat.
    await previewOperat(ID);
    expect(current.mapsFrozenFor).toBe(ADDRESS);

    reconfirmAt(NEW_ADDRESS);
    convertToPdfMock.mockRejectedValueOnce(new Error("konwersja padła"));
    const failed = await approveValuation(ID);
    expect(failed).toEqual({ error: expect.stringContaining("Nie udało się wygenerować operatu") });
    expect(current.status).toBe("in_progress");
    // The bytes under the map keys are B's now, so the marker must say B.
    expect(current.mapsFrozenFor).toBe(NEW_ADDRESS);

    reconfirmAt(ADDRESS);
    fetchMapsMock.mockClear();
    await previewOperat(ID);

    expect(fetchMapsMock).toHaveBeenCalledTimes(1);
    expect(fetchMapsMock).toHaveBeenCalledWith(ADDRESS);
  });

  it("an unfreeze that quietly did nothing leaves the bytes alone too", async () => {
    // `freezeMaps` is owner-only (valuation-drizzle.ts) while this action
    // authorises through `get`, which also admits an admin — so an admin
    // previewing someone else's draft with skipMaps gets `null` back, not a
    // throw. Deleting the bytes on the strength of a write that never
    // happened would leave the owner's marker standing over nothing.
    await previewOperat(ID);
    freezeMapsMock.mockResolvedValue(null);

    const result = await previewOperat(ID, { skipMaps: true });

    expect(result).toHaveProperty("url");
    expect(generatedMedia(convertToPdfMock.mock.calls.at(-1)![0])).toHaveLength(0);
    expect(current.mapsFrozenFor).toBe(ADDRESS);
    expect(blobs.has(EWIDENCYJNA_KEY)).toBe(true);
    expect(blobs.has(ORTO_KEY)).toBe(true);
  });

  it("a freeze that does not take takes its bytes with it", async () => {
    // The mirror of the test above: there the marker was written and the bytes
    // were not, here the bytes are written and the marker is not. `freezeMaps`
    // is owner-only while this action authorises through `get`, which admits an
    // admin, so `null` comes back without a throw. Same ending if the new bytes
    // were left under the old marker: revert the address and the next preview —
    // and, after Task 12, the signed operat — shows the other parcel.
    await previewOperat(ID);
    reconfirmAt(NEW_ADDRESS);
    freezeMapsMock.mockResolvedValue(null);

    await previewOperat(ID);

    // The marker still describes address A, so nothing may be left claiming to
    // be its maps: the bytes just written are B's.
    expect(current.mapsFrozenFor).toBe(ADDRESS);
    expect(blobs.has(EWIDENCYJNA_KEY)).toBe(false);
    expect(blobs.has(ORTO_KEY)).toBe(false);

    freezeMapsMock.mockImplementation(freezeMapsFake);
    reconfirmAt(ADDRESS);
    fetchMapsMock.mockClear();
    await previewOperat(ID);

    expect(fetchMapsMock).toHaveBeenCalledTimes(1);
    expect(fetchMapsMock).toHaveBeenCalledWith(ADDRESS);
  });

  it("a preview still in flight must not delete the maps an approve just froze for the issue", async () => {
    // The window Task 10 opened. Step 7 renders on MOUNT, so a preview is
    // running whenever the appraiser opens or reloads that screen — including
    // while an approve, started from another tab, is committing. Both write
    // the same two map keys.
    //
    // The interleave is real rather than stubbed: the preview is suspended
    // INSIDE its own `fetchMaps` (3-6 s against the Geoportal in production)
    // and the approve runs to completion underneath it. `freezeMaps` then
    // returns `null` for the one cause this file could not previously
    // reproduce — the row stopped being a draft — and the bytes under those
    // keys are no longer the preview's to remove: `signValuationAction` reads
    // exactly them, and reads their absence as "approved without maps",
    // silently. Deleting them here would put an illustrated operat in the
    // record and an unillustrated one under the signature.
    let releaseMaps!: () => void;
    const wmsGate = new Promise<void>((resolve) => {
      releaseMaps = resolve;
    });
    fetchMapsMock.mockImplementationOnce(async () => {
      await wmsGate;
      return { kind: "ok", maps: { ewidencyjna: PNG_1PX, orto: JPG_1PX } };
    });
    approveMock.mockImplementation(async (_id, _user, docs) => {
      current = {
        ...current,
        status: "approved",
        approvedAt: new Date("2026-08-18T10:00:00.000Z"),
        docUrl: docs?.docUrl ?? null,
        docxUrl: docs?.docxUrl ?? null,
      };
      return current;
    });

    const inFlight = previewOperat(ID);
    // Nothing else awaits the gate, so the approve below is what runs while
    // the preview sits inside the WMS call.
    expect(await approveValuation(ID)).toBeUndefined();
    expect(current.status).toBe("approved");
    expect(blobs.has(EWIDENCYJNA_KEY)).toBe(true);

    releaseMaps();
    const result = await inFlight;

    // The bytes the signature will re-render from are still there.
    expect(blobs.has(EWIDENCYJNA_KEY)).toBe(true);
    expect(blobs.has(ORTO_KEY)).toBe(true);
    expect(current.mapsFrozenFor).toBe(ADDRESS);
    // And the appraiser's screen does not break because they approved
    // underneath it: the render completes and hands back a URL. That URL is
    // dead on arrival — `/api/podglad/[id]` refuses a non-draft (Task 9) — and
    // that is the design: the flat view has the issued operat by then.
    expect(result).toHaveProperty("url");
  });

  it("skipMaps lifts the freeze before it drops the bytes — never bytes gone under a standing marker", async () => {
    await previewOperat(ID);
    freezeMapsMock.mockRejectedValue(new Error("baza padła"));

    await previewOperat(ID, { skipMaps: true });

    // The unfreeze failed, so the marker still stands — and the bytes it
    // claims must therefore still be there. The reverse order would have left
    // the valuation claiming maps it no longer has.
    expect(current.mapsFrozenFor).toBe(ADDRESS);
    expect(blobs.has(EWIDENCYJNA_KEY)).toBe(true);
    expect(blobs.has(ORTO_KEY)).toBe(true);
  });
});
