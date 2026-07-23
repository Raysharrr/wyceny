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
// the DB, or `next/navigation` is mocked to a pure stub. `step1Schema` is
// reconstructed here (mirrors src/app/actions/wizard.ts, pure zod, no I/O)
// rather than pulled in via importOriginal — the real wizard.ts module also
// imports `getSession`/`_deps` (DB pool, session store), which a component
// RTL test has no business booting.
vi.mock("@/app/actions/wizard", async () => {
  const { valuationFormObject } = await import("@/lib/valuation-form-schema");
  const step1Object = valuationFormObject.pick({
    address: true,
    area: true,
    subject: true,
    subjectMeta: true,
    kw: true,
    kwMeta: true,
    purpose: true,
    kwNumber: true,
    client: true,
  });
  const step1Schema = step1Object.superRefine((values, ctx) => {
    if (!values.kw && !values.kwNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["kwNumber"],
        message: "Podaj numer księgi wieczystej.",
      });
    }
  });
  return {
    step1Schema,
    createDraft: vi.fn(async () => undefined),
    saveSubjectAction: vi.fn(async () => ({ ok: true })),
  };
});
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
  await user.type(screen.getByLabelText(/numer księgi wieczystej/i), "PO1P/00000001/1");
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
      kwNumber: "PO1P/00280443/7",
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
    await user.type(screen.getByLabelText(/numer księgi wieczystej/i), "PO1P/00000001/1");
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
      kwNumber: "PO1P/00280443/7",
      client: "Jan Kowalski",
      inputs,
    });

    expect(defaults.address).toBe("ul. Kościelna 33, Poznań");
    expect(defaults.area).toBe("69.56");
    expect(defaults.purpose).toBe("sprzedaz");
    expect(defaults.kwNumber).toBe("PO1P/00280443/7");
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
