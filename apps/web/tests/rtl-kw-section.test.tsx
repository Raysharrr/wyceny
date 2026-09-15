// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import { KwSection, type KwFetchState, type KwSource } from "@/app/valuations/new/kw-section";
import { encumbranceDecisionNeeded } from "@/domain/kw-requirements";
import type { EncumbranceTreatment } from "@/domain/kw-snapshot";

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
import { createDraft, saveSubjectAction } from "@/app/actions/wizard";
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

/**
 * The same read, but of a KW excerpt rather than a deed — the only path where
 * the document itself answers both dzialy, and therefore the only upload that
 * can leave a book EXAMINED. `dataBadania` is deliberately absent: no book
 * prints the day someone read it, so the worker cannot supply it.
 */
const OK_ODPIS: KwExtractResult = {
  ...OK_EXTRACT,
  kind: "ok",
  extract: {
    ...OK_EXTRACT.extract,
    source: "odpis_kw",
    dzial3: { wpisy: false, tresc: [] },
    dzial4: { wpisy: false, tresc: [] },
  },
  meta: { ...OK_EXTRACT.meta, docTypeDetected: "odpis_kw", docTypeDeclared: "odpis_kw" },
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
 * Exposes the live FORM STATE for the three KW fields. Every defect this
 * harness exists for is the same shape — the screen shows one thing and the
 * form holds another — so the assertions read the values that will be
 * submitted, never the DOM that displays them. Seeds nothing by default: a
 * test that pre-fills `kw` cannot tell "the control writes it" from "the
 * default was already there".
 */
function StateHarness(props: {
  seed?: Partial<FormInput>;
  propertyRight?: FormInput["propertyRight"];
}) {
  const { control, resetField } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: {
      ...(props.propertyRight ? { propertyRight: props.propertyRight } : {}),
      ...(props.seed ?? {}),
    } as FormInput,
  });
  const kw = useWatch({ control, name: "kw" });
  const kwGrunt = useWatch({ control, name: "kwGrunt" });
  const encumbrance = useWatch({ control, name: "encumbranceTreatment" });
  // `source` lives in the parent in production, and the developer checkbox is
  // rendered from it — a static prop here would make the box un-untickable and
  // hide the half of the fix that clears the flag.
  const [source, setSource] = useState<KwSource>("reczny");
  // Mirrors the one thing `resetKwSection` does that this section can observe:
  // switching source CLEARS `kw`. A harness that only flipped the string would
  // let a control get away with spreading a snapshot the parent just dropped.
  const onSourceChange = (next: KwSource) => {
    setSource(next);
    resetField("kw");
  };
  return (
    <>
      <KwSection
        control={control}
        state={{ status: "idle" }}
        source={source}
        today="2026-09-15"
        onSourceChange={onSourceChange}
        onFileSelected={() => {}}
        onRetry={() => {}}
        onUseDocumentArea={() => {}}
        areaMismatch={null}
      />
      <output data-testid="kw-json">{JSON.stringify(kw ?? null)}</output>
      <output data-testid="kwgrunt-json">{JSON.stringify(kwGrunt ?? null)}</output>
      <output data-testid="encumbrance-json">{JSON.stringify(encumbrance ?? null)}</output>
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
    render(
      <StateHarness
        seed={{ kw: { source: "ekw_reczne", deweloperski: false } } as Partial<FormInput>}
      />,
    );
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
   * The checkbox used to write only the parent's `source` state, never the
   * snapshot the gate and the operat read. With `kw.deweloperski` false, B-06
   * demanded a lokal book whose card the checkbox had just hidden — an
   * unreachable blocker — and §7 printed the standard variant. Nothing is
   * seeded here on purpose: the value has to come from the click.
   */
  it("writes kw.deweloperski when the developer checkbox is ticked (not just the source switch)", async () => {
    const user = userEvent.setup();
    render(<StateHarness />);
    const json = () => JSON.parse(screen.getByTestId("kw-json").textContent || "null");
    expect(json()).toBeNull();

    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(json()?.deweloperski).toBe(true));

    // Unticking hands the job back to the parent's reset — the snapshot goes
    // away entirely rather than being rewritten with the flag cleared, so the
    // manual path goes back to demanding a KW number.
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(json()).toBeNull());
  });

  /**
   * The suggestion runs lokal → grunt on screen; the operat reads §8.2 from
   * `kw.kwGruntu`, so a number typed only in the grunt card printed as "—".
   */
  it("mirrors a grunt book number typed only in the grunt card back into kw.kwGruntu", async () => {
    const user = userEvent.setup();
    render(<StateHarness />);
    await user.type(document.querySelector("#kwg-nr") as HTMLInputElement, "AB1C/2/7");
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("kw-json").textContent || "null")?.kwGruntu).toBe(
        "AB1C/2/7",
      ),
    );
  });

  /**
   * Since ADR-018 "Zmiana 15.09" `b1-template` prints the encumbrance phrase on
   * the cover and in the wyciąg. A book examined under własność left behind on
   * a switch to the coop right would put a false legal claim in an operat about
   * a different legal object — so the switch clears all three, not just the
   * basement flag it cleared before.
   */
  it("clears both books and the encumbrance decision when the property right changes", async () => {
    const user = userEvent.setup();
    render(
      <StateHarness
        seed={
          {
            kw: { source: "ekw_reczne", deweloperski: false, kwLokalu: "AB1C/1/9" },
            kwGrunt: { source: "ekw_reczne", nrKsiegi: "AB1C/2/7" },
            encumbranceTreatment: { wariant: "bez_uwzglednienia", podstawa: "Polecenie." },
          } as Partial<FormInput>
        }
      />,
    );
    expect(JSON.parse(screen.getByTestId("kw-json").textContent || "null")).not.toBeNull();

    await user.click(
      screen.getByRole("radio", { name: "Spółdzielcze własnościowe prawo do lokalu" }),
    );

    await waitFor(() => {
      for (const id of ["kw-json", "kwgrunt-json", "encumbrance-json"]) {
        expect(JSON.parse(screen.getByTestId(id).textContent || "null")).toBeNull();
      }
    });
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
    vi.mocked(saveSubjectAction).mockClear();
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

  /**
   * The reviewer's WAŻNE 4: a successful read of a KW excerpt IS the
   * examination, but nothing dated it, so the card sat at "Do zbadania" after a
   * perfectly good PDF and step 7 blocked on B-06 with no field left to fill.
   * The date comes from the clock at the moment of the read, not the document.
   */
  it("marks the lokal's book examined after a successful odpis_kw read (dates the examination)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_ODPIS);
    const user = userEvent.setup();
    render(<SubjectForm />);

    expect(screen.getByText(/Zbadane księgi:/).textContent).toContain("0 z 2");
    await fillRequiredExceptKw(user);
    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
    await user.upload(
      screen.getByTestId("kw-file-input") as HTMLInputElement,
      new File(["%PDF-1.4 fake"], "odpis.pdf", { type: "application/pdf" }),
    );
    await screen.findByText(/Odczytano/);

    await waitFor(() => expect(screen.getByText(/Zbadane księgi:/).textContent).toContain("1 z 2"));
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      kw?: { dataBadania?: string | null };
    };
    expect(submitted.kw?.dataBadania).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * B-07's half-made decision, end to end. Typing the Podstawa before picking a
   * tile used to produce `{ wariant: null }`, which `z.enum` rejected on a path
   * no input displays — the button did nothing and said nothing. The save must
   * go through (the draft keeps what was typed) and step 7 must still block.
   */
  it("submits step 1 with a basis typed before any variant was chosen (W4 class)", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    const [lokalDzial3] = screen.getAllByRole("radiogroup", {
      name: "Dział III — prawa, roszczenia i ograniczenia",
    });
    await user.click(within(lokalDzial3).getByRole("radio", { name: "Są wpisy" }));
    await user.type(
      within(screen.getByTestId("kw-encumbrance")).getByLabelText("Podstawa"),
      "Zgodnie z poleceniem Zleceniodawcy.",
    );
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      encumbranceTreatment?: { wariant: string | null; podstawa: string } | null;
    };
    expect(submitted.encumbranceTreatment).toEqual({
      wariant: null,
      podstawa: "Zgodnie z poleceniem Zleceniodawcy.",
    });
    // …and the gate is the thing that refuses it, on a path step 1 shows.
    expect(
      encumbranceDecisionNeeded(
        {
          source: "ekw_reczne",
          kwLokalu: "AB1C/1/9",
          deweloperski: false,
          dzial3: { wpisy: true, tresc: [] },
        },
        submitted.encumbranceTreatment as EncumbranceTreatment,
      ),
    ).toBe(true);
  });

  /**
   * The trap under the developer checkbox: `onSourceChange` IS
   * `resetKwSection`, which calls `resetField("kw")`. A handler that also
   * spreads `kw` reads the snapshot from the render closure — i.e. from BEFORE
   * the reset — and writes the just-cleared book straight back. The lokal's
   * KW number would ride into a valuation of a lokal declared to have no book
   * of its own, and the gate would never object (`ksiegaLokalu` is false for a
   * developer purchase, so nobody looks). The W7 write-once class, one control
   * over. The isolated harness cannot see this: its `onSourceChange` is a
   * plain `useState` that resets nothing.
   */
  it("does not resurrect the manual book when the developer checkbox is ticked (W7 class)", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    const [lokalDzial3] = screen.getAllByRole("radiogroup", {
      name: "Dział III — prawa, roszczenia i ograniczenia",
    });
    await user.click(within(lokalDzial3).getByRole("radio", { name: "Brak wpisów" }));

    await user.click(screen.getByRole("checkbox", { name: /zakup deweloperski/i }));
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      kw?: { deweloperski?: boolean; kwLokalu?: string | null; dzial3?: unknown };
    };
    expect(submitted.kw?.deweloperski).toBe(true);
    expect(submitted.kw?.kwLokalu ?? null).toBeNull();
    expect(submitted.kw?.dzial3 ?? null).toBeNull();
  });

  /**
   * Same orphaned-answer class as the property-right switch: the encumbrance
   * question hangs off `kw.dzial3`, which `resetKwSection` clears, so the
   * decision must go with it rather than ride invisibly into the save.
   */
  it("clears the encumbrance decision when the lokal book's source is switched", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    const [lokalDzial3] = screen.getAllByRole("radiogroup", {
      name: "Dział III — prawa, roszczenia i ograniczenia",
    });
    await user.click(within(lokalDzial3).getByRole("radio", { name: "Są wpisy" }));
    await user.type(
      within(screen.getByTestId("kw-encumbrance")).getByLabelText("Podstawa"),
      "Zgodnie z poleceniem Zleceniodawcy.",
    );

    await user.click(screen.getByRole("radio", { name: "Wgraj PDF" }));
    expect(screen.queryByTestId("kw-encumbrance")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Wpisz ręcznie" }));
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      encumbranceTreatment?: unknown;
    };
    expect(submitted.encumbranceTreatment ?? null).toBeNull();
  });

  /**
   * BLOKER 7 — the drift only appears on the SECOND visit, which is why no
   * create-mode test and no isolated harness could see it. `kw.deweloperski`
   * and the section's `kwSource` were two truths about the same fact: a
   * developer stub is saved with `source: "ekw_reczne"` (nothing was read from
   * a document), which the section key mapped back to "reczny". Re-opening
   * therefore showed an UNTICKED box over a snapshot that still said
   * `deweloperski: true` — B-06 stopped asking for the lokal's book ("0 z 1"),
   * and §8.2 would print the developer variant for a valuation the appraiser
   * sees as an ordinary one. The snapshot is the truth; the switch follows it.
   */
  it("re-opens a developer draft with the box ticked and the counter agreeing (BLOKER 7)", async () => {
    const user = userEvent.setup();
    const developerDraft = {
      address: "ul. Kościelna 33, Poznań",
      area: "69.56",
      purpose: "sprzedaz" as never,
      client: "Jan Kowalski",
      inspectionDate: "2026-09-15",
      kw: {
        source: "ekw_reczne",
        kwLokalu: null,
        kwGruntu: null,
        kwInne: [],
        deweloperski: true,
        powUzytkowaKw: null,
        udzial: null,
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: null,
        dzial4: null,
        dataBadania: "2026-09-15",
      },
    } as unknown as Parameters<typeof SubjectForm>[0]["defaults"];

    render(<SubjectForm valuationId="val-dev" defaults={developerDraft} />);

    // What the screen says must match what the gate counts.
    expect(
      (
        screen.getByRole("checkbox", { name: /zakup deweloperski/i }) as HTMLInputElement
      ).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByTestId("kw-developer-banner")).toBeDefined();
    expect(screen.getByText(/Zbadane księgi:/).textContent).toContain("0 z 1");

    // And unticking is a real retraction. Asserted through a CONSEQUENCE, not
    // through `deweloperski === false`: a residual stub would satisfy that
    // while still being wrong, because `numerKwWFormularzu` keys off
    // `kw == null` — any leftover snapshot silently switches the "type a KW
    // number" demand off. So submit with nothing typed and require the refusal.
    await user.click(screen.getByRole("checkbox", { name: /zakup deweloperski/i }));
    expect(screen.getByText(/Zbadane księgi:/).textContent).toContain("0 z 2");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    expect((await screen.findByTestId("kw-upload-error")).textContent).toContain(
      "Podaj numer księgi wieczystej",
    );
    expect(saveSubjectAction).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    const [, payload] = vi.mocked(saveSubjectAction).mock.calls[0] as unknown as [
      string,
      { kw?: { deweloperski?: boolean; source?: string; kwLokalu?: string | null } },
    ];
    expect(payload.kw?.deweloperski).toBe(false);
    expect(payload.kw?.source).toBe("ekw_reczne");
    expect(payload.kw?.kwLokalu).toBe("AB1C/1/9");
  });

  /**
   * The property-right switch clears `kw` too, and the isolated harness could
   * only prove the value went away — it has no resolver, so it could not see
   * that the CLEARED form still submits. `kw` is `.optional()`, so clearing it
   * to `null` would fail validation on a path no field renders and the button
   * would go dead silently. Submitting is the assertion that matters.
   */
  it("still submits after the property right is switched (the clear must be a valid value)", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);

    await fillRequiredExceptKw(user);
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    const [lokalDzial3] = screen.getAllByRole("radiogroup", {
      name: "Dział III — prawa, roszczenia i ograniczenia",
    });
    await user.click(within(lokalDzial3).getByRole("radio", { name: "Są wpisy" }));

    await user.click(
      screen.getByRole("radio", { name: "Spółdzielcze własnościowe prawo do lokalu" }),
    );
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      propertyRight?: string;
      kw?: unknown;
      encumbranceTreatment?: unknown;
    };
    expect(submitted.propertyRight).toBe("spoldzielcze_wlasnosciowe");
    expect(submitted.kw ?? null).toBeNull();
    expect(submitted.encumbranceTreatment ?? null).toBeNull();
  });

  /**
   * BLOKER 8, the last orphan of this shape: ticking "zakup deweloperski"
   * replaces the lokal's card, so `kw.dzial3` is null and the encumbrance
   * block leaves the screen — but its answer was still reaching the record,
   * and ADR-018 reg. 6 prints that answer on the operat's COVER.
   *
   * EDIT mode, deliberately. In create mode `resetKwSection`'s
   * `resetField("encumbranceTreatment")` already clears it, so a create-mode
   * test passes with or without the fix (measured: the mutation stayed green).
   * `resetField` resets to the form's DEFAULT — which here is the STORED
   * decision — so only an explicit retraction clears it. Same trap as `kw`.
   */
  it("clears a STORED encumbrance decision when the developer checkbox is ticked (BLOKER 8)", async () => {
    const user = userEvent.setup();
    const draftWithEncumbrance = {
      address: "ul. Kościelna 33, Poznań",
      area: "69.56",
      purpose: "sprzedaz" as never,
      client: "Jan Kowalski",
      inspectionDate: "2026-09-15",
      kwNumber: "AB1C/1/9",
      kw: {
        source: "ekw_reczne",
        kwLokalu: "AB1C/1/9",
        kwGruntu: null,
        kwInne: [],
        deweloperski: false,
        powUzytkowaKw: null,
        udzial: null,
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: { wpisy: true, tresc: ["Odpłatna służebność przesyłu"] },
        dzial4: { wpisy: false, tresc: [] },
        dataBadania: "2026-09-15",
      },
      encumbranceTreatment: {
        wariant: "bez_uwzglednienia",
        podstawa: "Zgodnie z poleceniem Zleceniodawcy.",
      },
    } as unknown as Parameters<typeof SubjectForm>[0]["defaults"];

    render(<SubjectForm valuationId="val-enc" defaults={draftWithEncumbrance} />);
    expect(screen.getByTestId("kw-encumbrance")).toBeDefined();

    await user.click(screen.getByRole("checkbox", { name: /zakup deweloperski/i }));
    // The question is gone from the screen…
    expect(screen.queryByTestId("kw-encumbrance")).toBeNull();
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    const [, payload] = vi.mocked(saveSubjectAction).mock.calls[0] as unknown as [
      string,
      { kw?: { deweloperski?: boolean }; encumbranceTreatment?: unknown },
    ];
    expect(payload.kw?.deweloperski).toBe(true);
    // …and so is the answer, rather than riding on to the operat's cover.
    expect(payload.encumbranceTreatment ?? null).toBeNull();
  });

  /**
   * BLOKER 9 — the state I had argued was unreachable, reached. My enumeration
   * of `"akt"` emitters was right; what it missed is that the property-right
   * radio cleared `kw` and left `source` alone, so the pair drifts apart from
   * the other side. Going developer → coop → back leaves a section key nobody
   * chose: "Wgraj PDF" selected, and `expectedType: "akt"`, so uploading an
   * excerpt fails with a type-mismatch warning the screen cannot explain.
   *
   * Asserted through the CONSEQUENCE — what `extractKw` is actually asked for
   * — because that is what the appraiser collides with, not the radio's
   * internal state. (The derivation `kw?.deweloperski === true` behaves
   * correctly here: the deed card is gone because the record says so.)
   */
  it("does not leave a section key nobody chose after developer → right switch → back (BLOKER 9)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_ODPIS);
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);

    await user.click(screen.getByRole("checkbox", { name: /zakup deweloperski/i }));
    await user.click(
      screen.getByRole("radio", { name: "Spółdzielcze własnościowe prawo do lokalu" }),
    );
    await user.click(screen.getByRole("radio", { name: "Własność lokalu" }));

    // The lokal's card is back, and its source switch shows what was chosen —
    // nothing — rather than an upload mode inherited from the abandoned path.
    const [sourceSwitch] = screen.getAllByRole("radiogroup", {
      name: "Źródło danych księgi lokalu",
    });
    expect(
      within(sourceSwitch)
        .getByRole("radio", { name: "Wpisz ręcznie" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(sourceSwitch).getByRole("radio", { name: "Wgraj PDF" }).getAttribute("aria-checked"),
    ).toBe("false");

    // And the upload asks the worker for an excerpt, not a deed.
    await user.click(within(sourceSwitch).getByRole("radio", { name: "Wgraj PDF" }));
    await user.upload(
      screen.getByTestId("kw-file-input") as HTMLInputElement,
      new File(["%PDF-1.4 fake"], "odpis.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => expect(extractKw).toHaveBeenCalled());
    expect(vi.mocked(extractKw).mock.calls[0][0]).toMatchObject({ expectedType: "odpis_kw" });
  });

  /**
   * The property-right clear, in EDIT mode. Three defects in this session lived
   * only on this side, because `resetField` means "clear" on a fresh form and
   * "restore what was saved" on a loaded one — and this handler now calls it.
   * Ordering is the whole assertion: run `onSourceChange` after the explicit
   * clears and the stored snapshot comes straight back.
   */
  it("clears a STORED examination when the property right changes in edit mode", async () => {
    const user = userEvent.setup();
    const stored = {
      address: "ul. Kościelna 33, Poznań",
      area: "69.56",
      purpose: "sprzedaz" as never,
      client: "Jan Kowalski",
      inspectionDate: "2026-09-15",
      kwNumber: "AB1C/1/9",
      kw: {
        source: "ekw_reczne",
        kwLokalu: "AB1C/1/9",
        kwGruntu: "AB1C/2/7",
        kwInne: [],
        deweloperski: false,
        powUzytkowaKw: null,
        udzial: null,
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: { wpisy: true, tresc: ["Odpłatna służebność przesyłu"] },
        dzial4: { wpisy: false, tresc: [] },
        dataBadania: "2026-09-15",
      },
      kwGrunt: {
        source: "ekw_reczne",
        nrKsiegi: "AB1C/2/7",
        dataBadania: "2026-09-15",
        dzial3: { wpisy: false, tresc: [] },
        dzial4: { wpisy: false, tresc: [] },
      },
      encumbranceTreatment: {
        wariant: "bez_uwzglednienia",
        podstawa: "Zgodnie z poleceniem Zleceniodawcy.",
      },
    } as unknown as Parameters<typeof SubjectForm>[0]["defaults"];

    render(<SubjectForm valuationId="val-right" defaults={stored} />);
    expect(screen.getByTestId("kw-encumbrance")).toBeDefined();

    await user.click(
      screen.getByRole("radio", { name: "Spółdzielcze własnościowe prawo do lokalu" }),
    );
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    const [, payload] = vi.mocked(saveSubjectAction).mock.calls[0] as unknown as [
      string,
      { kw?: unknown; kwGrunt?: unknown; encumbranceTreatment?: unknown },
    ];
    expect(payload.kw ?? null).toBeNull();
    expect(payload.kwGrunt ?? null).toBeNull();
    expect(payload.encumbranceTreatment ?? null).toBeNull();
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
