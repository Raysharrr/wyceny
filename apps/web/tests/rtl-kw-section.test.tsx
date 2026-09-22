// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import {
  KwSection,
  type KwFetchState,
  type KwSource,
  type KwTranscribeState,
} from "@/app/valuations/new/kw-section";
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
vi.mock("@/lib/kw-transcribe-client", () => ({ transcribeKw: vi.fn() }));

import { SubjectForm } from "@/app/valuations/new/subject-form";
import { createDraft, saveSubjectAction } from "@/app/actions/wizard";
import { extractKw, type KwExtractResult } from "@/lib/kw-extract-client";
import { transcribeKw } from "@/lib/kw-transcribe-client";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { step1DefaultsFromInputs } from "@/lib/subject-form";
import { ksiegaTrescSchema, type KsiegaTresc } from "@/domain/kw-tresc";
import { dzialyZTresci } from "@/domain/kw-z-tresci";
import { localToday } from "@/app/valuations/new/kw-section";

/** Migawki odczytane z wywołania akcji — luźno typowane, bo akcja jest atrapą. */
type KwSnapshotLike = {
  source: string;
  tresc?: unknown;
  dzial3?: unknown;
  dzial4?: unknown;
  transkrypcja?: unknown;
  dataBadania?: string;
};
type KwGruntSnapshotLike = KwSnapshotLike;

/**
 * The worker's own transcription fixture — the synthetic book with fictional
 * persons and correct check digits — read IN PLACE. Never copy its values into
 * this file: KW-shaped literals in a tracked `.ts` stop F-9
 * (`scripts/check-no-pii.sh`), which does not care that they are invented.
 */
