// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const saveFeaturesAction = vi.fn();
vi.mock("@/app/actions/wizard", () => ({
  saveFeaturesAction: (...args: unknown[]) => saveFeaturesAction(...args),
}));

import { StepFeatures } from "@/app/valuations/[id]/steps/step-features";
import type { Comparable, ComparableRatings } from "@/domain/kcs";
import type { Candidate } from "@/domain/sample-selection";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";

/**
 * Karta „Lokale o cenie skrajnej” (ADR-022, makieta 7) na PRAWDZIWYM
 * <StepFeatures> w trybie edycji — dwa lokale z próby (F-9: dane fikcyjne),
 * podpowiedzi z progów i z P.P, „Przyjmij”, zapis w wywołaniu akcji.
 */
const VID = "v1";

/** Klucze cech domyślnego worka (F-6) — komplet ocen lokalu skrajnego. */
const FEATURE_KEYS = [
  "dodatkowe",
  "lokalizacja",
  "polozenie-na-pietrze",
  "pomieszczenia-przynalezne",
  "powierzchnia-uzytkowa",
  "standard-wykonczenia",
];

function cand(
  over: Partial<Candidate> & Pick<Candidate, "transactionId" | "pricePerM2">,
): Candidate {
  return {
    date: "2026-01-20",
    area: 50,
    priceTotal: 0,
    egib: null,
    lokalId: `L-${over.transactionId}`,
    distanceM: 100,
    floor: 3,
    rooms: 2,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: null,
    street: "ul. Fikcyjna",
    ...over,
  };
}

// Cmax: kondygnacja 4 (3. piętro), 41,70 m², P.P tak; Cmin: parter, 57,90 m², P.P nie; środek: 50 m².
/**
 * Identyfikatory w kształcie EGiB — z KROPKAMI (i ukośnikiem w numerze
 * działki), bo cały sens reguły „oceny zapisywane całą mapą, nigdy ścieżką
 * react-hook-form" jest w kropce: RHF czyta kropkę w nazwie pola jako
 * zejście w głąb obiektu. Na fiksturze „A"/„B"/„C" (klucze `A|L-A`) zapis
 * ścieżką RHF przechodził bez jednego czerwonego testu (F3 recenzji całości
 * bloku).
 */
const A = cand({
  transactionId: "306401_1.0006.12/3",
  pricePerM2: 8847.74,
  area: 41.7,
  floor: 4,
  street: "os. Lecha",
  date: "2026-03-11",
  annex: true,
});
const B = cand({
  transactionId: "306401_1.0006.12/4",
  pricePerM2: 6338.03,
  area: 57.9,
  floor: 1,
  street: "ul. Fabianowo",
  date: "2025-11-05",
  annex: false,
});
const C = cand({ transactionId: "306401_1.0006.12/5", pricePerM2: 7000, area: 50 });

function selectionOf(candidates: Candidate[]): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: candidates,
    alternates: [],
    flags: {},
    rejectedCounts: {},
    radiusUsedM: 500,
    radiusWalk: [],
    counts: { pool: 3, inRadius: 3, afterHygiene: 3, afterBand: 3, proposed: 3 },
    params: { subjectArea: 48.6, todayMonth: "2026-09" },
  };
}
function comparablesOf(candidates: Candidate[]): Comparable[] {
  return candidates.map((c) => ({
    date: c.date,
    area: c.area,
    pricePerM2: c.pricePerM2,
    source: "rcn",
    transactionId: c.transactionId,
    lokalId: c.lokalId,
    status: "confirmed",
  }));
}

/** Komplet ocen na poziomie „lepsza” (opisanym w każdej cesze worka) dla podanych lokali. */
function ratingsFor(keys: string[]): ComparableRatings {
  return Object.fromEntries(
    keys.map((key) => [key, Object.fromEntries(FEATURE_KEYS.map((f) => [f, "lepsza" as const]))]),
  );
}

