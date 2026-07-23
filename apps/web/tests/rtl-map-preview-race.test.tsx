// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives in the full form touch on mount.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// This test needs address-blur autofetch ENABLED (the race lives in the
// autofetch path) — unlike rtl-features-section.test.tsx, which turns it
// off. Explicitly clear it rather than relying on it being unset: vitest can
// reuse a worker process across test files, and that file assigns it via a
// direct module-scope `process.env.X = "off"`, which — unlike `vi.stubEnv`
// — isn't reset between files.
process.env.NEXT_PUBLIC_SUBJECT_AUTOFETCH = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The parent form imports these; rendering the real <SubjectForm/> pulls
// every module it touches that hits the network, the DB, or `next/navigation`
// — mocked here to pure stubs. `@/app/actions/wizard-schemas` (step1Schema's
// real home — pure zod, no I/O) is NOT mocked: it's safe to import for real,
// unlike `wizard.ts` itself, which also pulls in `getSession`/`_deps` (DB
// pool, session store). Mirrors tests/rtl-subject-form.test.tsx.
vi.mock("@/app/actions/wizard", () => ({
  createDraft: vi.fn(async () => undefined),
  saveSubjectAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/mint-kw-token", () => ({
  mintKwUploadToken: vi.fn(async () => ({ token: "exp.nonce.sig" })),
}));
vi.mock("@/lib/kw-extract-client", () => ({ extractKw: vi.fn() }));

const getSubjectDataMock = vi.fn();
const getMapPreviewMock = vi.fn();
vi.mock("@/app/actions/get-subject-data", () => ({
  getSubjectData: (...a: unknown[]) => getSubjectDataMock(...a),
}));
vi.mock("@/app/actions/get-map-preview", () => ({
  getMapPreview: (...a: unknown[]) => getMapPreviewMock(...a),
}));

import { SubjectForm } from "@/app/valuations/new/subject-form";

const proposal = (obreb: string) => ({
  proposal: {
    parcel: { parcelId: "x", obreb, arkusz: "1", nrDzialki: "1", powEwidHa: 0.1, uzytek: "B" },
    building: null,
    mpzp: null,
    meta: {
      x: 1,
      y: 2,
      teryt: "306401",
      fetchedAt: "2026-07-22T10:00:00Z",
      source: "t",
      mpzpAbsent: true,
    },
  },
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("map preview race (Slice 9 follow-up)", () => {
  it("drops a stale map-preview response when a newer address fetch started", async () => {
    const first = deferred<{ ewidencyjna: string; orto: string }>();
    getSubjectDataMock.mockResolvedValue(proposal("Jeżyce"));
    getMapPreviewMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      ewidencyjna: "bmV3ZXI=",
      orto: "bmV3ZXIy",
    });

    render(<SubjectForm />);
    const address = screen.getByLabelText(/Adres/);
    fireEvent.change(address, { target: { value: "Kościelna 33" } });
    fireEvent.blur(address);
    await waitFor(() => expect(getMapPreviewMock).toHaveBeenCalledTimes(1));

    fireEvent.change(address, { target: { value: "Zmyślona 40" } });
    fireEvent.blur(address);
    await waitFor(() => expect(getMapPreviewMock).toHaveBeenCalledTimes(2));
    // newer preview settled first…
    await waitFor(() =>
      expect((screen.getByAltText("Mapa ewidencyjna działki") as HTMLImageElement).src).toContain(
        "bmV3ZXI=",
      ),
    );
    // …then the STALE first response resolves late — must NOT clobber it
    first.resolve({ ewidencyjna: "c3RhbGU=", orto: "c3RhbGUy" });
    await waitFor(() =>
      expect((screen.getByAltText("Mapa ewidencyjna działki") as HTMLImageElement).src).toContain(
        "bmV3ZXI=",
      ),
    );
    expect((screen.getByAltText("Mapa ewidencyjna działki") as HTMLImageElement).src).not.toContain(
      "c3RhbGU=",
    );
  });
});
