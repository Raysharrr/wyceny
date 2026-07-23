// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import { KwSection, type KwFetchState, type KwSource } from "@/app/valuations/new/kw-section";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the next
// test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives in the full form touch on mount.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// The full-form tests fill the address field; its blur fires the EGiB/MPZP
// auto-fetch, which (with mocked getSubjectData) would throw. Same guard the
// e2e uses to stay network-free.
process.env.NEXT_PUBLIC_SUBJECT_AUTOFETCH = "off";

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// The parent form imports these; the full-form reset/W4 tests below render the
// real <SubjectForm/>, so every module it pulls that touches the network, the
// DB, or `next/navigation` is mocked to a pure stub. `step1Schema` is
// reconstructed here (mirrors src/app/actions/wizard.ts, pure zod, no I/O)
// rather than pulled in via importOriginal — the real wizard.ts module also
// imports `getSession`/`_deps` (DB pool, session store), which a component
// RTL test has no business booting. Mirrors tests/rtl-subject-form.test.tsx.
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
vi.mock("@/app/actions/mint-kw-token", () => ({
  mintKwUploadToken: vi.fn(async () => ({ token: "exp.nonce.sig" })),
}));
vi.mock("@/lib/kw-extract-client", () => ({ extractKw: vi.fn() }));

import { SubjectForm } from "@/app/valuations/new/subject-form";
import { createDraft } from "@/app/actions/wizard";
import { extractKw, type KwExtractResult } from "@/lib/kw-extract-client";

const OK_EXTRACT = {
  kind: "ok" as const,
  extract: {
    source: "akt" as const,
    // Short synthetic KW numbers — deliberately NOT the real 8-digit-middle
    // format (2 letters + digit + letter / 8 digits / digit) so the F-9 PII
    // scan stays clean.
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    kwInne: [],
    deweloperski: false,
    powUzytkowaKw: 69.56,
    udzial: "1234/56789",
    sad: "Sąd Rejonowy Poznań-Stare Miasto",
    wydzial: "VI Wydział Ksiąg Wieczystych",
    dataDokumentu: "2026-05-11",
    dzial3: null,
    dzial4: null,
  },
  meta: {
    model: "gpt-4o",
    extractedAt: "2026-07-18T00:00:00.000Z",
    docTypeDetected: "akt" as const,
    docTypeDeclared: "akt" as const,
  },
  typeMismatch: false,
};

// ---------------------------------------------------------------------------
// Presentation-only harness — KwSection in isolation, no network/parent logic.
// ---------------------------------------------------------------------------
function Harness(props: {
  state?: KwFetchState;
  source?: KwSource;
  areaMismatch?: { form: number; doc: number } | null;
  deweloperski?: boolean;
  extract?: boolean;
  kw?: Partial<FormInput["kw"]>;
  onSourceChange?: (s: KwSource) => void;
  onUseDocumentArea?: () => void;
}) {
  // The editable extract fields only render once a real `kw` extract exists
  // (KwSection's `hasExtract` gate) — so seed one whenever a test needs them.
  const withExtract = props.deweloperski || props.extract || props.kw || props.areaMismatch;
  const { control } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: withExtract
      ? ({ kw: { source: "akt", deweloperski: !!props.deweloperski, ...props.kw } } as FormInput)
      : {},
  });
  return (
    <KwSection
      control={control}
      state={props.state ?? { status: "idle" }}
      source={props.source ?? "reczny"}
      onSourceChange={props.onSourceChange ?? (() => {})}
      onFileSelected={() => {}}
      onRetry={() => {}}
      onUseDocumentArea={props.onUseDocumentArea ?? (() => {})}
      areaMismatch={props.areaMismatch ?? null}
    />
  );
}

