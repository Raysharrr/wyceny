import { describe, expect, it } from "vitest";
import { composeMarketAnalysis, listPl, obrebyPhrase } from "@/domain/market-analysis";
import { plural } from "@/domain/plural";
import type { KcsInput } from "@/domain/kcs";
import type { Candidate, Selection } from "@/domain/sample-selection";
import {
  poolStatsOf,
  type PoolStats,
  type SampleSelectionSnapshot,
} from "@/domain/sample-snapshot";
import { approvableInput } from "./fixtures/valuation-inputs";

/**
 * §11 composed from the data (M-12). Every inflected variant a formula can
 * produce is enumerated here — the point of composing instead of generating is
 * that a grammatical slip is found once, in this file, not once per operat.
 * Fixtures are synthetic (F-9).
 */

const plain = (s: string) => s.replace(/ /g, " ");
const paragraphs = (s: string) => plain(s).split("\n\n");

// The numbers of the M-12 mockup the user accepted (valuation 5d165fe4 on staging).
const POOL: PoolStats = {
  areaMin: 29.38,
  areaMax: 102.65,
  unitPriceMin: 4395.6,
  unitPriceMax: 29998.06,
  unitPriceMean: 12890.3,
  totalMin: 200000,
  totalMax: 1625000,
  totalMean: 653733,
  excluded: { shares: true, area: true, price: false },
};

function selection(over: Partial<SampleSelectionSnapshot> = {}): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: [],
    alternates: [],
    flags: {},
    rejectedCounts: {},
    radiusUsedM: 1000,
    radiusWalk: [],
    counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 0 },
    params: { subjectArea: 48.2, todayMonth: "2026-09" },
    ...over,
  };
}

function compose(inputs: Partial<KcsInput>, address = "ul. Klonowa 14/3, Nowogród"): string {
  const base = approvableInput("test-user").inputs!;
  return composeMarketAnalysis({ address, inputs: { ...base, ...inputs } });
}

describe("§11 z danych — układ operatów wzorcowych", () => {
  it("intro, kryteria, zebrany zbiór, odrzucenia, próba — w tej kolejności", () => {
    const text = paragraphs(compose({ sampleSelection: selection({ poolStats: POOL }) }));

    expect(text[0]).toBe(
      "Dla określenia wartości rynkowej wycenianego lokalu o funkcji mieszkalnej przeprowadzono " +
        "analizę rynku lokalnego m. Nowogród, ze szczególnym uwzględnieniem lokalizacji lokalu " +
        "stanowiącego przedmiot wyceny.",
    );
    expect(text[1]).toBe(
      [
        "Cechy analizowanego rynku:",
        "• zakres przedmiotowy – rynek wtórny lokali mieszkalnych,",
        "• obszar badania – m. Nowogród,",
        "• powierzchnia użytkowa – od 33,74 m2 do 62,66 m2,",
        "• zakres czasowy badania – 2 lata wstecz od daty wyceny.",
      ].join("\n"),
    );
    expect(text[2]).toBe(
      "W okresie monitorowania rynku lokalnego odnotowano transakcje na badanym terenie, w których " +
        "wystąpiła sprzedaż lokali mieszkalnych. Powierzchnia użytkowa lokali wynosiła od 29,38 m2 " +
        "do 102,65 m2. Jednostkowe ceny transakcyjne znajdowały się w przedziale od 4 395,60 zł do " +
        "29 998,06 zł za 1 m2 powierzchni użytkowej lokalu. Średnia cena została ustalona na poziomie " +
        "12 890,30 zł za 1 m2. Ceny transakcyjne kształtowały się od 200 000 zł do 1 625 000 zł. " +
        "Średnia cena wyniosła 653 733 zł.",
    );
    expect(text[3]).toBe(
      "W toku analizy odrzucono transakcje dotyczące udziałów w lokalach oraz lokale o powierzchni " +
        "użytkowej poniżej 33,74 m2 i powyżej 62,66 m2. Powyższe transakcje nie wykazywały cech " +
        "podobieństwa do przedmiotu wyceny.",
    );
    expect(text[4]).toMatch(/^Do porównań przyjęto 12 transakcji dotyczących lokali\./);
    expect(text).toHaveLength(5);
  });

  it("the bullet states the selection CRITERION, never the sample's own spread (D-39)", () => {
    const text = plain(compose({ sampleSelection: selection() }));
    expect(text).toContain("• powierzchnia użytkowa – od 33,74 m2 do 62,66 m2,");
    expect(text).not.toContain("zakres czasowy badania – transakcje z okresu");
  });

  it("prints no count of examined or rejected transactions and no price threshold (D9)", () => {
    const text = plain(
      compose({
        sampleSelection: selection({
          poolStats: { ...POOL, excluded: { shares: true, area: true, price: true } },
          params: {
            subjectArea: 48.2,
            todayMonth: "2026-09",
            unitPriceRange: { min: 9000, max: 12000 },
          },
          counts: { pool: 5000, inRadius: 779, afterHygiene: 60, afterBand: 39, proposed: 20 },
        }),
      }),
    );
    expect(text).not.toContain("przebadano");
    // The band's bounds and every count stay out; "779" and "9 000 zł" are unique to them here.
    for (const leak of ["9 000 zł", "12 000 zł", "779", "5 000 transakcji"]) {
      expect(text).not.toContain(leak);
    }
    expect(text).toContain("lokale odbiegające ceną od średniej ceny transakcyjnej");
  });
});

