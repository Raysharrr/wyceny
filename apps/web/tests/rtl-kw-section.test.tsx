// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
// DB, or `next/navigation` is mocked to a pure stub. `@/app/actions/wizard-
// schemas` (step1Schema's real home — pure zod, no I/O) is NOT mocked: it's
// safe to import for real, unlike `wizard.ts` itself, which also pulls in
// `getSession`/`_deps` (DB pool, session store). Mirrors
// tests/rtl-subject-form.test.tsx.
vi.mock("@/app/actions/wizard", () => ({
  createDraft: vi.fn(async () => undefined),
  saveSubjectAction: vi.fn(async () => ({ ok: true })),
}));
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
  today?: string;
  areaMismatch?: { form: number; doc: number } | null;
  deweloperski?: boolean;
  extract?: boolean;
  kw?: Partial<FormInput["kw"]>;
  propertyRight?: "wlasnosc_lokalu" | "spoldzielcze_wlasnosciowe";
  onSourceChange?: (s: KwSource) => void;
  onUseDocumentArea?: () => void;
}) {
  // The editable extract fields only render once a real `kw` extract exists
  // (KwSection's `hasExtract` gate) — so seed one whenever a test needs them.
  const withExtract = props.deweloperski || props.extract || props.kw || props.areaMismatch;
  const { control } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: {
      ...(withExtract
        ? ({ kw: { source: "akt", deweloperski: !!props.deweloperski, ...props.kw } } as FormInput)
        : {}),
      ...(props.propertyRight ? { propertyRight: props.propertyRight } : {}),
    },
  });
  return (
    <KwSection
      control={control}
      state={props.state ?? { status: "idle" }}
      source={props.source ?? "reczny"}
      today={props.today ?? "2026-09-15"}
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
        source="reczny"
        today="2026-09-15"
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

/**
 * Exposes the live `kwGrunt` snapshot — the grunt card DISPLAYS the lokal
 * card's "Numer księgi gruntu" as a suggestion, and what matters is whether
 * that suggestion is also what gets SAVED.
 */
function KwGruntHarness() {
  const { control } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: { kw: { source: "ekw_reczne", deweloperski: false } } as FormInput,
  });
  const kwGrunt = useWatch({ control, name: "kwGrunt" });
  return (
    <>
      <KwSection
        control={control}
        state={{ status: "idle" }}
        source="reczny"
        today="2026-09-15"
        onSourceChange={() => {}}
        onFileSelected={() => {}}
        onRetry={() => {}}
        onUseDocumentArea={() => {}}
        areaMismatch={null}
      />
      <output data-testid="kwgrunt-json">{JSON.stringify(kwGrunt ?? null)}</output>
    </>
  );
}

