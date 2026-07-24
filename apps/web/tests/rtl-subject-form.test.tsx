// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { z } from "zod";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import { EMPTY_SUBJECT } from "@/lib/subject-form";
import type { KcsInput } from "@/domain/kcs";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives in the full form touch on mount.
// Mirrors tests/rtl-kw-section.test.tsx.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// The address field's blur fires the EGiB/MPZP auto-fetch, which (with
// mocked getSubjectData) would throw. Same guard the e2e uses to stay
// network-free.
process.env.NEXT_PUBLIC_SUBJECT_AUTOFETCH = "off";

type FormInput = z.input<typeof valuationFormSchema>;

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// SubjectForm imports these; every module it touches that hits the network,
// the DB, or `next/navigation` is mocked to a pure stub. `@/app/actions/
// wizard-schemas` (step1Schema's real home — pure zod, no I/O) is NOT
// mocked: it's safe to import for real, unlike `wizard.ts` itself, which
// also pulls in `getSession`/`_deps` (DB pool, session store).
vi.mock("@/app/actions/wizard", () => ({
  createDraft: vi.fn(async () => undefined),
  saveSubjectAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/get-subject-data", () => ({ getSubjectData: vi.fn() }));
vi.mock("@/app/actions/get-map-preview", () => ({ getMapPreview: vi.fn() }));
vi.mock("@/app/actions/mint-kw-token", () => ({
  mintKwUploadToken: vi.fn(async () => ({ token: "exp.nonce.sig" })),
}));
vi.mock("@/lib/kw-extract-client", () => ({ extractKw: vi.fn() }));

import { SubjectForm, step1DefaultsFromInputs } from "@/app/valuations/new/subject-form";
import { createDraft, saveSubjectAction } from "@/app/actions/wizard";

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Adres"), "ul. Testowa 1, Poznań");
  await user.type(screen.getByLabelText(/powierzchnia \(m²\)/i), "54.3");
  await user.selectOptions(screen.getByLabelText(/cel wyceny/i), "sprzedaz");
  await user.type(screen.getByLabelText(/numer księgi wieczystej/i), "AB1C/1/1");
  await user.type(screen.getByLabelText(/zamawiający wycenę/i), "p. Test Testowy");
}

describe("SubjectForm — create mode", () => {
  beforeEach(() => {
    vi.mocked(createDraft).mockClear();
  });

  it("submits a payload without comparables/features/inspectionDate", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const payload = vi.mocked(createDraft).mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("comparables");
    expect(payload).not.toHaveProperty("features");
    expect(payload).not.toHaveProperty("inspectionDate");
    expect(payload.address).toBe("ul. Testowa 1, Poznań");
    expect(payload.client).toBe("p. Test Testowy");
  });
});

describe("SubjectForm — edit mode", () => {
  beforeEach(() => {
    vi.mocked(saveSubjectAction).mockClear();
    pushMock.mockClear();
  });

  it("saves via saveSubjectAction and navigates to step 2", async () => {
    const user = userEvent.setup();
    const defaults: Partial<FormInput> = {
      address: "ul. Kościelna 33, Poznań",
      area: "69.56",
      purpose: "sprzedaz" as never,
      kwNumber: "AB1C/2/7",
      client: "Jan Kowalski",
    };
    render(<SubjectForm valuationId="val-1" defaults={defaults} />);
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    expect(saveSubjectAction).toHaveBeenCalledWith(
      "val-1",
      expect.objectContaining({ address: "ul. Kościelna 33, Poznań" }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/valuations/val-1?step=2"));
  });
});

describe("SubjectForm — validation", () => {
  beforeEach(() => {
    vi.mocked(createDraft).mockClear();
  });

  it("blocks submit with an empty client and shows the Polish message", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);
    await user.type(screen.getByLabelText("Adres"), "ul. Testowa 1, Poznań");
    await user.type(screen.getByLabelText(/powierzchnia \(m²\)/i), "54.3");
    await user.selectOptions(screen.getByLabelText(/cel wyceny/i), "sprzedaz");
    await user.type(screen.getByLabelText(/numer księgi wieczystej/i), "AB1C/1/1");
    // client left empty
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    expect(await screen.findByText(/Podaj zamawiającego wycenę\./)).toBeDefined();
    expect(createDraft).not.toHaveBeenCalled();
  });
});

describe("SubjectForm — edit mode KW init", () => {
  it("seeds kwSource/kwState from defaults.kw with a done summary", () => {
    const defaults: Partial<FormInput> = {
      address: "ul. Kościelna 33, Poznań",
      area: "69.56",
      purpose: "sprzedaz" as never,
      client: "Jan Kowalski",
      kw: {
        source: "akt",
        kwLokalu: "AB1C/1/9",
        kwGruntu: "AB1C/2/7",
        kwInne: [],
        deweloperski: false,
        powUzytkowaKw: 69.56,
        udzial: null,
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: null,
        dzial4: null,
      },
    };
    render(<SubjectForm valuationId="val-1" defaults={defaults} />);
    const status = screen.getByTestId("kw-fetch-status");
    // 2 KW numbers (kwLokalu + kwGruntu) + the extract's own area — mirrors
    // runKwExtraction's summary format (subject-form.tsx).
    expect(status.textContent).toContain("2 KW");
    expect(status.textContent).toContain("69,56");
    expect(status.textContent).toContain("do potwierdzenia");
  });
});

describe("SubjectForm — legacy kw snapshot (Slice 12 Task 1 parity fix)", () => {
  beforeEach(() => {
    vi.mocked(saveSubjectAction).mockClear();
  });

  it("renders and saves a pre-11a draft whose kw snapshot predates kwInne/deweloperski", async () => {
    const user = userEvent.setup();
    // A Slice-10-era `inputs.kw` snapshot, saved before `kwInne`/`deweloperski`
    // existed on the schema — cast past KcsInput's current (complete) KwSnapshot
    // type since that's the whole point: this legacy shape violates it at runtime.
    const legacyInputs = {
      area: 61.2,
      comparables: [],
      features: [],
      kw: {
        source: "odpis_kw",
        kwLokalu: "AB1C/1/9",
      },
    } as unknown as KcsInput;

    const defaults = step1DefaultsFromInputs({
      address: "ul. Legacy 3, Poznań",
      area: 61.2,
      purpose: "sprzedaz",
      kwNumber: null,
      client: "Jan Legacy",
      inputs: legacyInputs,
    });

    render(<SubjectForm valuationId="legacy-1" defaults={defaults} />);

    // Render assertion — pre-fix, `kwState`'s useState initializer spreads
    // `defaults.kw.kwInne` (undefined, non-iterable) and throws a TypeError
    // before this line is ever reached.
    const status = screen.getByTestId("kw-fetch-status");
    expect(status.textContent).toContain("1 KW");

    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    // Save-path assertion — pre-fix (even with just a render guard), RHF's
    // form state carries `kw.kwInne`/`kw.deweloperski` as `undefined`;
    // step1Schema's `kwSchema` requires both, so the submit is invalid and
    // `saveSubjectAction` is never called.
    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    const call = vi.mocked(saveSubjectAction).mock.calls.findLast(() => true);
    const payload = call?.[1] as { kw?: { kwInne: string[]; deweloperski: boolean } };
    expect(payload.kw?.kwInne).toEqual([]);
    expect(payload.kw?.deweloperski).toBe(false);
  });
});

describe("step1DefaultsFromInputs", () => {
  it("maps a persisted valuation's inputs into step-1 form defaults", () => {
    const inputs: KcsInput = {
      area: 69.56,
      comparables: [],
      features: [],
      subject: {
        obreb: "Jeżyce",
        powEwidHa: 0.12,
        kondygnacjeNadziemne: 4,
        kondygnacjePodziemne: 1,
        rokBudowy: 1965,
      },
      subjectMeta: {
        x: 1,
        y: 2,
        teryt: "306401",
        fetchedAt: "2026-07-01T00:00:00Z",
        source: "t",
        mpzpAbsent: true,
      },
      kw: {
        source: "akt",
        kwLokalu: "AB1C/1/9",
        kwGruntu: null,
        kwInne: [],
        deweloperski: false,
        powUzytkowaKw: 69.56,
        udzial: null,
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: null,
        dzial4: null,
      },
      kwMeta: {
        model: "gpt-4o",
        extractedAt: "2026-07-01T00:00:00Z",
        docTypeDetected: "akt",
        docTypeDeclared: "akt",
      },
    };

    const defaults = step1DefaultsFromInputs({
      address: "ul. Kościelna 33, Poznań",
      area: 69.56,
      purpose: "sprzedaz",
      kwNumber: "AB1C/2/7",
      client: "Jan Kowalski",
      inputs,
    });

    expect(defaults.address).toBe("ul. Kościelna 33, Poznań");
    expect(defaults.area).toBe("69.56");
    expect(defaults.purpose).toBe("sprzedaz");
    expect(defaults.kwNumber).toBe("AB1C/2/7");
    expect(defaults.client).toBe("Jan Kowalski");
    // Numeric SubjectSnapshot fields become strings for the coerced-number inputs.
    expect(defaults.subject?.obreb).toBe("Jeżyce");
    expect(defaults.subject?.powEwidHa).toBe("0.12");
    expect(defaults.subject?.kondygnacjeNadziemne).toBe("4");
    expect(defaults.subject?.kondygnacjePodziemne).toBe("1");
    expect(defaults.subject?.rokBudowy).toBe("1965");
    expect(defaults.kw).toEqual(inputs.kw);
    expect(defaults.kwMeta).toEqual(inputs.kwMeta);
  });

  it("falls back to an empty subject and undefined document fields when inputs is null", () => {
    const defaults = step1DefaultsFromInputs({
      address: "ul. Testowa 1, Poznań",
      area: 40,
      purpose: null,
      kwNumber: null,
      client: null,
      inputs: null,
    });

    expect(defaults.purpose).toBe("");
    expect(defaults.kwNumber).toBe("");
    expect(defaults.client).toBe("");
    expect(defaults.subject).toEqual(EMPTY_SUBJECT);
    expect(defaults.subjectMeta).toBeUndefined();
    expect(defaults.kw).toBeUndefined();
    expect(defaults.kwMeta).toBeUndefined();
  });
});