describe("stara wycena bez statystyk zbioru (decyzja A)", () => {
  it("drops both paragraphs about the set and keeps everything else", () => {
    const text = plain(compose({ sampleSelection: selection() }));
    expect(text).not.toContain("W okresie monitorowania");
    expect(text).not.toContain("W toku analizy odrzucono");
    expect(paragraphs(text)).toHaveLength(3);
  });

  it("a hand-entered sample, with no selection behind it, says nothing about criteria it never had", () => {
    const text = plain(compose({ sampleSelection: undefined }));
    expect(text).not.toContain("wstecz od daty wyceny");
    expect(text).not.toContain("33,74");
  });

  it("returns nothing without a usable sample", () => {
    expect(compose({ comparables: [] })).toBe("");
  });
});

describe("odmiana — każdy wariant zdania", () => {
  it.each([
    [1, "Do porównań przyjęto 1 transakcję dotyczącą lokalu."],
    [2, "Do porównań przyjęto 2 transakcje dotyczące lokali."],
    [4, "Do porównań przyjęto 4 transakcje dotyczące lokali."],
    [5, "Do porównań przyjęto 5 transakcji dotyczących lokali."],
    [12, "Do porównań przyjęto 12 transakcji dotyczących lokali."],
    [22, "Do porównań przyjęto 22 transakcje dotyczące lokali."],
  ])("%i transakcji w próbie", (n, opening) => {
    const pool = approvableInput("test-user").inputs!.comparables;
    const comparables = Array.from({ length: n }, (_, i) => pool[i % pool.length]);
    const text = paragraphs(compose({ comparables }));
    expect(text[text.length - 1].startsWith(opening)).toBe(true);
  });

  it.each([
    [{ shares: true, area: false, price: false }, "transakcje dotyczące udziałów w lokalach"],
    [
      { shares: false, area: true, price: false },
      "lokale o powierzchni użytkowej poniżej 33,74 m2 i powyżej 62,66 m2",
    ],
    [
      { shares: false, area: false, price: true },
      "lokale odbiegające ceną od średniej ceny transakcyjnej",
    ],
    [
      { shares: true, area: true, price: false },
      "transakcje dotyczące udziałów w lokalach oraz lokale o powierzchni użytkowej poniżej 33,74 m2 i powyżej 62,66 m2",
    ],
    [
      { shares: true, area: false, price: true },
      "transakcje dotyczące udziałów w lokalach oraz lokale odbiegające ceną od średniej ceny transakcyjnej",
    ],
    [
      { shares: false, area: true, price: true },
      "lokale o powierzchni użytkowej poniżej 33,74 m2 i powyżej 62,66 m2 oraz lokale odbiegające ceną od średniej ceny transakcyjnej",
    ],
    [
      { shares: true, area: true, price: true },
      "transakcje dotyczące udziałów w lokalach, lokale o powierzchni użytkowej poniżej 33,74 m2 i powyżej 62,66 m2 oraz lokale odbiegające ceną od średniej ceny transakcyjnej",
    ],
  ])("odrzucenia %o", (excluded, list) => {
    const text = plain(
      compose({ sampleSelection: selection({ poolStats: { ...POOL, excluded } }) }),
    );
    expect(text).toContain(
      `W toku analizy odrzucono ${list}. Powyższe transakcje nie wykazywały cech podobieństwa do przedmiotu wyceny.`,
    );
  });

  it("nothing rejected within the set — no rejection paragraph at all", () => {
    const text = plain(
      compose({
        sampleSelection: selection({
          poolStats: { ...POOL, excluded: { shares: false, area: false, price: false } },
        }),
      }),
    );
    expect(text).not.toContain("W toku analizy odrzucono");
  });

  it.each([
    [{ min: 40, max: 60 }, "od 40,00 m2 do 60,00 m2", "poniżej 40,00 m2 i powyżej 60,00 m2"],
    [{ min: 40 }, "od 40,00 m2", "poniżej 40,00 m2"],
    [{ max: 60 }, "do 60,00 m2", "powyżej 60,00 m2"],
  ])("własny zakres powierzchni %o", (areaRange, bullet, rejected) => {
    const text = plain(
      compose({
        sampleSelection: selection({
          poolStats: { ...POOL, excluded: { shares: false, area: true, price: false } },
          params: { subjectArea: 48.2, todayMonth: "2026-09", areaRange },
        }),
      }),
    );
    expect(text).toContain(`• powierzchnia użytkowa – ${bullet},`);
    expect(text).toContain(`odrzucono lokale o powierzchni użytkowej ${rejected}.`);
  });

  it.each([
    [["Zarzecze"], "obręb Zarzecze"],
    [["Podgórze", "Zarzecze"], "obręby Podgórze i Zarzecze"],
    [["Jeżyce", "Podgórze", "Zarzecze"], "obręby Jeżyce, Podgórze i Zarzecze"],
  ])("obręby %o", (obreby, phrase) => {
    expect(obrebyPhrase(obreby)).toBe(phrase);
  });

  it("list conjunctions", () => {
    expect(listPl(["A"], "oraz")).toBe("A");
    expect(listPl(["A", "B"], "oraz")).toBe("A oraz B");
    expect(listPl(["A", "B", "C"], "oraz")).toBe("A, B oraz C");
  });

  it.each([
    [1, "rok"],
    [2, "lata"],
    [5, "lat"],
  ])("okno %i lat", (n, word) => {
    expect(plural(n, "rok", "lata", "lat")).toBe(word);
  });
});

