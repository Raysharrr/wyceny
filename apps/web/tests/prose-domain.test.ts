import { describe, expect, it } from "vitest";
import {
  buildProseFacts,
  buildProseTransactions,
  resultPosition,
  selectProseSections,
  type ProseFacts,
} from "@/domain/prose";
import { currentProseFactsHash, proseFactsHash } from "@/domain/prose-hash";
import { buildDocumentModel, formatNumber, formatPln } from "@/domain/document-model";
import { computeKcs, type KcsInput, type KcsResult } from "@/domain/kcs";

/**
 * Domain tests for the LLM prose proposal (ADR-014, T5).
 *
 * F-9: every address, parcel and number below is INVENTED (ul. Klonowa,
 * m. Nowogród) — this repo is public and no reference-operat data may leak
 * into it, comments and docstrings included.
 *
 * The load-bearing property is the cross-assertion against
 * `buildDocumentModel`: the worker's number guard compares WRITTEN FORMS, so
 * a fact formatted even one decimal apart from the operat table would make
 * the operat contradict itself.
 */

const NBSP = " ";
const ENDASH = "–";

/**
 * Dates are deliberately out of lexicographic order: "11-2024" < "12-2024"
 * but "03-2025" sorts FIRST as a string, so a lexicographic min/max would
 * report the range backwards ("03-2025 – 12-2024").
 */
const COMPARABLES: KcsInput["comparables"] = [
  {
    date: "2024-11",
    area: 58.1,
    pricePerM2: 9240,
    source: "rcn",
    transactionId: "tx-1",
    status: "to_verify",
  },
  { date: "2025-03", area: 79.9, pricePerM2: 12480, source: "rcn", transactionId: "tx-2" },
  { date: "2024-12", area: 64, pricePerM2: 10725, source: "manual" },
];

const FEATURES: KcsInput["features"] = [
  { key: "standard_wykonczenia", name: "standard wykończenia", weight: 0.5, rating: "przecietna" },
  { key: "stan_techniczny", name: "stan techniczny budynku", weight: 0.5, rating: "lepsza" },
  // Weight 0 — excluded from the operat ("pancerz obronny"), so it must not
  // reach the model either.
  { key: "winda", name: "winda", weight: 0, rating: "gorsza" },
];

const NOTE = "Układ: 2 pokoje, kuchnia, łazienka; otoczenie: zabudowa wielorodzinna, sklepy.";

const INPUTS: KcsInput = {
  comparables: COMPARABLES,
  area: 68.4,
  features: FEATURES,
  subject: {
    obreb: "0007 Zarzecze",
    nrDzialki: "112/4",
    powEwidHa: 0.184,
    uzytek: "B – tereny mieszkaniowe",
    budynekRodzaj: "budynek mieszkalny wielorodzinny",
    kondygnacjeNadziemne: 5,
    kondygnacjePodziemne: 1,
    rokBudowy: 2014,
  },
  inspection: { note: NOTE, photos: { otoczenie: [], budynekZewn: [], wnetrza: [] } },
};

const ADDRESS = "ul. Klonowa 14/3, Nowogród";