describe("KwSection", () => {
  // The screen the mockup describes: one heading, a counter, two book cards.
  it("renders the examination heading, the counter banner and both book cards", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Badanie ksiąg wieczystych" })).toBeDefined();
    expect(screen.getByText(/Zbadane księgi:/).textContent).toContain("Zbadane księgi: 0 z 2");
    expect(screen.getByText("Księga lokalu")).toBeDefined();
    expect(screen.getByText("Księga gruntu")).toBeDefined();
    // Neither book examined yet — both badges say so, and the badge is the
    // same predicate the F-4 gate uses (R-10), never a separate opinion.
    expect(screen.getAllByText("Do zbadania")).toHaveLength(2);
  });

  it("offers Wgraj PDF / Wpisz ręcznie for the lokal's book only — the grunt's is manual in paczka 1", () => {
    render(<Harness />);
    const groups = screen.getAllByRole("radiogroup", { name: "Źródło danych księgi lokalu" });
    expect(groups).toHaveLength(1);
    expect(
      within(groups[0])
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Wgraj PDF", "Wpisz ręcznie"]);
    expect(screen.queryByRole("radiogroup", { name: "Źródło danych księgi gruntu" })).toBeNull();
  });

  it("warns, in manual mode, that the operat gets a description instead of the dzialy", () => {
    const { rerender } = render(<Harness source="reczny" />);
    // Both cards are manual: the lokal's by choice, the grunt's by design.
    expect(screen.getAllByText(/trafią do operatu jako opis/)).toHaveLength(2);
    rerender(<Harness source="odpis_kw" />);
    expect(screen.getAllByText(/trafią do operatu jako opis/)).toHaveLength(1);
  });

  it("defaults the examination date to today — a book never prints when it was read", () => {
    render(<Harness today="2026-09-15" />);
    expect(
      (screen.getByLabelText("Data badania", { selector: "#kw-data-badania" }) as HTMLInputElement)
        .value,
    ).toBe("2026-09-15");
    expect(
      (screen.getByLabelText("Data badania", { selector: "#kwg-data-badania" }) as HTMLInputElement)
        .value,
    ).toBe("2026-09-15");
  });

  it("asks for the deed in three fields (decyzja usera 15.09), under the mockup's group label", () => {
    render(<Harness />);
    expect(screen.getByText("Podstawa nabycia — dział II")).toBeDefined();
    for (const label of ["Tytuł aktu", "Rep. A", "Data"]) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
  });

  it("switching the lokal's source calls onSourceChange (hard reset lives in the parent)", async () => {
    const onSourceChange = vi.fn();
    render(<Harness onSourceChange={onSourceChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
    expect(onSourceChange).toHaveBeenCalledWith("odpis_kw");
  });

  it("a failed PDF read shows the error banner, not a bare red line (spec §12a)", () => {
    render(<Harness source="odpis_kw" state={{ status: "error", message: "Błąd." }} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("error");
    expect(alert.textContent).toBe(
      "Nie udało się odczytać pliku PDF księgi — wgraj inny plik albo wpisz dane ręcznie.",
    );
    expect(screen.getByRole("button", { name: /spróbuj ponownie/i })).toBeDefined();
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

  // T-12 (S1): rodzaj prawa sits at the top of the card and drives the coop-only copy.
  it("renders the property-right radio with własność selected and no coop copy by default", () => {
    render(<Harness source="akt" extract />);
    const group = screen.getByRole("radiogroup", { name: "Rodzaj prawa" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Własność lokalu",
      "Spółdzielcze własnościowe prawo do lokalu",
    ]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("property-right-coop-info")).toBeNull();
    expect(screen.queryByLabelText("Lokal ma przynależną piwnicę")).toBeNull();
    expect(screen.queryByTestId("kw-gruntu-coop-hint")).toBeNull();
    expect(screen.queryByTestId("kw-lokalu-coop-hint")).toBeNull();
  });

  it("switching to spółdzielcze drops the examination entirely — a coop right has no book (T-12)", async () => {
    const user = userEvent.setup();
    render(<Harness source="odpis_kw" extract />);
    await user.click(
      screen.getByRole("radio", { name: "Spółdzielcze własnościowe prawo do lokalu" }),
    );
    expect(screen.getByTestId("property-right-coop-info").textContent).toContain("rejestru biura");
    expect(screen.getByLabelText("Lokal ma przynależną piwnicę")).toBeTruthy();
    // No heading, no cards, no counter: the gate demands none of it, so the
    // form must not ask for it either.
    expect(screen.queryByRole("heading", { name: "Badanie ksiąg wieczystych" })).toBeNull();
    expect(screen.queryByText("Księga lokalu")).toBeNull();
    expect(screen.queryByText("Księga gruntu")).toBeNull();
    expect(screen.getByLabelText("Numer księgi wieczystej")).toBeTruthy();
    expect(screen.getByTestId("kw-number-coop-hint").textContent).toBe(
      "Dla spółdzielczego własnościowego prawa KW nie jest wymagana",
    );
  });

  it("switching back to własność clears a basement ticked under the coop right (M-2)", async () => {
    const user = userEvent.setup();
    function BasementHarness() {
      const { control } = useForm<FormInput, unknown, FormOutput>({
        defaultValues: {
          propertyRight: "spoldzielcze_wlasnosciowe",
          hasBasement: false,
        } as FormInput,
      });
      const value = useWatch({ control, name: "hasBasement" });
      return (
        <>
          <KwSection
            control={control}
            state={{ status: "idle" }}
            source="reczny"
            onSourceChange={() => {}}
            onFileSelected={() => {}}
            onRetry={() => {}}
            onUseDocumentArea={() => {}}
            areaMismatch={null}
          />
          <output data-testid="basement-json">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<BasementHarness />);
    await user.click(screen.getByLabelText("Lokal ma przynależną piwnicę"));
    expect(screen.getByTestId("basement-json").textContent).toBe("true");
    await user.click(screen.getByRole("radio", { name: "Własność lokalu" }));
    expect(screen.queryByLabelText("Lokal ma przynależną piwnicę")).toBeNull();
    expect(screen.getByTestId("basement-json").textContent).toBe("false");
  });

  it("manual path + spółdzielcze: the KW number stays visible with the 'not required' hint", () => {
    render(<Harness source="reczny" propertyRight="spoldzielcze_wlasnosciowe" />);
    expect(screen.getByLabelText("Numer księgi wieczystej")).toBeTruthy();
    expect(screen.getByTestId("kw-number-coop-hint").textContent).toBe(
      "Dla spółdzielczego własnościowego prawa KW nie jest wymagana",
    );
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

  // §P1.8 pkt 4 (default variant, awaiting the user's sign-off on the PR
  // screenshot): a lokal with no book of its own has nothing to examine, so
  // ticking the box swaps the lokal's card for the deed upload. The grunt's
  // card stays — that book IS the legal picture for such a lokal.
  it("the deweloperski checkbox swaps the lokal's card for the deed upload", async () => {
    const onSourceChange = vi.fn();
    const { rerender } = render(<Harness onSourceChange={onSourceChange} />);
    await userEvent.click(screen.getByLabelText(/lokal bez własnej kw/i));
    expect(onSourceChange).toHaveBeenCalledWith("akt");
    rerender(<Harness source="akt" onSourceChange={onSourceChange} />);
    expect(screen.queryByLabelText("Numer księgi lokalu")).toBeNull();
    expect(screen.getByTestId("kw-developer-banner").textContent).toContain("księgi macierzystej");
    expect(screen.getByText("Księga gruntu")).toBeDefined();
  });

  // B-07 (ADR-018 reg. 6): the choice appears when — and only when — the LOKAL's
  // dział III has an entry. The grunt's entries are described in §8.2 and
  // encumber nothing here (RAPORT-diff D-02).
  it("asks how the value treats an encumbrance only for an entry in the lokal's dział III", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByTestId("kw-encumbrance")).toBeNull();

    // Two dział III groups on screen: the lokal's card first, the grunt's second.
    const [lokalGroup, gruntGroup] = screen.getAllByRole("radiogroup", {
      name: "Dział III — prawa, roszczenia i ograniczenia",
    });
    // An entry in the GRUNT's dział III: still no question.
    await user.click(within(gruntGroup).getByRole("radio", { name: "Są wpisy" }));
    expect(screen.queryByTestId("kw-encumbrance")).toBeNull();

    await user.click(within(lokalGroup).getByRole("radio", { name: "Są wpisy" }));
    const choice = screen.getByTestId("kw-encumbrance");
    expect(choice.textContent).toContain("Księga lokalu ma wpis w dziale III.");
    expect(
      within(choice)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Wartość z uwzględnieniem obciążenia", "Wartość bez uwzględnienia obciążenia"]);
    expect(within(choice).getByLabelText("Podstawa")).toBeDefined();
  });

  // W6: dział III/IV textareas render joined entries and edits split back to string[].
  it("renders dział III textarea joined and propagates edits as string[] (W6)", async () => {
    render(<Dzial3Harness />);
    const textarea = document.querySelector("#kw-dzial3") as HTMLTextAreaElement;
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

  /**
   * A filled screen over an empty save is the same class of defect as a field
   * missing from `.pick()`: the operat would claim a book number the record
   * never got. The suggestion must survive being typed AFTER the grunt card
   * was first touched — the order an appraiser who starts at dział III uses.
   */
  it("saves the suggested grunt book number even when it is typed after the grunt card was touched", async () => {
    const user = userEvent.setup();
    render(<KwGruntHarness />);
    const json = () => JSON.parse(screen.getByTestId("kwgrunt-json").textContent || "null");

    // First touch of the grunt card while the lokal's "Numer księgi gruntu" is
    // still blank: the snapshot is created with no number.
    const [, gruntDzial3] = screen.getAllByRole("radiogroup", {
      name: "Dział III — prawa, roszczenia i ograniczenia",
    });
    await user.click(within(gruntDzial3).getByRole("radio", { name: "Brak wpisów" }));
    await waitFor(() => expect(json()).not.toBeNull());
    expect(json().nrKsiegi).toBeNull();

    // Now the number is typed on the LOKAL card…
    await user.type(document.querySelector("#kw-gruntu") as HTMLInputElement, "AB1C/2/7");
    // …the grunt card shows it…
    await waitFor(() =>
      expect((document.querySelector("#kwg-nr") as HTMLInputElement).value).toBe("AB1C/2/7"),
    );
    // …and the next edit of the grunt card persists it rather than freezing null.
    const [, gruntDzial4] = screen.getAllByRole("radiogroup", {
      name: "Dział IV — hipoteka",
    });
    await user.click(within(gruntDzial4).getByRole("radio", { name: "Brak wpisów" }));
    await waitFor(() => expect(json().nrKsiegi).toBe("AB1C/2/7"));
  });

  /**
   * The distinction the 14.09 operat lost: "nobody answered" is not "no
   * entries". An unanswered dział shows neither radio selected and no
   * textarea, and the gate keeps the draft shut until one is chosen.
   */
  it("leaves a dział unanswered until the appraiser picks Brak wpisów / Są wpisy", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const [lokalDzial3] = screen.getAllByRole("radiogroup", {
      name: "Dział III — prawa, roszczenia i ograniczenia",
    });
    expect(
      within(lokalDzial3)
        .getAllByRole("radio")
        .every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    expect(document.querySelector("#kw-dzial3")).toBeNull();

    await user.click(within(lokalDzial3).getByRole("radio", { name: "Brak wpisów" }));
    // "Brak wpisów" is an answer, not an empty text field — no textarea for it.
    expect(document.querySelector("#kw-dzial3")).toBeNull();
    expect(
      within(lokalDzial3).getByRole("radio", { name: "Brak wpisów" }).getAttribute("aria-checked"),
    ).toBe("true");
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
    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
    await fillRequiredExceptKw(user);
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    // The issue is raised against `kwNumber`, which no longer has an input of
    // its own for własność — it now lands under the field that owns the number.
    const err = await screen.findByTestId("kw-upload-error");
    expect(err.textContent).toContain("Podaj numer księgi wieczystej");
    expect(createDraft).not.toHaveBeenCalled();
  });

  // D9: non-PDF is rejected client-side, before any network call.
  it("rejects a non-PDF file with an inline error and no extraction (D9)", async () => {
    // applyAccept:false (a setup() option in user-event v14) — the input has
    // accept="application/pdf", so userEvent would otherwise silently drop a
    // text/plain file and never fire onChange, bypassing the guard under test.
    const user = userEvent.setup({ applyAccept: false });
    render(<SubjectForm />);
    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
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
    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    const pdf = new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" });
    await user.upload(fileInput, pdf);
    await screen.findByText(/Odczytano/);

    await user.click(screen.getByRole("radio", { name: "Wpisz ręcznie" }));
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "KW-MANUAL-1");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      kw?: { source?: string; kwLokalu?: string | null; udzial?: string | null };
    };
    // Since ADR-018 the manual path submits a snapshot of its own — what must
    // not survive is the EXTRACT: none of the uploaded document's values ride
    // along inside it (the W7 write-once poisoning class).
    expect(submitted.kw?.source).toBe("ekw_reczne");
    expect(submitted.kw?.kwLokalu).toBe("KW-MANUAL-1");
    expect(submitted.kw?.udzial ?? null).toBeNull();
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

    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" }),
    );
    await screen.findByText(/Odczytano/);
    // Auto-seeded from OK_EXTRACT.extract.powUzytkowaKw (69.56) into the blank field.
    await waitFor(() => expect(areaInput.value).toBe("69.56"));

    // Switch to manual → the doc-seeded (unedited) area is dropped.
    await user.click(screen.getByRole("radio", { name: "Wpisz ręcznie" }));
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
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "KW-MANUAL-3");

    // Switch to akt + upload → extract populates kw.* (kwLokalu AB1C/1/9).
    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
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
    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
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
    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    await user.upload(fileInput, new File(["%PDF-1.4"], "akt.pdf", { type: "application/pdf" }));
    // In-flight: the mint has resolved and extractKw was called but not resolved.
    await waitFor(() => expect(extractKw).toHaveBeenCalled());

    // Switch away, THEN let the now-stale extraction resolve.
    await user.click(screen.getByRole("radio", { name: "Wpisz ręcznie" }));
    resolveExtract(OK_EXTRACT);
    await new Promise((r) => setTimeout(r, 50));

    // The stale "done" state must not have landed.
    expect(screen.queryByText(/Odczytano/)).toBeNull();

    await user.type(screen.getByLabelText("Numer księgi lokalu"), "KW-MANUAL-2");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      kw?: { source?: string; kwLokalu?: string | null; sad?: string | null };
    };
    expect(submitted.kw?.source).toBe("ekw_reczne");
    expect(submitted.kw?.kwLokalu).toBe("KW-MANUAL-2");
    // Nothing from the stale extract leaked into the manual snapshot.
    expect(submitted.kw?.sad ?? null).toBeNull();
  });
});