function transcribedBook(): KsiegaTresc {
  const wire = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "..", "worker", "tests", "fixtures", "kw_transcribe_sample.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  // The verdict travels beside the content on the wire; `inputs.kw.tresc` is
  // the content alone, so the fixture is stripped the same way the client is.
  delete wire.walidacja;
  return ksiegaTrescSchema.parse(wire);
}

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
  transcribe?: KwTranscribeState;
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
      lokal={{
        source: props.source ?? "ekw_wklej",
        state: props.state ?? { status: "idle" },
        transcribe: props.transcribe ?? { status: "idle" },
        onSourceChange: props.onSourceChange ?? (() => {}),
        onFiles: () => {},
        onTekst: () => {},
        onRetry: () => {},
      }}
      grunt={{
        source: "ekw_wklej",
        transcribe: { status: "idle" },
        onSourceChange: () => {},
        onFiles: () => {},
        onTekst: () => {},
      }}
      today={props.today ?? "2026-09-15"}
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
        lokal={{
          source: "ekw_wklej",
          state: { status: "idle" },
          transcribe: { status: "idle" },
          onSourceChange: () => {},
          onFiles: () => {},
          onTekst: () => {},
          onRetry: () => {},
        }}
        grunt={{
          source: "ekw_wklej",
          transcribe: { status: "idle" },
          onSourceChange: () => {},
          onFiles: () => {},
          onTekst: () => {},
        }}
        today="2026-09-15"
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
  const [source, setSource] = useState<KwSource>("ekw_wklej");
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
        lokal={{
          source,
          state: { status: "idle" },
          transcribe: { status: "idle" },
          onSourceChange,
          onFiles: () => {},
          onTekst: () => {},
          onRetry: () => {},
        }}
        grunt={{
          source: "ekw_wklej",
          transcribe: { status: "idle" },
          onSourceChange: () => {},
          onFiles: () => {},
          onTekst: () => {},
        }}
        today="2026-09-15"
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

  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("offers Wgraj PDF / Wpisz ręcznie for the lokal's book only — the grunt's is manual in paczka 1", () => {
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

  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("warns, in manual mode, that the operat gets a description instead of the dzialy", () => {
    const { rerender } = render(<Harness source="ekw_wklej" />);
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

  it("keeps the decimal separator while the area is being typed, digit by digit", async () => {
    // Staging 16.09: the field held the NUMBER, so "44," re-rendered as "44"
    // between keystrokes and "44,23" was stored as 4423 — then the form warned
    // that it disagreed with the document it had just read.
    render(<StateHarness />);
    const field = screen.getByLabelText("Powierzchnia użytkowa wg księgi") as HTMLInputElement;
    await userEvent.type(field, "44,23");
    expect(field.value).toBe("44,23");
    expect(JSON.parse(screen.getByTestId("kw-json").textContent!).powUzytkowaKw).toBe(44.23);
  });

  it("reads a pasted area with a thousands group and with the unit still attached", async () => {
    const area = () => JSON.parse(screen.getByTestId("kw-json").textContent!).powUzytkowaKw;
    render(<StateHarness />);
    const field = screen.getByLabelText("Powierzchnia użytkowa wg księgi") as HTMLInputElement;
    await userEvent.type(field, "1 234,50");
    expect(area()).toBe(1234.5);
    // A unit pasted off the book. The register parser keeps every digit it
    // finds, so unstripped "44,23 m2" lands as 44,232 — a wrong number with
    // nothing on screen to say so.
    await userEvent.clear(field);
    await userEvent.type(field, "44,23 m2");
    expect(area()).toBe(44.23);
    await userEvent.clear(field);
    await userEvent.type(field, "44,23 m²");
    expect(area()).toBe(44.23);
  });

  it("takes the court and its wydział by hand — the template used to print one fixed court", async () => {
    render(<StateHarness />);
    await userEvent.type(
      screen.getByLabelText("Sąd prowadzący księgi"),
      "Sąd Rejonowy w Środzie Wielkopolskiej",
    );
    await userEvent.type(
      screen.getByLabelText("Wydział ksiąg wieczystych"),
      "V Wydział Ksiąg Wieczystych",
    );
    const kw = JSON.parse(screen.getByTestId("kw-json").textContent!);
    expect(kw.sad).toBe("Sąd Rejonowy w Środzie Wielkopolskiej");
    expect(kw.wydzial).toBe("V Wydział Ksiąg Wieczystych");
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
    await userEvent.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
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
            lokal={{
              source: "ekw_wklej",
              state: { status: "idle" },
              transcribe: { status: "idle" },
              onSourceChange: () => {},
              onFiles: () => {},
              onTekst: () => {},
              onRetry: () => {},
            }}
            grunt={{
              source: "ekw_wklej",
              transcribe: { status: "idle" },
              onSourceChange: () => {},
              onFiles: () => {},
              onTekst: () => {},
            }}
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
    render(<Harness source="ekw_wklej" propertyRight="spoldzielcze_wlasnosciowe" />);
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
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("asks how the value treats an encumbrance only for an entry in the lokal's dział III", async () => {
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
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("renders dział III textarea joined and propagates edits as string[] (W6)", async () => {
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
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("saves the suggested grunt book number even when it is typed after the grunt card was touched", async () => {
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
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("leaves a dział unanswered until the appraiser picks Brak wpisów / Są wpisy", async () => {
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

/** Karta jednej z dwóch ksiąg — obie mają dziś te same kanały i te same etykiety. */
function kartaKsiegi(ksiega: "lokal" | "grunt"): HTMLElement {
  return screen.getByTestId(`kw-book-${ksiega}`);
}

describe("KwSection — full-form wiring", () => {
  beforeEach(() => {
    vi.mocked(createDraft).mockClear();
    vi.mocked(saveSubjectAction).mockClear();
    vi.mocked(extractKw).mockReset();
    vi.mocked(transcribeKw).mockReset();
    vi.mocked(mintKwUploadToken).mockClear();
    // Default for the tests that predate the transcription: the second read
    // simply fails, so they keep measuring exactly what they measured before.
    vi.mocked(transcribeKw).mockResolvedValue({ kind: "error", code: "kw_transkrypcja_blad" });
  });

  // W4: upload mode + no file + submit must surface a visible section error
  // (the kwNumber Controller is unmounted, so the schema issue would be silent).
  it("shows a visible upload-mode error when submitted with no file (W4)", async () => {
    const user = userEvent.setup();
    render(<SubjectForm />);
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
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
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
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

  // -------------------------------------------------------------------------
  // KR.1 — the second read of the same PDF: the full content of the dzialy.
  // -------------------------------------------------------------------------

  /** Uploads a KW excerpt in "Wgraj PDF" mode and waits for both reads to settle. */
  async function uploadOdpis(user: ReturnType<typeof userEvent.setup>) {
    // Od ADR-021 obie karty mają ten sam przełącznik kanału, więc klikamy w
    // obrębie karty księgi lokalu, a nie po samej nazwie przycisku.
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    await user.upload(
      screen.getByTestId("kw-file-input") as HTMLInputElement,
      new File(["%PDF-1.4 fake"], "ksiega-lokalu.pdf", { type: "application/pdf" }),
    );
    await screen.findByText(/Odczytano/);
  }

  /**
   * The happy path. The transcription is the higher-fidelity read (the spike
   * put claude-opus-5 at 57/57 cells against the field extract's 94-98%), so
   * where it states one of the card's fields it WINS over the extract — and it
   * is the only source for the two the extract never had: the unit number and
   * dział II's deed.
   */
  it("fills the card from the transcription and stores tresc when the verdict passes (KR.1)", async () => {
    const tresc = transcribedBook();
    vi.mocked(extractKw).mockResolvedValue(OK_ODPIS);
    vi.mocked(transcribeKw).mockResolvedValue({
      kind: "ok",
      tresc,
      walidacja: { ok: true, bledy: [] },
    });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);
    await uploadOdpis(user);

    const pola = tresc.polaDodatkowe;
    const podstawa = pola.podstawaNabycia!;
    await waitFor(() =>
      expect((screen.getByLabelText("Numer lokalu") as HTMLInputElement).value).toBe(
        pola.numerLokalu,
      ),
    );
    expect(
      (screen.getByLabelText("Udział w nieruchomości wspólnej") as HTMLInputElement).value,
    ).toBe(pola.udzial);
    // Both cards carry a "Numer księgi gruntu" — the lokal's book STATES it and
    // the grunt's card is seeded from it — so this targets the lokal's field by
    // id, and asserts the mirror separately.
    expect((document.getElementById("kw-gruntu") as HTMLInputElement).value).toBe(pola.kwGruntu);
    expect((document.getElementById("kwg-nr") as HTMLInputElement).value).toBe(pola.kwGruntu);
    expect((screen.getByLabelText("Tytuł aktu") as HTMLInputElement).value).toBe(
      podstawa.tytulAktu,
    );
    expect((screen.getByLabelText("Rep. A") as HTMLInputElement).value).toBe(podstawa.repA);
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe(podstawa.dataAktu);
    // Neither banner: nothing went wrong and nothing needs the appraiser's eye
    // here — the review of the content itself happens in the step-7 preview.
    expect(screen.queryByTestId("kw-transcribe-warn")).toBeNull();

    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as { kw?: { tresc?: unknown } };
    expect(submitted.kw?.tresc).toEqual(tresc);
  });

  /** Tekst „z pięciu zakładek”: same nagłówki działów wystarczą licznikowi; treść przychodzi z atrapy workera. */
  function tekstZakladek(tresc: KsiegaTresc, kody: string[] = ["I-O", "I-Sp", "II", "III", "IV"]) {
    return tresc.dzialy
      .filter((d) => kody.includes(d.kod))
      .map((d) => `${d.tytul}\nRubryka | wartość | 1`)
      .join("\n\n");
  }

  async function wklejIPrzepisz(
    user: ReturnType<typeof userEvent.setup>,
    ksiega: "lokalu" | "gruntu",
    tekst: string,
  ) {
    const karta = kartaKsiegi(ksiega === "lokalu" ? "lokal" : "grunt");
    await user.click(within(karta).getByRole("textbox", { name: "Treść z przeglądarki KW" }));
    await user.paste(tekst);
    await user.click(within(karta).getByRole("button", { name: "Przepisz treść księgi" }));
  }

  it("kanał tekstowy księgi LOKALU: sam /kw-transcribe, pola z treści, źródło ekw_wklej, dataBadania=dziś (KR-21.1)", async () => {
    const tresc = transcribedBook();
    vi.mocked(transcribeKw).mockResolvedValue({
      kind: "ok",
      tresc,
      walidacja: { ok: true, bledy: [] },
    });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);
    await wklejIPrzepisz(user, "lokalu", tekstZakladek(tresc));

    await waitFor(() =>
      expect((screen.getByLabelText("Numer lokalu") as HTMLInputElement).value).toBe(
        tresc.polaDodatkowe.numerLokalu,
      ),
    );
    expect(extractKw).not.toHaveBeenCalled();
    const arg = vi.mocked(transcribeKw).mock.calls[0][0];
    expect(arg.tekst).toContain("DZIAŁ I-O");
    expect(arg.files).toBeUndefined();
    expect((document.getElementById("kw-lokalu") as HTMLInputElement).value).toBe(
      tresc.naglowek.numerKsiegi,
    );
    expect((screen.getByLabelText("Sąd prowadzący księgi") as HTMLInputElement).value).toBe(
      tresc.naglowek.sad,
    );

    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const kw = (vi.mocked(createDraft).mock.calls[0][0] as { kw: KwSnapshotLike }).kw;
    expect(kw.source).toBe("ekw_wklej");
    expect(kw.tresc).toEqual(tresc);
    expect(kw.dzial3).toEqual(dzialyZTresci(tresc).dzial3);
    expect(kw.dzial4).toEqual(dzialyZTresci(tresc).dzial4);
    expect(kw.transkrypcja).toMatchObject({ ok: true, bledy: [], kanal: "tekst", plikow: 0 });
    expect(kw.dataBadania).toBe(localToday());
  });

  it("werdykt ok:false NIE wstrzymuje treści: tresc zapisana, werdykt przy migawce, pola z odczytu (ADR-021 reg. 5)", async () => {
    const tresc = transcribedBook();
    const bledy = [
      { klasa: "pole_niezgodne:udzial", dzial: "I-Sp" },
      { klasa: "kw_cyfra_kontrolna:kwGruntu" },
    ];
    vi.mocked(extractKw).mockResolvedValue(OK_ODPIS);
    vi.mocked(transcribeKw).mockResolvedValue({
      kind: "ok",
      tresc,
      walidacja: { ok: false, bledy },
    });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);
    await uploadOdpis(user);
    await waitFor(() =>
      expect((screen.getByLabelText("Numer lokalu") as HTMLInputElement).value).toBe(
        tresc.polaDodatkowe.numerLokalu,
      ),
    );
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const kw = (vi.mocked(createDraft).mock.calls[0][0] as { kw: KwSnapshotLike }).kw;
    expect(kw.tresc).toEqual(tresc);
    expect(kw.transkrypcja).toMatchObject({ ok: false, bledy, kanal: "pdf", plikow: 1 });
    // Klasy, nie wartości: werdykt nie może nieść udziału z księgi (F-13).
    expect(JSON.stringify(kw.transkrypcja)).not.toContain(tresc.polaDodatkowe.udzial!);
  });

  it("kanał tekstowy księgi GRUNTU: numer, sąd i wydział z nagłówka, działy z treści, karta „Zbadana” (R2)", async () => {
    const tresc = transcribedBook();
    vi.mocked(transcribeKw).mockResolvedValue({
      kind: "ok",
      tresc,
      walidacja: { ok: true, bledy: [] },
    });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);
    // Numer księgi lokalu wpisany ręcznie: `step1Schema` żąda go dla własności
    // lokalu, a ten test bada wyłącznie tor księgi gruntu.
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    await wklejIPrzepisz(user, "gruntu", tekstZakladek(tresc));

    await waitFor(() =>
      expect((document.getElementById("kwg-nr") as HTMLInputElement).value).toBe(
        tresc.naglowek.numerKsiegi,
      ),
    );
    expect((document.getElementById("kwg-sad") as HTMLInputElement).value).toBe(tresc.naglowek.sad);
    expect(extractKw).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const { kwGrunt } = vi.mocked(createDraft).mock.calls[0][0] as {
      kwGrunt: KwGruntSnapshotLike;
    };
    expect(kwGrunt.source).toBe("ekw_wklej");
    expect(kwGrunt.tresc).toEqual(tresc);
    expect(kwGrunt.dzial3).toEqual(dzialyZTresci(tresc).dzial3);
    expect(kwGrunt.dataBadania).toBe(localToday());
  });

  /**
   * The transcription failed on its own while the field read succeeded. The
   * file WAS read, so the mockup's error banner ("Nie udało się odczytać pliku
   * PDF księgi") would be a false statement; the consequence is the manual
   * path's consequence — an operat without the dzialy — so it gets the manual
   * path's warning weight.
   */
  it("warns, without claiming the PDF was unreadable, when only the transcription fails (KR.1)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_ODPIS);
    vi.mocked(transcribeKw).mockResolvedValue({ kind: "error", code: "kw_transkrypcja_ucieta" });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);
    await uploadOdpis(user);

    const warn = await screen.findByTestId("kw-transcribe-warn");
    expect(warn.textContent).toContain("zbyt obszerna");
    expect(screen.queryByText(/Nie udało się odczytać pliku PDF księgi/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));
    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as { kw?: { tresc?: unknown } };
    expect(submitted.kw?.tresc ?? null).toBeNull();
  });

  /**
   * Nothing was read at all. Now the mockup's error banner IS true, and it is
   * the only thing on screen — a second warning about the dzialy would be
   * noise about a document that never arrived.
   */
  it("shows the mockup's error banner alone when neither read succeeds (KR.1)", async () => {
    vi.mocked(extractKw).mockResolvedValue({
      kind: "error",
      message: "Nie udało się odczytać dokumentu — spróbuj ponownie.",
      retryable: true,
    });
    vi.mocked(transcribeKw).mockResolvedValue({ kind: "error", code: "kw_transkrypcja_blad" });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    await user.upload(
      screen.getByTestId("kw-file-input") as HTMLInputElement,
      new File(["%PDF-1.4 fake"], "ksiega-lokalu.pdf", { type: "application/pdf" }),
    );

    await screen.findByText(/Nie udało się odczytać pliku PDF księgi/);
    expect(screen.queryByTestId("kw-transcribe-warn")).toBeNull();
  });

  /**
   * The sixth carrier, withdrawn. `kwTranscribe` is section state like
   * `kwState`, so it is cleared by `resetKwSection` — which only
   * `retractExamination` may call.
   *
   * The switch goes away AND BACK on purpose. Measured first with the switch
   * alone, this test passed with the clear removed: "Wpisz ręcznie" swaps the
   * whole upload branch for the manual warning, so the banner vanished because
   * nothing rendered it, not because anything was withdrawn. Returning to
   * "Wgraj PDF" re-mounts that branch and asks the state itself — with the
   * clear gone, a warning about a book the form no longer holds comes back.
   */
  it("drops the transcription warning when the examination is withdrawn (KR.0/KR.1)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_ODPIS);
    vi.mocked(transcribeKw).mockResolvedValue({ kind: "error", code: "kw_transkrypcja_ucieta" });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);
    await uploadOdpis(user);
    await screen.findByTestId("kw-transcribe-warn");

    await user.click(
      within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wklej z przeglądarki KW" }),
    );
    expect(screen.queryByTestId("kw-transcribe-warn")).toBeNull();
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    expect(screen.queryByTestId("kw-transcribe-warn")).toBeNull();
  });

  /**
   * A deed is not a book: /kw-transcribe expects the five dzialy of an eKW
   * printout, and an akt has none. Firing it there would spend a minute and a
   * model call to be told so.
   */
  it("does not transcribe on the developer (akt) path (KR.1)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_EXTRACT);
    const user = userEvent.setup();
    render(<SubjectForm />);
    await user.click(screen.getByLabelText(/zakup deweloperski/i));
    await user.upload(
      screen.getByTestId("kw-file-input") as HTMLInputElement,
      new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" }),
    );
    await screen.findByText(/Odczytano/);
    expect(transcribeKw).not.toHaveBeenCalled();
  });

  /**
   * Both reads ride on ONE minted token and ONE write of `kw`. Two writes
   * would race: the later one would overwrite the other's fields, and a
   * source switch mid-flight would have two stale results to fend off instead
   * of one.
   */
  it("mints one token for both reads and writes the snapshot once (KR.1)", async () => {
    vi.mocked(extractKw).mockResolvedValue(OK_ODPIS);
    vi.mocked(transcribeKw).mockResolvedValue({
      kind: "ok",
      tresc: transcribedBook(),
      walidacja: { ok: true, bledy: [] },
    });
    const user = userEvent.setup();
    render(<SubjectForm />);
    await fillRequiredExceptKw(user);
    await uploadOdpis(user);

    expect(vi.mocked(mintKwUploadToken)).toHaveBeenCalledTimes(1);
    const extractToken = vi.mocked(extractKw).mock.calls[0][0].token;
    expect(vi.mocked(transcribeKw).mock.calls[0][0].token).toBe(extractToken);
  });

  /**
   * A stored transcription survives re-entering step 1. `coerceLegacyKw`
   * (lib/subject-form.ts) rebuilds the snapshot field by field on the way back
   * in, and `tresc` is OPTIONAL on `KwSnapshot` — so a field forgotten there is
   * not a compile error, it is silent data loss: the appraiser re-opens step 1,
   * saves anything at all, and §8.2 quietly stops quoting the book.
   *
   * The defaults are built through `step1DefaultsFromInputs` — the function the
   * edit page actually calls — rather than handed to the form ready-made.
   * Written the short way first, this test passed with `tresc` missing from
   * `coerceLegacyKw`: it never reached the projection that drops it.
   */
  it("keeps a stored tresc across a step-1 edit that never touches the KW card (KR.1)", async () => {
    const tresc = transcribedBook();
    const stored = {
      ...step1DefaultsFromInputs({
        address: "ul. Kościelna 33, Poznań",
        area: 69.56,
        purpose: "sprzedaz",
        propertyRight: "wlasnosc_lokalu",
        kwNumber: tresc.polaDodatkowe.kwLokalu,
        client: "Jan Kowalski",
        inputs: {
          kw: {
            source: "odpis_kw",
            kwLokalu: tresc.polaDodatkowe.kwLokalu,
            kwGruntu: tresc.polaDodatkowe.kwGruntu,
            kwInne: [],
            deweloperski: false,
            powUzytkowaKw: 44.23,
            udzial: tresc.polaDodatkowe.udzial,
            sad: tresc.naglowek.sad,
            wydzial: tresc.naglowek.wydzial,
            dataDokumentu: null,
            dzial3: { wpisy: false, tresc: [] },
            dzial4: { wpisy: false, tresc: [] },
            dataBadania: "2026-09-15",
            nrLokalu: tresc.polaDodatkowe.numerLokalu,
            akt: { rodzaj: "UMOWA SPRZEDAŻY", rep: "6497/2018", data: "2018-06-21" },
            tresc,
          },
        },
      } as unknown as Parameters<typeof step1DefaultsFromInputs>[0]),
      inspectionDate: "2026-09-15",
    } as unknown as Parameters<typeof SubjectForm>[0]["defaults"];

    const user = userEvent.setup();
    render(<SubjectForm valuationId="val-tresc" defaults={stored} />);
    // An edit somewhere else entirely — the client's name.
    await user.clear(screen.getByLabelText("Zamawiający wycenę"));
    await user.type(screen.getByLabelText("Zamawiający wycenę"), "Anna Fikcyjna");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    const [, payload] = vi.mocked(saveSubjectAction).mock.calls[0] as unknown as [
      string,
      { kw?: { tresc?: unknown } },
    ];
    expect(payload.kw?.tresc).toEqual(tresc);
  });

  /**
   * B-07's half-made decision, end to end. Typing the Podstawa before picking a
   * tile used to produce `{ wariant: null }`, which `z.enum` rejected on a path
   * no input displays — the button did nothing and said nothing. The save must
   * go through (the draft keeps what was typed) and step 7 must still block.
   */
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("submits step 1 with a basis typed before any variant was chosen (W4 class)", async () => {
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
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("does not resurrect the manual book when the developer checkbox is ticked (W7 class)", async () => {
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
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("clears the encumbrance decision when the lokal book's source is switched", async () => {
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

    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    expect(screen.queryByTestId("kw-encumbrance")).toBeNull();
    await user.click(
      within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wklej z przeglądarki KW" }),
    );
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
    // Od ADR-021 migawka nosi kanał, którym karta stoi otworem — `ekw_reczne`
    // zostaje wyłącznie do ODCZYTU migawek sprzed tej zmiany.
    expect(payload.kw?.source).toBe("ekw_wklej");
    expect(payload.kw?.kwLokalu).toBe("AB1C/1/9");
  });

  /**
   * The property-right switch clears `kw` too, and the isolated harness could
   * only prove the value went away — it has no resolver, so it could not see
   * that the CLEARED form still submits. `kw` is `.optional()`, so clearing it
   * to `null` would fail validation on a path no field renders and the button
   * would go dead silently. Submitting is the assertion that matters.
   */
  // TODO(gluszyna-s3b): opisuje pola działów / ścieżkę ręczną sprzed ADR-021 — Task 4 przepisuje
  it.skip("still submits after the property right is switched (the clear must be a valid value)", async () => {
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
        .getByRole("radio", { name: "Wklej z przeglądarki KW" })
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

  /**
   * `kwMeta` is the extraction's provenance — WHICH model read the book and
   * WHEN. Until now nothing rendered it, so an orphan survived a retraction
   * harmlessly: `resetKwSection`'s `resetField("kwMeta")` restores the
   * DEFAULT, which in edit mode is the STORED meta, so a withdrawn
   * examination left the form with `kw: null` beside a full `kwMeta`.
   *
   * `b1-kw-read` ends that grace period: §7's examination protocol is made of
   * exactly those two facts, so a leftover would print "book examined with
   * model X on day Y" for a valuation that has no book (ADR-018 reg. 4, I-19).
   * Hence the sixth carrier joins `retractExamination` — the one place — and
   * the assertion is on the SUBMITTED payload, never on form state.
   */
  it("clears a STORED kwMeta when the property right changes in edit mode (KR.0)", async () => {
    const user = userEvent.setup();
    const stored = {
      address: "ul. Kościelna 33, Poznań",
      area: "69.56",
      purpose: "sprzedaz" as never,
      client: "Jan Kowalski",
      inspectionDate: "2026-09-15",
      kwNumber: "AB1C/1/9",
      kw: {
        source: "odpis_kw",
        kwLokalu: "AB1C/1/9",
        kwGruntu: "AB1C/2/7",
        kwInne: [],
        deweloperski: false,
        powUzytkowaKw: 69.56,
        udzial: "1234/56789",
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: { wpisy: false, tresc: [] },
        dzial4: { wpisy: false, tresc: [] },
        dataBadania: "2026-09-15",
      },
      kwMeta: {
        model: "claude-opus-5",
        extractedAt: "2026-09-15T08:00:00.000Z",
        docTypeDetected: "odpis_kw",
        docTypeDeclared: "odpis_kw",
      },
    } as unknown as Parameters<typeof SubjectForm>[0]["defaults"];

    render(<SubjectForm valuationId="val-meta" defaults={stored} />);

    await user.click(
      screen.getByRole("radio", { name: "Spółdzielcze własnościowe prawo do lokalu" }),
    );
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    const [, payload] = vi.mocked(saveSubjectAction).mock.calls[0] as unknown as [
      string,
      { kw?: unknown; kwMeta?: unknown },
    ];
    expect(payload.kw ?? null).toBeNull();
    // The point: the provenance of an examination that no longer exists must
    // not outlive it.
    expect(payload.kwMeta ?? null).toBeNull();
  });

  /**
   * The source switch, in EDIT mode — the gap the create-mode version of this
   * test could not see. `resetKwSection`'s `resetField` puts the STORED
   * decision back, so only the explicit retraction removes it.
   */
  it("clears a STORED encumbrance decision when the lokal book's source is switched (edit mode)", async () => {
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

    render(<SubjectForm valuationId="val-src" defaults={stored} />);
    expect(screen.getByTestId("kw-encumbrance")).toBeDefined();

    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    expect(screen.queryByTestId("kw-encumbrance")).toBeNull();
    await user.click(
      within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wklej z przeglądarki KW" }),
    );
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "AB1C/1/9");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(saveSubjectAction).toHaveBeenCalled());
    const [, payload] = vi.mocked(saveSubjectAction).mock.calls[0] as unknown as [
      string,
      { encumbranceTreatment?: unknown },
    ];
    expect(payload.encumbranceTreatment ?? null).toBeNull();
  });

  // D9: non-PDF is rejected client-side, before any network call.
  it("rejects a non-PDF file with an inline error and no extraction (D9)", async () => {
    // applyAccept:false (a setup() option in user-event v14) — the input has
    // accept="application/pdf", so userEvent would otherwise silently drop a
    // text/plain file and never fire onChange, bypassing the guard under test.
    const user = userEvent.setup({ applyAccept: false });
    render(<SubjectForm />);
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
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
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    const pdf = new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" });
    await user.upload(fileInput, pdf);
    await screen.findByText(/Odczytano/);

    await user.click(
      within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wklej z przeglądarki KW" }),
    );
    await user.type(screen.getByLabelText("Numer księgi lokalu"), "KW-MANUAL-1");
    await user.click(screen.getByRole("button", { name: /dane się zgadzają — dalej/i }));

    await waitFor(() => expect(createDraft).toHaveBeenCalled());
    const submitted = vi.mocked(createDraft).mock.calls[0][0] as {
      kw?: { source?: string; kwLokalu?: string | null; udzial?: string | null };
    };
    // Since ADR-018 the card submits a snapshot of its own — what must not
    // survive is the EXTRACT: none of the uploaded document's values ride along
    // inside it (the W7 write-once poisoning class). Since ADR-021 the source
    // it carries is the channel it stands on, never `ekw_reczne`.
    expect(submitted.kw?.source).toBe("ekw_wklej");
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

    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["%PDF-1.4 fake"], "akt.pdf", { type: "application/pdf" }),
    );
    await screen.findByText(/Odczytano/);
    // Auto-seeded from OK_EXTRACT.extract.powUzytkowaKw (69.56) into the blank field.
    await waitFor(() => expect(areaInput.value).toBe("69.56"));

    // Switch to manual → the doc-seeded (unedited) area is dropped.
    await user.click(
      within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wklej z przeglądarki KW" }),
    );
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
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
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
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
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
    await user.click(within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wgraj PDF" }));
    const fileInput = screen.getByTestId("kw-file-input") as HTMLInputElement;
    await user.upload(fileInput, new File(["%PDF-1.4"], "akt.pdf", { type: "application/pdf" }));
    // In-flight: the mint has resolved and extractKw was called but not resolved.
    await waitFor(() => expect(extractKw).toHaveBeenCalled());

    // Switch away, THEN let the now-stale extraction resolve.
    await user.click(
      within(kartaKsiegi("lokal")).getByRole("radio", { name: "Wklej z przeglądarki KW" }),
    );
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
    expect(submitted.kw?.source).toBe("ekw_wklej");
    expect(submitted.kw?.kwLokalu).toBe("KW-MANUAL-2");
    // Nothing from the stale extract leaked into the manual snapshot.
    expect(submitted.kw?.sad ?? null).toBeNull();
  });
});