describe("buildProseFacts", () => {
  it("builds every key of the section prompts' DANE blocks, Polish-formatted", () => {
    const facts = buildProseFacts({ address: ADDRESS, inputs: INPUTS });

    expect(facts).toEqual({
      adres: ADDRESS,
      obreb: "0007 Zarzecze",
      pow_uzytkowa: "68,40",
      rynek: "wtórny, lokale mieszkalne",
      proba: {
        liczba_transakcji: 3,
        zakres_dat: `11-2024 ${ENDASH} 03-2025`,
        pow_min_m2: "58,10",
        pow_max_m2: "79,90",
        cena_min_zl_m2: `9${NBSP}240,00`,
        cena_srednia_zl_m2: `10${NBSP}815,00`,
        cena_max_zl_m2: `12${NBSP}480,00`,
        cena_calkowita_min_zl: `536${NBSP}844`,
        cena_calkowita_max_zl: `997${NBSP}152`,
      },
      nr_dzialki: "112/4",
      pow_dzialki_m2: `1${NBSP}840`,
      uzytek: "B – tereny mieszkaniowe",
      budynek_rodzaj: "budynek mieszkalny wielorodzinny",
      kondygnacje: "5",
      rok_budowy: "2014",
      notatka_uklad: NOTE,
      notatka_otoczenie: NOTE,
      notatka_standard: NOTE,
      notatka_zagospodarowanie: NOTE,
      oceny_cech: { "standard wykończenia": "przeciętna", "stan techniczny budynku": "lepsza" },
      pozycja_wyniku: "w przedziale cen próby, powyżej średniej",
    });
  });

  it("prices are written EXACTLY as the operat table writes them (same formatters)", () => {
    const kcs = computeKcs(INPUTS);
    const doc = buildDocumentModel({
      address: ADDRESS,
      area: INPUTS.area,
      purpose: "sprzedaz",
      kwNumber: "KW-TEST-1",
      client: "Bank Przykładowy S.A.",
      inspectionDate: "2026-01-15",
      approvedAt: new Date("2026-01-20T09:00:00.000Z"),
      inputs: INPUTS,
      kcs,
      amountInWords: "osiemset tysięcy złotych",
    });

    const facts = buildProseFacts({ address: ADDRESS, inputs: INPUTS });

    expect(facts.proba?.cena_min_zl_m2).toBe(doc.cena_min);
    expect(facts.proba?.cena_srednia_zl_m2).toBe(doc.cena_sr);
    expect(facts.proba?.cena_max_zl_m2).toBe(doc.cena_max);
    expect(facts.pow_uzytkowa).toBe(doc.powierzchnia);
  });

  it("omits what the draft does not carry — no guessing (dzielnica, EGiB, notes)", () => {
    const facts = buildProseFacts({
      address: ADDRESS,
      inputs: { comparables: COMPARABLES, area: 68.4, features: FEATURES },
    });

    expect(facts).not.toHaveProperty("dzielnica");
    expect(facts).not.toHaveProperty("obreb");
    expect(facts).not.toHaveProperty("nr_dzialki");
    expect(facts).not.toHaveProperty("rok_budowy");
    expect(facts).not.toHaveProperty("notatka_uklad");
    expect(facts.oceny_cech).toEqual({
      "standard wykończenia": "przeciętna",
      "stan techniczny budynku": "lepsza",
    });
  });

  it("no comparables: no proba, no pozycja_wyniku, notes still available", () => {
    const facts = buildProseFacts({
      address: ADDRESS,
      inputs: { comparables: [], area: 68.4, features: [], inspection: INPUTS.inspection },
    });

    expect(facts).not.toHaveProperty("proba");
    expect(facts).not.toHaveProperty("pozycja_wyniku");
    expect(facts.notatka_otoczenie).toBe(NOTE);
  });

  it("undated / area-less comparables: prices stay, the derived ranges drop out", () => {
    const facts = buildProseFacts({
      address: ADDRESS,
      inputs: {
        comparables: [{ pricePerM2: 9240 }, { pricePerM2: 12480 }, { pricePerM2: 10725 }],
        area: 68.4,
        features: FEATURES,
      },
    });

    expect(facts.proba?.liczba_transakcji).toBe(3);
    expect(facts.proba?.cena_min_zl_m2).toBe(`9${NBSP}240,00`);
    expect(facts.proba).not.toHaveProperty("zakres_dat");
    expect(facts.proba).not.toHaveProperty("pow_min_m2");
    expect(facts.proba).not.toHaveProperty("cena_calkowita_min_zl");
  });

  it("every numeric leaf is a PL string — the only int is proba.liczba_transakcji (worker 400)", () => {
    const facts = buildProseFacts({ address: ADDRESS, inputs: INPUTS });

    const numberPaths: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "number") numberPaths.push(path);
      else if (value && typeof value === "object")
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(facts, "fakty");

    expect(numberPaths).toEqual(["fakty.proba.liczba_transakcji"]);
  });
});