function renderStep(
  over: {
    candidates?: Candidate[];
    comparableRatings?: ComparableRatings | null;
    sampleSelection?: SampleSelectionSnapshot | null;
  } = {},
) {
  const candidates = over.candidates ?? [A, B, C];
  return render(
    <StepFeatures
      valuationId={VID}
      features={[]}
      comparables={comparablesOf(candidates)}
      sampleSelection={"sampleSelection" in over ? over.sampleSelection : selectionOf(candidates)}
      comparableRatings={over.comparableRatings ?? null}
      area={48.6}
      pietro={2}
    />,
  );
}

const card = () => screen.getByTestId("extremes-card");
const lokal = (n: number) => within(card()).getByTestId(`extreme-lokal-${n}`);
const group = (n: number, feature: string, side: "najwyższej" | "najniższej") =>
  within(lokal(n)).getByRole("radiogroup", { name: `${feature} — lokal o cenie ${side}` });

async function rateEverything(user: ReturnType<typeof userEvent.setup>) {
  for (const g of screen.getAllByRole("radiogroup")) {
    await user.click(within(g).getAllByRole("radio")[0]);
  }
}

/** Oceny wszystkich cech PRZEDMIOTU — bez ruszania karty lokali skrajnych. */
async function rateSubjectOnly(user: ReturnType<typeof userEvent.setup>) {
  for (const row of screen.getAllByTestId(/^feature-row-/)) {
    await user.click(within(row).getAllByRole("radio")[0]);
  }
}