describe("statystyki zbioru liczone przy doborze", () => {
  const c = (id: string, area: number, pricePerM2: number, priceTotal = 0) =>
    ({ transactionId: id, area, pricePerM2, priceTotal }) as unknown as Candidate;
  const rejected = (
    candidate: Candidate,
    ...allReasons: Selection["rejected"][number]["allReasons"]
  ) => ({
    candidate,
    reason: allReasons[0],
    allReasons,
  });

  it("counts band rejections and shares IN the set, and nothing that failed hygiene", () => {
    const s = {
      ranking: [{ candidate: c("a", 50, 10000, 500000), score: 1 }],
      rejected: [
        rejected(c("b", 30, 12000), "out_of_area_band"),
        rejected(c("c", 45, 8000), "share_not_whole"),
        // A share that is ALSO outside the window was never in the set.
        rejected(c("d", 45, 99999), "share_not_whole", "out_of_window"),
        rejected(c("e", 45, 99999), "not_residential"),
        rejected(c("f", 0, 0), "no_price"),
      ],
    } as unknown as Selection;

    expect(poolStatsOf(s)).toEqual({
      areaMin: 30,
      areaMax: 50,
      unitPriceMin: 8000,
      unitPriceMax: 12000,
      unitPriceMean: 10000,
      totalMin: 360000,
      totalMax: 500000,
      totalMean: (500000 + 360000 + 360000) / 3,
      excluded: { shares: true, area: true, price: false },
    });
  });

  it("is null when the set is empty", () => {
    expect(poolStatsOf({ ranking: [], rejected: [] } as unknown as Selection)).toBeNull();
  });
});