describe("proseFactsHash", () => {
  it("is stable under key order — the same facts always fingerprint the same", () => {
    const facts = buildProseFacts({ address: ADDRESS, inputs: INPUTS });
    // Same content, every object rebuilt with its keys reversed.
    const reversed = JSON.parse(
      JSON.stringify(facts, (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    ) as ProseFacts;

    expect(Object.keys(reversed)).not.toEqual(Object.keys(facts));
    expect(proseFactsHash(reversed)).toBe(proseFactsHash(facts));
  });

  it("is a hex sha256 and changes when any fact changes", () => {
    const facts = buildProseFacts({ address: ADDRESS, inputs: INPUTS });

    expect(proseFactsHash(facts)).toMatch(/^[0-9a-f]{64}$/);
    expect(proseFactsHash({ ...facts, adres: "ul. Klonowa 14/4, Nowogród" })).not.toBe(
      proseFactsHash(facts),
    );
    expect(
      proseFactsHash({
        ...facts,
        proba: { ...facts.proba!, liczba_transakcji: facts.proba!.liczba_transakcji + 1 },
      }),
    ).not.toBe(proseFactsHash(facts));
  });
});

describe("a partial sample never describes itself as a whole one (review I-1)", () => {
  // `date` and `area` are both OPTIONAL on a manually entered comparable, so a
  // mixed sample is a normal flow, not an edge case. `liczba_transakcji` counts
  // EVERY comparable, so any aggregate computed from a subset would attribute
  // the subset's span to the whole sample — a falsifiable untruth the number
  // guard cannot catch, because every number in it IS in the facts.
  const probaFor = (comparables: KcsInput["comparables"]) =>
    buildProseFacts({ address: ADDRESS, inputs: { ...INPUTS, comparables } }).proba;

  it("one dateless comparable: no date range at all, not the dated subset's range", () => {
    const mixed = [COMPARABLES[0], { area: 64, pricePerM2: 10725, source: "manual" as const }];

    const proba = probaFor(mixed);

    expect(proba?.liczba_transakcji).toBe(2);
    expect(proba?.zakres_dat).toBeUndefined();
  });

  it("one arealess comparable: no area band and no total-price range", () => {
    const mixed = [
      COMPARABLES[0],
      { date: "2025-03", pricePerM2: 12480, source: "manual" as const },
    ];

    const proba = probaFor(mixed);

    expect(proba?.liczba_transakcji).toBe(2);
    expect(proba?.pow_min_m2).toBeUndefined();
    expect(proba?.pow_max_m2).toBeUndefined();
    expect(proba?.cena_calkowita_min_zl).toBeUndefined();
    expect(proba?.cena_calkowita_max_zl).toBeUndefined();
  });

  it("either gap leaves the aggregate ABSENT, and the section is still offered", () => {
    // What must never happen is a PARTIAL aggregate — "3 transakcje z okresu
    // 11-2024 – 11-2024" is a falsifiable untruth the number guard cannot
    // catch, because every number in it really is in the facts. Absence is
    // honest: the style guide drops a thread with no fact behind it. And since
    // §11 lost its static scaffolding, withholding the whole section on a gap
    // left the appraiser writing the market analysis from nothing.
    const undated = [COMPARABLES[0], { area: 64, pricePerM2: 10725, source: "manual" as const }];
    const arealess = [
      COMPARABLES[0],
      { date: "2025-03", pricePerM2: 12480, source: "manual" as const },
    ];

    for (const comparables of [undated, arealess]) {
      const facts = buildProseFacts({ address: ADDRESS, inputs: { ...INPUTS, comparables } });

      expect(selectProseSections(facts)).toContain("analiza_rynku");
    }
    expect(
      buildProseFacts({ address: ADDRESS, inputs: { ...INPUTS, comparables: undated } }).proba
        ?.zakres_dat,
    ).toBeUndefined();
    expect(
      buildProseFacts({ address: ADDRESS, inputs: { ...INPUTS, comparables: arealess } }).proba
        ?.pow_min_m2,
    ).toBeUndefined();
  });

  it("a complete sample still reports both", () => {
    const proba = probaFor(COMPARABLES);

    expect(proba?.zakres_dat).toBe(`11-2024 ${ENDASH} 03-2025`);
    expect(proba?.pow_min_m2).toBe("58,10");
    expect(proba?.cena_calkowita_min_zl).toBeDefined();
  });
});

describe("currentProseFactsHash — the fingerprint covers the transactions too (review I-2)", () => {
  /**
   * The worker injects `proba.trend_cen = price_trend(transakcje)` into the
   * facts EVERY section sees (`apps/worker/app/main.py`), so the transactions
   * are an input to the prose even though they travel outside `fakty`. A
   * fingerprint over the facts alone would call the proposals current after an
   * edit that reverses the trend the operat asserts.
   *
   * Same prices, same areas, same month SET — only which row carries which
   * month changes. Every fact is therefore byte-identical (the date range is
   * built from the sorted month set; the price and area aggregates are
   * order-free), while `price_trend` sorts chronologically and reads the
   * opposite direction.
   */
  const row = (date: string, pricePerM2: number) => ({
    date,
    area: 60,
    pricePerM2,
    source: "manual" as const,
  });
  const rising: KcsInput = {
    ...INPUTS,
    comparables: [row("2024-01", 9000), row("2024-06", 10000), row("2024-12", 11000)],
  };
  const falling: KcsInput = {
    ...INPUTS,
    comparables: [row("2024-12", 9000), row("2024-06", 10000), row("2024-01", 11000)],
  };

  it("the facts alone cannot tell these two samples apart", () => {
    expect(buildProseFacts({ address: ADDRESS, inputs: falling })).toEqual(
      buildProseFacts({ address: ADDRESS, inputs: rising }),
    );
  });

  it("…but the transactions do, so the fingerprint must differ", () => {
    expect(currentProseFactsHash({ address: ADDRESS, inputs: falling })).not.toBe(
      currentProseFactsHash({ address: ADDRESS, inputs: rising }),
    );
  });

  it("is a hex sha256 and still moves when a plain fact moves", () => {
    const hash = currentProseFactsHash({ address: ADDRESS, inputs: INPUTS });

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      currentProseFactsHash({ address: "ul. Klonowa 14/4, Nowogród", inputs: INPUTS }),
    ).not.toBe(hash);
  });
});

describe("resultPosition (F-11: the result travels as a category, never an amount)", () => {
  /** cmin 9 240 · csr 10 815 · cmax 12 480 — the sample above, invented. */
  const at = (unitValue: number): KcsResult => ({
    csr: 10815,
    cmin: 9240,
    cmax: 12480,
    vmin: 0.854,
    vmax: 1.154,
    ui: [],
    sumUi: 1,
    unitValue,
    wrUnrounded: unitValue * 68.4,
    wr: Math.round((unitValue * 68.4) / 100) * 100,
  });

  it.each([
    [9000, "poniżej przedziału cen próby"],
    [13000, "powyżej przedziału cen próby"],
    [10815, "w przedziale cen próby, zbliżona do średniej"],
    [10900, "w przedziale cen próby, zbliżona do średniej"],
    [11500, "w przedziale cen próby, powyżej średniej"],
    [10000, "w przedziale cen próby, poniżej średniej"],
    // Boundaries belong to the range: equal to cmin/cmax is IN, not out.
    [9240, "w przedziale cen próby, poniżej średniej"],
    [12480, "w przedziale cen próby, powyżej średniej"],
  ])("unit value %s -> %s", (unitValue, expected) => {
    expect(resultPosition(at(unitValue))).toBe(expected);
  });

  it("never carries a digit — no WR, no unit value, in any branch", () => {
    for (const unitValue of [9000, 9240, 10000, 10815, 10900, 11500, 12480, 13000]) {
      expect(resultPosition(at(unitValue))).not.toMatch(/\d/);
    }
  });
});

describe("selectProseSections", () => {
  const sectionsFor = (inputs: KcsInput) =>
    selectProseSections(buildProseFacts({ address: ADDRESS, inputs }));

  it("a complete draft asks for all six sections", () => {
    expect(sectionsFor(INPUTS)).toEqual([
      "analiza_rynku",
      "opis_lokalu",
      "otoczenie",
      "zagospodarowanie",
      "standard",
      "uzasadnienie",
    ]);
  });

  it("no inspection note: the note-driven sections drop out", () => {
    expect(sectionsFor({ ...INPUTS, inspection: null })).toEqual([
      "analiza_rynku",
      // zagospodarowanie survives on the EGiB facts alone, standard on oceny_cech
      "zagospodarowanie",
      "standard",
      "uzasadnienie",
    ]);
  });

  it("no comparables: no analiza_rynku and no uzasadnienie", () => {
    expect(sectionsFor({ ...INPUTS, comparables: [] })).toEqual([
      "opis_lokalu",
      "otoczenie",
      "zagospodarowanie",
      "standard",
    ]);
  });

  it("zero effective weight: uzasadnienie drops (unit value 0 would read as 'below the sample')", () => {
    const zeroWeights = INPUTS.features.map((f) => ({ ...f, weight: 0 }));

    expect(sectionsFor({ ...INPUTS, features: zeroWeights })).not.toContain("uzasadnienie");
  });

  it("dateless comparables: analiza_rynku stays, minus the date-range thread", () => {
    const undated = INPUTS.comparables.map(({ date: _d, ...rest }) => rest);

    expect(sectionsFor({ ...INPUTS, comparables: undated })).toContain("analiza_rynku");
    // ...and the transactions stay home, so no trend is claimed either.
    expect(buildProseTransactions(undated)).toEqual([]);
  });

  it("an empty draft asks for nothing at all", () => {
    expect(sectionsFor({ comparables: [], area: 68.4, features: [] })).toEqual([]);
  });
});

describe("buildProseTransactions", () => {
  it("sends MM-RRRR + a NUMERIC price for a fully dated sample", () => {
    expect(buildProseTransactions(COMPARABLES)).toEqual([
      { data: "11-2024", cena_m2: 9240 },
      { data: "03-2025", cena_m2: 12480 },
      { data: "12-2024", cena_m2: 10725 },
    ]);
  });

  // Same all-or-nothing doctrine as the aggregates (review finding I-1). The
  // worker turns these into `proba.trend_cen` — a claim about how prices moved
  // across THE SAMPLE. Built from the dated subset it would describe a
  // different sample than the one the operat presents, and the number guard
  // cannot catch that: "wzrostowe" carries no number at all.
  it("sends nothing when any comparable lacks a usable month", () => {
    expect(buildProseTransactions([...COMPARABLES, { pricePerM2: 8100 }])).toEqual([]);
    expect(buildProseTransactions([...COMPARABLES, { date: "2024-13", pricePerM2: 8000 }])).toEqual(
      [],
    );
  });
});

describe("F-11 — the market value never leaves the web", () => {
  it("no form of wr or the unit value appears anywhere in the outgoing payload", () => {
    const kcs = computeKcs(INPUTS);
    const payload = JSON.stringify({
      fakty: buildProseFacts({ address: ADDRESS, inputs: INPUTS }),
      transakcje: buildProseTransactions(INPUTS.comparables),
    });

    for (const value of [kcs.wr, kcs.wrUnrounded, kcs.unitValue]) {
      expect(payload).not.toContain(String(value));
      expect(payload).not.toContain(formatPln(value));
      expect(payload).not.toContain(formatNumber(value, 0));
    }
  });
});

describe("controller fixes after the T7 review", () => {
  it("reordering the sample does not change the fingerprint (the worker sorts anyway)", () => {
    // A blocker that fires on an edit the model cannot see forces a paid
    // regeneration that changes nothing — and teaches the appraiser to click
    // through the gate. `prose.py` orders the sample chronologically before
    // halving the period, so row order is invisible downstream.
    const base = { address: ADDRESS, inputs: INPUTS };
    const shuffled = {
      address: ADDRESS,
      inputs: { ...INPUTS, comparables: [...COMPARABLES].reverse() },
    };

    expect(currentProseFactsHash(shuffled)).toBe(currentProseFactsHash(base));
  });

  it("a changed price still changes the fingerprint", () => {
    const edited = {
      address: ADDRESS,
      inputs: {
        ...INPUTS,
        comparables: [{ ...COMPARABLES[0]!, pricePerM2: 9241 }, ...COMPARABLES.slice(1)],
      },
    };

    expect(currentProseFactsHash(edited)).not.toBe(
      currentProseFactsHash({ address: ADDRESS, inputs: INPUTS }),
    );
  });

  it("analiza_rynku is offered on any sample — §11 has no static scaffolding left", () => {
    // The aggregates are all-or-nothing, so a missing one is ABSENT, not
    // partial, and the style guide drops a thread with no fact behind it.
    // Withholding the section left the appraiser writing §11 from nothing.
    const facts = buildProseFacts({
      address: ADDRESS,
      inputs: {
        comparables: [{ pricePerM2: 9240 }, { pricePerM2: 12480 }],
        area: 68.4,
        features: FEATURES,
      },
    });

    expect(facts.proba).not.toHaveProperty("zakres_dat");
    expect(selectProseSections(facts)).toContain("analiza_rynku");
  });
});