describe("StepFeatures — lokale o cenie skrajnej (ADR-022, makieta 7)", () => {
  it("renderuje Cmax, potem Cmin, z nagłówkiem lokalu i podtytułem karty dosłownie z makiety", () => {
    renderStep();
    expect(card().textContent).toContain("Lokale o cenie skrajnej");
    expect(card().textContent).toContain(
      "oceniono 0 z 2 · operat opisuje je w §12.2 Twoimi ocenami",
    );
    const max = lokal(0).textContent!;
    expect(max).toContain("Cena najwyższa w próbie");
    // pl-PL nie grupuje tysięcy w liczbach czterocyfrowych (CLDR
    // `minimumGroupingDigits: 2`), więc ten sam formater co w podglądzie WR
    // drukuje „8847,74 zł/m²”, a nie „8 847,74” z makiety. Spacja opcjonalna,
    // żeby test przetrwał zmianę danych ICU.
    expect(max).toMatch(/8\s?847,74\s?zł\/m²/);
    expect(max).toContain("os. Lecha");
    expect(max).toContain("41,70 m²");
    expect(max).toContain("3. piętro");
    expect(max).toContain("transakcja 03.2026");
    expect(within(lokal(0)).getByText("Oceń cechy")).toBeTruthy();
    const min = lokal(1).textContent!;
    expect(min).toContain("Cena najniższa w próbie");
    expect(min).toContain("parter");
    expect(min).toContain("transakcja 11.2025");
    expect(screen.getByTestId("footnav-kcs-mid").textContent).toContain("lokale skrajne 0 z 2");
  });

  it("kafelki kompaktowe tylko dla poziomów opisanych, bez tekstu definicji", () => {
    renderStep();
    const radios = within(group(0, "Lokalizacja szczegółowa", "najwyższej")).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["przeciętna", "lepsza"]);
    expect(
      within(group(0, "Standard wykończenia", "najwyższej")).getAllByRole("radio"),
    ).toHaveLength(3);
  });

  it("podpowiedzi: piętro, parter, powierzchnia i P.P — teksty z makiety; standard bez podpowiedzi", () => {
    renderStep();
    // mediana metraży [41,7; 50; 57,9] = 50 → lepsza do 49 m², gorsza od 50 m².
    expect(screen.getByTestId("extreme-hint-0-polozenie-na-pietrze").textContent).toContain(
      "Podpowiedź: piętro lokalu 3 (rejestr) · próg „przeciętna” od 1 do 3 → przeciętna",
    );
    expect(screen.getByTestId("extreme-hint-0-powierzchnia-uzytkowa").textContent).toContain(
      "Podpowiedź: powierzchnia lokalu 41,70 m² ≈ 42 m² (rejestr) · próg „lepsza” do 49 m² → lepsza",
    );
    expect(screen.getByTestId("extreme-hint-0-pomieszczenia-przynalezne").textContent).toContain(
      "Podpowiedź: rejestr biura podaje pomieszczenie przynależne (P.P: tak) → lepsza",
    );
    expect(screen.getByTestId("extreme-hint-1-polozenie-na-pietrze").textContent).toContain(
      "Podpowiedź: parter (rejestr) · próg „gorsza” parter → gorsza",
    );
    expect(screen.getByTestId("extreme-hint-1-powierzchnia-uzytkowa").textContent).toContain(
      "Podpowiedź: powierzchnia lokalu 57,90 m² ≈ 58 m² (rejestr) · próg „gorsza” od 50 m² → gorsza",
    );
    expect(screen.getByTestId("extreme-hint-1-pomieszczenia-przynalezne").textContent).toContain(
      "Podpowiedź: rejestr biura nie podaje pomieszczenia przynależnego (P.P: nie) → gorsza",
    );
    expect(screen.queryByTestId("extreme-hint-0-standard-wykonczenia")).toBeNull();
    expect(screen.queryByTestId("extreme-hint-0-lokalizacja")).toBeNull();
  });

  it("„Przyjmij” zaznacza podpowiedziany kafelek i chowa podpowiedź; nic nie zaznacza się samo", async () => {
    const user = userEvent.setup();
    renderStep();
    const g = group(0, "Położenie na piętrze", "najwyższej");
    expect(
      within(g)
        .getAllByRole("radio")
        .every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    await user.click(
      within(screen.getByTestId("extreme-hint-0-polozenie-na-pietrze")).getByRole("button", {
        name: "Przyjmij",
      }),
    );
    expect(
      within(g)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-checked")),
    ).toEqual(["false", "true", "false"]);
    expect(screen.queryByTestId("extreme-hint-0-polozenie-na-pietrze")).toBeNull();
  });

  it("remis ceny najniższej daje kolejny blok lokalu — „0 z 3”", () => {
    const B2 = cand({ transactionId: "B2", pricePerM2: 6338.03, area: 44, floor: 2 });
    renderStep({ candidates: [A, B, B2, C] });
    expect(card().textContent).toContain("oceniono 0 z 3");
    expect(lokal(2).textContent).toContain("Cena najniższa w próbie");
  });

  it("zapis czeka na komplet ocen lokali i wysyła comparableRatings pod kluczami lokali", async () => {
    const user = userEvent.setup();
    saveFeaturesAction.mockClear();
    saveFeaturesAction.mockResolvedValue({ ok: true });
    renderStep();
    // Oceny przedmiotu — komplet; lokale skrajne — nic.
    await rateSubjectOnly(user);
    const submit = screen.getByRole("button", {
      name: "Zatwierdź cechy i dalej",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await rateEverything(user);
    expect(card().textContent).toContain("oceniono 2 z 2");
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(saveFeaturesAction).toHaveBeenCalled());
    const sent = saveFeaturesAction.mock.calls[0][1] as { comparableRatings: ComparableRatings };
    expect(Object.keys(sent.comparableRatings).sort()).toEqual([
      "306401_1.0006.12/3|L-306401_1.0006.12/3",
      "306401_1.0006.12/4|L-306401_1.0006.12/4",
    ]);
    expect(
      Object.keys(sent.comparableRatings["306401_1.0006.12/3|L-306401_1.0006.12/3"]).sort(),
    ).toEqual(FEATURE_KEYS);
  });

  /**
   * Finding F1 z review PR #79: `comparableRatings` MUSI siedzieć w
   * `defaultValues` formularza. Bez tego zapis kroku 4 wysyła `undefined`,
   * akcja utrwala `null` i każdy zapis kasuje pracę rzeczoznawcy — nawet gdy
   * karty w ogóle nie dotknął. Mutacja: usuń pole z `defaultValues` → ten test
   * czerwony (przycisk zostaje nieaktywny, zapis nie wychodzi).
   */
  it("zapis BEZ dotykania karty oddaje zapisane oceny nienaruszone (F1)", async () => {
    const user = userEvent.setup();
    saveFeaturesAction.mockClear();
    saveFeaturesAction.mockResolvedValue({ ok: true });
    const zapisane = ratingsFor([
      "306401_1.0006.12/3|L-306401_1.0006.12/3",
      "306401_1.0006.12/4|L-306401_1.0006.12/4",
    ]);
    renderStep({ comparableRatings: zapisane });
    expect(card().textContent).toContain("oceniono 2 z 2");

    await rateSubjectOnly(user);
    const submit = screen.getByRole("button", {
      name: "Zatwierdź cechy i dalej",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(saveFeaturesAction).toHaveBeenCalled());
    const sent = saveFeaturesAction.mock.calls[0][1] as { comparableRatings: ComparableRatings };
    expect(sent.comparableRatings).toEqual(zapisane);
  });

  it("zmiana próby: zapisane oceny pod starym kluczem nie liczą się i nie wracają w zapisie", async () => {
    const user = userEvent.setup();
    saveFeaturesAction.mockClear();
    saveFeaturesAction.mockResolvedValue({ ok: true });
    const stare = ratingsFor(["STARY|L"]);
    renderStep({ comparableRatings: stare });
    expect(card().textContent).toContain("oceniono 0 z 2");
    await rateEverything(user);
    await user.click(screen.getByRole("button", { name: "Zatwierdź cechy i dalej" }));
    await waitFor(() => expect(saveFeaturesAction).toHaveBeenCalled());
    const sent = saveFeaturesAction.mock.calls[0][1] as { comparableRatings: ComparableRatings };
    expect(sent.comparableRatings).not.toHaveProperty("STARY|L");
  });

  it("zapisane oceny pod żywym kluczem wracają zaznaczone (tryb edycji)", () => {
    renderStep({
      comparableRatings: {
        "306401_1.0006.12/3|L-306401_1.0006.12/3": { "standard-wykonczenia": "gorsza" },
      },
    });
    const g = group(0, "Standard wykończenia", "najwyższej");
    expect(
      within(g)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "false"]);
  });

  it("cecha z wagą 0 nie ma wiersza w karcie lokali", async () => {
    const user = userEvent.setup();
    renderStep();
    expect(screen.queryByTestId("extreme-row-0-dodatkowe")).toBeTruthy();
    const waga = within(screen.getByTestId("feature-row-dodatkowe")).getByRole("spinbutton");
    await user.clear(waga);
    await user.type(waga, "0");
    expect(screen.queryByTestId("extreme-row-0-dodatkowe")).toBeNull();
  });

  /**
   * Finding F2 z review PR #81: zapis oceny musi wychodzić od STANU FORMULARZA
   * odczytanego w chwili zapisu, nie od migawki `ratings` domkniętej w
   * renderze. Dwa kliknięcia zflushowane w jednym tiku czytałyby tę samą
   * migawkę i drugie skasowałoby pierwsze. Dziś żadna ścieżka użytkownika tam
   * nie sięga (kliknięcia są zdarzeniami dyskretnymi), ale programowa akcja
   * zapisująca wiele ocen naraz — „przyjmij wszystkie podpowiedzi” — sięgnie.
   * Mutacja: powrót do `{ ...ratings }` z domknięcia renderu → ten test
   * czerwony, pozostałe zielone.
   */
  it("dwie oceny zapisane w jednym tiku zostają obie (F2)", () => {
    renderStep();
    const standard = within(group(0, "Standard wykończenia", "najwyższej")).getAllByRole("radio");
    const lokalizacja = within(group(0, "Lokalizacja szczegółowa", "najwyższej")).getAllByRole(
      "radio",
    );
    act(() => {
      fireEvent.click(standard[0]);
      fireEvent.click(lokalizacja[0]);
    });
    expect(
      within(group(0, "Standard wykończenia", "najwyższej"))
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "false"]);
    expect(
      within(group(0, "Lokalizacja szczegółowa", "najwyższej"))
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-checked")),
    ).toEqual(["true", "false"]);
  });

  it("bez migawki próby karty nie ma, a pasek dolny nie liczy lokali skrajnych", () => {
    renderStep({ sampleSelection: null });
    expect(screen.queryByTestId("extremes-card")).toBeNull();
    expect(screen.getByTestId("footnav-kcs-mid").textContent).not.toContain("lokale skrajne");
  });
});
