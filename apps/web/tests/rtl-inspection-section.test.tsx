// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InspectionSnapshot } from "@/domain/inspection";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives (Button) touch on mount.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  vi.clearAllMocks();
});

const removeInspectionPhoto = vi.fn();
const saveInspectionNote = vi.fn();
const uploadInspectionPhoto = vi.fn();
vi.mock("@/app/actions/inspection", () => ({
  removeInspectionPhoto: (...args: unknown[]) => removeInspectionPhoto(...args),
  saveInspectionNote: (...args: unknown[]) => saveInspectionNote(...args),
  uploadInspectionPhoto: (...args: unknown[]) => uploadInspectionPhoto(...args),
}));

const mintKwUploadToken = vi.fn();
vi.mock("@/app/actions/mint-kw-token", () => ({
  mintKwUploadToken: (...args: unknown[]) => mintKwUploadToken(...args),
}));

const processPhoto = vi.fn();
vi.mock("@/lib/photo-process-client", () => ({
  processPhoto: (...args: unknown[]) => processPhoto(...args),
}));

import { InspectionSection } from "@/app/valuations/[id]/inspection-section";

const VID = "11111111-2222-3333-4444-555555555555";

const snapshotWithPhotos = (): InspectionSnapshot => ({
  note: "istniejąca notatka",
  photos: {
    otoczenie: [`ogledziny-otoczenie-aaa-${VID}.jpg`],
    budynekZewn: [`ogledziny-budynek-bbb-${VID}.jpg`],
    wnetrza: [`ogledziny-wnetrza-ccc-${VID}.jpg`],
  },
});

describe("InspectionSection", () => {
  it("renders 3 sections, the note textarea, and the amber hint when total is 0", () => {
    render(<InspectionSection valuationId={VID} inspection={null} />);
    expect(screen.getByRole("heading", { name: "Otoczenie i droga dojazdowa" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Budynek z zewnątrz" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Wnętrza" })).toBeDefined();
    expect(screen.getByLabelText(/notatka z oględzin/i)).toBeDefined();
    const hint = screen.getByTestId("inspection-hint");
    expect(hint.textContent).toMatch(/operat bez dokumentacji fotograficznej/i);
  });

  it("renders thumbnails and the counter 3/50 for a snapshot with 3 keys; no amber hint", () => {
    const inspection = snapshotWithPhotos();
    render(<InspectionSection valuationId={VID} inspection={inspection} />);
    expect(screen.getByTestId("inspection-counter").textContent).toBe("3/50");
    const imgs = screen.getAllByRole("img") as HTMLImageElement[];
    expect(imgs).toHaveLength(3);
    expect(
      imgs.some((img) =>
        img
          .getAttribute("src")
          ?.includes(`/api/docs/${encodeURIComponent(inspection.photos.otoczenie[0])}`),
      ),
    ).toBe(true);
    expect(screen.queryByTestId("inspection-hint")).toBeNull();
  });

  it("remove button calls removeInspectionPhoto(id, section, key)", async () => {
    removeInspectionPhoto.mockResolvedValue(undefined);
    const inspection = snapshotWithPhotos();
    render(<InspectionSection valuationId={VID} inspection={inspection} />);
    const user = userEvent.setup();
    const [firstRemove] = screen.getAllByRole("button", { name: "Usuń zdjęcie" });
    await user.click(firstRemove);
    await waitFor(() => expect(removeInspectionPhoto).toHaveBeenCalled());
    const lastCall = removeInspectionPhoto.mock.calls.findLast(() => true);
    expect(lastCall).toEqual([VID, "otoczenie", inspection.photos.otoczenie[0]]);
  });

  it("note save button calls saveInspectionNote(id, value)", async () => {
    saveInspectionNote.mockResolvedValue(undefined);
    render(<InspectionSection valuationId={VID} inspection={null} />);
    const user = userEvent.setup();
    const textarea = screen.getByLabelText(/notatka z oględzin/i);
    await user.type(textarea, "nowa notatka");
    await user.click(screen.getByRole("button", { name: /zapisz notatkę/i }));
    await waitFor(() => expect(saveInspectionNote).toHaveBeenCalledWith(VID, "nowa notatka"));
  });

  // Module-level `uploadEnabled` is read once at import time (mirrors
  // kw-section.tsx's `uploadEnabled`), so a plain vi.stubEnv AFTER the
  // static top-of-file import has no effect — reset the module registry and
  // re-import under the stubbed env, scoped to this one test.
  it("NEXT_PUBLIC_PHOTO_UPLOAD=off hides ALL file inputs, note stays editable", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_PHOTO_UPLOAD", "off");
    try {
      const { InspectionSection: OffSection } =
        await import("@/app/valuations/[id]/inspection-section");
      render(<OffSection valuationId={VID} inspection={null} />);
      expect(screen.queryAllByLabelText(/dodaj zdjęcia/i)).toHaveLength(0);
      const textarea = screen.getByLabelText(/notatka z oględzin/i) as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(false);
      await userEvent.setup().type(textarea, "x");
      expect(textarea.value).toBe("x");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("upload flow: file select -> mintKwUploadToken -> processPhoto -> uploadInspectionPhoto, in order", async () => {
    const order: string[] = [];
    mintKwUploadToken.mockImplementation(async () => {
      order.push("mint");
      return { token: "exp.nonce.sig" };
    });
    processPhoto.mockImplementation(async () => {
      order.push("process");
      return { kind: "ok" as const, blob: new Blob(["x"], { type: "image/jpeg" }) };
    });
    uploadInspectionPhoto.mockImplementation(async () => {
      order.push("upload");
      return { key: `ogledziny-otoczenie-new-${VID}.jpg` };
    });

    render(<InspectionSection valuationId={VID} inspection={null} />);
    const input = screen.getByLabelText(
      /dodaj zdjęcia — otoczenie i droga dojazdowa/i,
    ) as HTMLInputElement;
    const file = new File(["fake-jpeg-bytes"], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadInspectionPhoto).toHaveBeenCalled());
    expect(order).toEqual(["mint", "process", "upload"]);

    const mintCall = mintKwUploadToken.mock.calls.findLast(() => true);
    expect(mintCall).toEqual([]);
    const processCall = processPhoto.mock.calls.findLast(() => true);
    expect(processCall?.[0]).toMatchObject({ file, token: "exp.nonce.sig" });
    const uploadCall = uploadInspectionPhoto.mock.calls.findLast(() => true);
    expect(uploadCall?.[0]).toBe(VID);
    expect(uploadCall?.[1]).toBe("otoczenie");
    expect(uploadCall?.[2]).toBeInstanceOf(FormData);
  });
});
