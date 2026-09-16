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
const saveInspectionNoteField = vi.fn();
const uploadInspectionPhoto = vi.fn();
vi.mock("@/app/actions/inspection", () => ({
  removeInspectionPhoto: (...args: unknown[]) => removeInspectionPhoto(...args),
  saveInspectionNoteField: (...args: unknown[]) => saveInspectionNoteField(...args),
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

/** ADR-017: the six note fields, labelled as the appraiser sees them. */
const NOTE_FIELD_LABELS = [
  ["otoczenie", "Otoczenie"],
  ["budynek", "Budynek"],
  ["lokalUklad", "Lokal — układ"],
  ["wykonczenie", "Wykończenie"],
  ["zagospodarowanie", "Zagospodarowanie działki"],
  ["uwagi", "Uwagi"],
] as const;

const snapshotWithPhotos = (): InspectionSnapshot => ({
  note: null,
  photos: {
    otoczenie: [`ogledziny-otoczenie-aaa-${VID}.jpg`],
    budynekZewn: [`ogledziny-budynek-bbb-${VID}.jpg`],
    wnetrza: [`ogledziny-wnetrza-ccc-${VID}.jpg`],
  },
});

describe("InspectionSection", () => {
  it("renders 3 sections, the six note fields, and the amber hint when total is 0", () => {
    render(<InspectionSection valuationId={VID} inspection={null} />);
    expect(screen.getByRole("heading", { name: "Otoczenie i droga dojazdowa" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Budynek z zewnątrz" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Wnętrza" })).toBeDefined();
    for (const [, label] of NOTE_FIELD_LABELS) {
      expect((screen.getByLabelText(label) as HTMLElement).tagName).toBe("TEXTAREA");
      expect(screen.getByRole("button", { name: `Zapisz: ${label}` })).toBeDefined();
    }
    // No single-note editor any more (ADR-017).
    expect(screen.queryByRole("button", { name: /zapisz notatkę/i })).toBeNull();
    expect(screen.queryByText("Dawna notatka — rozdziel na pola")).toBeNull();
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

  it.each(NOTE_FIELD_LABELS)(
    "field %s: its save button calls saveInspectionNoteField(id, field, value)",
    async (field, label) => {
      saveInspectionNoteField.mockResolvedValue(undefined);
      render(<InspectionSection valuationId={VID} inspection={null} />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText(label), "nowa treść");
      await user.click(screen.getByRole("button", { name: `Zapisz: ${label}` }));
      await waitFor(() =>
        expect(saveInspectionNoteField).toHaveBeenCalledWith(VID, field, "nowa treść"),
      );
      expect(saveInspectionNoteField).toHaveBeenCalledTimes(1);
    },
  );

  it("prefills each field from inspection.notes", () => {
    render(
      <InspectionSection
        valuationId={VID}
        inspection={{
          ...snapshotWithPhotos(),
          notes: { budynek: "Dźwig osobowy.", uwagi: "Właściciel obecny." },
        }}
      />,
    );
    expect((screen.getByLabelText("Budynek") as HTMLTextAreaElement).value).toBe("Dźwig osobowy.");
    expect((screen.getByLabelText("Uwagi") as HTMLTextAreaElement).value).toBe(
      "Właściciel obecny.",
    );
    expect((screen.getByLabelText("Otoczenie") as HTMLTextAreaElement).value).toBe("");
  });

  it("an old single note is shown read-only as 'Dawna notatka — rozdziel na pola', not copied into a field", () => {
    render(
      <InspectionSection
        valuationId={VID}
        inspection={{ ...snapshotWithPhotos(), note: "istniejąca dawna notatka" }}
      />,
    );
    expect(screen.getByText("Dawna notatka — rozdziel na pola")).toBeDefined();
    expect(screen.getByText("istniejąca dawna notatka")).toBeDefined();
    for (const [, label] of NOTE_FIELD_LABELS) {
      expect((screen.getByLabelText(label) as HTMLTextAreaElement).value).toBe("");
    }
    // Read-only: the old text is not in any editable control.
    expect(screen.queryByDisplayValue("istniejąca dawna notatka")).toBeNull();
  });

  // Module-level `uploadEnabled` is read once at import time (mirrors
  // kw-section.tsx's `uploadEnabled`), so a plain vi.stubEnv AFTER the
  // static top-of-file import has no effect — reset the module registry and
  // re-import under the stubbed env, scoped to this one test.
  it("NEXT_PUBLIC_PHOTO_UPLOAD=off hides ALL file inputs, note fields stay editable", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_PHOTO_UPLOAD", "off");
    try {
      const { InspectionSection: OffSection } =
        await import("@/app/valuations/[id]/inspection-section");
      render(<OffSection valuationId={VID} inspection={null} />);
      expect(screen.queryAllByLabelText(/dodaj zdjęcia/i)).toHaveLength(0);
      const textarea = screen.getByLabelText("Budynek") as HTMLTextAreaElement;
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

  it("mintKwUploadToken rejecting (network failure) shows an error and re-enables the file input (final review)", async () => {
    mintKwUploadToken.mockRejectedValue(new Error("network down"));

    render(<InspectionSection valuationId={VID} inspection={null} />);
    const input = screen.getByLabelText(
      /dodaj zdjęcia — otoczenie i droga dojazdowa/i,
    ) as HTMLInputElement;
    const file = new File(["fake-jpeg-bytes"], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /nie udało się przetworzyć zdjęcia — sprawdź połączenie/i,
      ),
    );
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("");
  });
});