// W6 harness: exposes the live kw.dzial3.tresc value so a textarea edit's
// split-into-string[] can be asserted (not just the DOM value).
function Dzial3Harness() {
  const { control } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: {
      kw: {
        source: "akt",
        deweloperski: false,
        dzial3: { wpisy: true, tresc: ["wpis A", "wpis B"] },
      },
    } as FormInput,
  });
  const tresc = useWatch({ control, name: "kw.dzial3.tresc" });
  return (
    <>
      <KwSection
        control={control}
        state={{ status: "idle" }}
        source="akt"
        onSourceChange={() => {}}
        onFileSelected={() => {}}
        onRetry={() => {}}
        onUseDocumentArea={() => {}}
        areaMismatch={null}
      />
      <output data-testid="dzial3-json">{JSON.stringify(tresc)}</output>
    </>
  );
}

describe("KwSection", () => {
  it("renders the three source options and manual kwNumber input by default", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /wgraj akt notarialny/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /wgraj odpis kw/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /wpisz ręcznie/i })).toBeDefined();
    expect(screen.getByLabelText(/numer księgi wieczystej/i)).toBeDefined();
  });

  it("keeps the manual input's id as kwNumber (e2e smoke selector, W9)", () => {
    render(<Harness />);
    const input = screen.getByLabelText(/numer księgi wieczystej/i) as HTMLInputElement;
    expect(input.id).toBe("kwNumber");
  });

  it("switching source calls onSourceChange (hard reset lives in the parent)", async () => {
    const onSourceChange = vi.fn();
    render(<Harness onSourceChange={onSourceChange} />);
    await userEvent.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    expect(onSourceChange).toHaveBeenCalledWith("akt");
  });

  it("shows extraction states: loading, done with type mismatch warning, invalidDoc, error", () => {
    const { rerender } = render(<Harness source="akt" state={{ status: "loading" }} />);
    expect(screen.getByTestId("kw-fetch-status").textContent).toContain("⏳");
    rerender(
      <Harness
        source="akt"
        state={{ status: "done", summary: "2 KW, pow. 69,56 m²", typeMismatch: true }}
      />,
    );
    expect(screen.getByTestId("kw-fetch-status").textContent).toContain("do potwierdzenia");
    expect(screen.getByTestId("kw-type-mismatch")).toBeDefined();
    rerender(
      <Harness source="akt" state={{ status: "invalidDoc", message: "To nie wygląda na akt." }} />,
    );
    expect(screen.getByTestId("kw-fetch-status").textContent).toContain("ℹ");
    rerender(<Harness source="akt" state={{ status: "error", message: "Błąd." }} />);
    expect(screen.getByRole("button", { name: /spróbuj ponownie/i })).toBeDefined();
  });

  it("shows the developer banner when kw.deweloperski is set", () => {
    render(<Harness source="akt" deweloperski />);
    expect(screen.getByTestId("kw-developer-banner").textContent).toContain("księgi macierzystej");
  });

  it("area mismatch warning shows both values and fires onUseDocumentArea", async () => {
    const onUse = vi.fn();
    render(
      <Harness source="akt" areaMismatch={{ form: 70, doc: 69.56 }} onUseDocumentArea={onUse} />,
    );
    const warning = screen.getByTestId("kw-area-mismatch");
    expect(warning.textContent).toContain("70");
    expect(warning.textContent).toContain("69,56");
    await userEvent.click(screen.getByRole("button", { name: /użyj wartości z dokumentu/i }));
    expect(onUse).toHaveBeenCalled();
  });

  // W5: the "zakup deweloperski" checkbox disables the kwLokalu input.
  it("checking the developer checkbox disables the kwLokalu input (W5)", async () => {
    render(<Harness source="akt" extract />);
    const kwLokalu = screen.getByLabelText(/nr kw lokalu/i) as HTMLInputElement;
    expect(kwLokalu.disabled).toBe(false);
    await userEvent.click(screen.getByLabelText(/lokal bez własnej kw/i));
    await waitFor(() => expect(kwLokalu.disabled).toBe(true));
  });

  // W6: dział III/IV textareas render joined entries and edits split back to string[].
  it("renders dział III textarea joined and propagates edits as string[] (W6)", async () => {
    render(<Dzial3Harness />);
    const textarea = screen.getByLabelText(/dział iii/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("wpis A\nwpis B");
    expect(screen.getByTestId("dzial3-json").textContent).toBe(
      JSON.stringify(["wpis A", "wpis B"]),
    );
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "nowy{enter}wpis");
    await waitFor(() =>
      expect(screen.getByTestId("dzial3-json").textContent).toBe(JSON.stringify(["nowy", "wpis"])),
    );
  });

  it("hides the dział textareas when the dział object is null", () => {
    render(<Harness source="akt" extract />);
    expect(screen.queryByLabelText(/dział iii/i)).toBeNull();
    expect(screen.queryByLabelText(/dział iv/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full-form wiring — the real <SubjectForm/> with mocked actions. Guards
// W4 (upload-mode submit error) and W7 (reset regression / write-once poison).
// ---------------------------------------------------------------------------
async function fillRequiredExceptKw(
  user: ReturnType<typeof userEvent.setup>,
  { skipArea = false }: { skipArea?: boolean } = {},
) {
  await user.type(screen.getByLabelText("Adres"), "ul. Testowa 1, Poznań");
  // `skipArea` leaves the field blank so the extract's powUzytkowaKw can seed
  // it (the #2 doc-seed reset regression needs an empty area to seed into).
  if (!skipArea) await user.type(screen.getByLabelText(/powierzchnia \(m²\)/i), "54.3");
  await user.selectOptions(screen.getByLabelText(/cel wyceny/i), "sprzedaz");
  await user.type(screen.getByLabelText(/zamawiający wycenę/i), "p. Test Testowy");
}

describe("KwSection — full-form wiring", () => {
  beforeEach(() => {
    vi.mocked(createDraft).mockClear();
    vi.mocked(extractKw).mockReset();
  });

  // W4: upload mode + no file + submit must surface a visible section error
  // (the kwNumber Controller is unmounted, so the schema issue would be silent).
  it("shows a visible upload-mode error when submitted with no file (W4)", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);
    await user.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    await fillRequiredExceptKw(user);
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    const err = await screen.findByTestId("kw-upload-error");
    expect(err.textContent).toContain("Wgraj dokument");
    expect(createDraft).not.toHaveBeenCalled();
  });

  // D9: non-PDF is rejected client-side, before any network call.
  it("rejects a non-PDF file with an inline error and no extraction (D9)", async () => {
    // applyAccept:false (a setup() option in user-event v14) — the input has
    // accept="application/pdf", so userEvent would otherwise silently drop a
    // text/plain file and never fire onChange, bypassing the guard under test.
    const user = userEvent.setup({ applyAccept: false });
    render(<SubjectForm />);
    await user.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    const txt = new File(["nie pdf"], "notatka.txt", { type: "text/plain" });
    await user.upload(fileInput, txt);
    expect(await screen.findByText(/Wgraj plik PDF/i)).toBeDefined();
    expect(extractKw).not.toHaveBeenCalled();
  });

  // W7: after an extraction, switching to "Wpisz ręcznie" then submitting must
  // yield values WITHOUT `kw` — no write-once poisoning from the unmounted
  // extract Controllers. This is the empirical probe for resetField vs setValue.
  it("drops kw after switch-to-manual + submit (W7 reset regression)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_EXTRACT);
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    await user.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    const pdf = new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" });
    await user.upload(fileInput, pdf);
    await screen.findByText(/Odczytano/);

    await user.click(screen.getByRole("button", { name: /wpisz ręcznie/i }));
    await user.type(screen.getByLabelText(/numer księgi wieczystej/i), "KW-MANUAL-1");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as { kw?: unknown };
    expect(submitted.kw).toBeUndefined();
  });

  // #2: a doc-seeded area (auto-filled from the extract's powUzytkowaKw into a
  // BLANK field) must NOT survive a section reset — otherwise a stale LLM number
  // would persist as a rzeczoznawca/confirmed area. Switching source clears it.
  it("clears a doc-seeded area on source switch, so the stale number never persists (#2)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_EXTRACT);
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user, { skipArea: true });
    const areaInput = screen.getByLabelText(/powierzchnia \(m²\)/i) as HTMLInputElement;
    expect(areaInput.value).toBe("");

    await user.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" }),
    );
    await screen.findByText(/Odczytano/);
    // Auto-seeded from OK_EXTRACT.extract.powUzytkowaKw (69.56) into the blank field.
    await waitFor(() => expect(areaInput.value).toBe("69.56"));

    // Switch to manual → the doc-seeded (unedited) area is dropped.
    await user.click(screen.getByRole("button", { name: /wpisz ręcznie/i }));
    await waitFor(() => expect(areaInput.value).toBe(""));

    // Empty area fails the required-positive schema rule, so submit is blocked:
    // the stale 69.56 can never reach the action as a rzeczoznawca value.
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(createDraft).not.toHaveBeenCalled();
  });

  // #3: a kwNumber typed in manual mode must be hard-reset when switching to an
  // upload source, so it can't silently become {nr_kw} next to a DIFFERENT set
  // of extracted numbers. After the extract, the KW number comes from the extract.
  it("hard-resets a manually-typed kwNumber when switching to an upload source (#3)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_EXTRACT);
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    // Default source is "reczny": type a manual KW number first.
    await user.type(screen.getByLabelText(/numer księgi wieczystej/i), "KW-MANUAL-3");

    // Switch to akt + upload → extract populates kw.* (kwLokalu AB1C/1/9).
    await user.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" }),
    );
    await screen.findByText(/Odczytano/);

    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());

    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      kwNumber?: string;
      kw?: { kwLokalu?: string | null };
    };
    // The typed "KW-MANUAL-3" is gone; the server syncs kwNumber from the
    // extract's kwLokalu (createDraft is mocked, so we assert the inputs).
    expect(submitted.kwNumber ?? "").toBe("");
    expect(submitted.kw?.kwLokalu).toBe("AB1C/1/9");
  });

  // Minor: a client-side reject (non-PDF) must bump kwSeq so a prior in-flight
  // extraction that resolves late can't overwrite the inline error.
  it("a non-PDF reject invalidates a prior in-flight extraction (kwSeq bump)", async () => {
    let resolveExtract!: (v: KwExtractResult) => void;
    vi.mocked(extractKw).mockReturnValue(
      new Promise<KwExtractResult>((r) => {
        resolveExtract = r;
      }),
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    await user.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    // 1) A valid PDF starts an extraction we hold unresolved (in-flight).
    await user.upload(fileInput, new File(["%PDF-1.4"], "akt.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(extractKw).toHaveBeenCalled());

    // 2) A non-PDF is rejected client-side → inline error, and bumps kwSeq.
    await user.upload(fileInput, new File(["nie pdf"], "notatka.txt", { type: "text/plain" }));
    expect(await screen.findByText(/Wgraj plik PDF/i)).toBeDefined();

    // 3) The now-stale extraction resolves — it must NOT overwrite the error.
    resolveExtract(OK_EXTRACT);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Odczytano/)).toBeNull();
    expect(screen.getByText(/Wgraj plik PDF/i)).toBeDefined();
  });

  // Race guard: an extraction that resolves AFTER the user switched source must
  // not write into the form — no stale `kw` in the submitted values, no extract
  // UI resurfacing. Mirrors fetchSubject's out-of-order guard.
  it("ignores a stale extraction that resolves after a source switch", async () => {
    let resolveExtract!: (v: KwExtractResult) => void;
    vi.mocked(extractKw).mockReturnValue(
      new Promise<KwExtractResult>((r) => {
        resolveExtract = r;
      }),
    );
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    await user.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    await user.upload(fileInput, new File(["%PDF-1.4"], "akt.pdf", { type: "application/pdf" }));
    // In-flight: the mint has resolved and extractKw was called but not resolved.
    await waitFor(() => expect(extractKw).toHaveBeenCalled());

    // Switch away, THEN let the now-stale extraction resolve.
    await user.click(screen.getByRole("button", { name: /wpisz ręcznie/i }));
    resolveExtract(OK_EXTRACT);
    await new Promise((r) => setTimeout(r, 50));

    // The stale "done" state must not have landed.
    expect(screen.queryByText(/Odczytano/)).toBeNull();

    await user.type(screen.getByLabelText(/numer księgi wieczystej/i), "KW-MANUAL-2");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as { kw?: unknown };
    expect(submitted.kw).toBeUndefined();
  });
});
