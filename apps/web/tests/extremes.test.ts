import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidateOf,
  extremeComparables,
  extremeLokale,
  measuredLevel,
  pruneComparableRatings,
  suggestedRating,
  type ExtremeLokal,
} from "../src/domain/extremes";
import { FEATURE_PRESETS, powierzchniaMeasure } from "../src/domain/feature-presets";
import type { Feature, KcsInput } from "../src/domain/kcs";
import type { Candidate } from "../src/domain/sample-selection";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";
import { leakingPaths } from "./support/fixture-isolation";

/**
 * Lokale o cenie skrajnej (ADR-022, R4): jedno źródło dla §12.2, kroku 4 i
 * bramki B-18. Fikstura 14.09: remis Cmin (TX-01, TX-02), Cmax = TX-12 na
 * kondygnacji 4 (piętro 3).
 */
const inputs1409 = () => wycena1409Anon().inputs;

const preset = (key: string) => FEATURE_PRESETS.lokal.find((e) => e.key === key)!;
/**
 * Fabryka cechy z presetu. `structuredClone` na CAŁYM presecie, nie spread na
 * definicjach: spread kopiuje wyłącznie pierwszy poziom, więc pierwsza
 * definicja o strukturze zamiast stringa byłaby współdzieloną referencją do
 * `FEATURE_PRESETS` i zapis w jednym teście zatruwałby stałą produkcyjną na
 * resztę procesu (F4 z recenzji S4a, ta sama klasa błędu co 15.09).
 * `fixtures-isolation` tego nie złapie — ta fabryka żyje w pliku testowym,
 * nie w `tests/fixtures/`.
 */
const featureOf = (key: string, over: Partial<Feature> = {}): Feature => {
  const wzor = structuredClone(preset(key));
  return {
    name: wzor.name,
    weight: 0.1,
    rating: null,
    key,
    definitions: wzor.defaultDefinitions,
    measure: wzor.defaultMeasure ?? null,
    ...over,
  };
};

function lokalOf(
  candidate: Partial<Candidate> | null,
  comparable: Partial<ExtremeLokal["comparable"]> = {},
): ExtremeLokal {
  const cand: Candidate | null = candidate
    ? {
        transactionId: "T-1",
        date: "2026-03-11",
        area: 41.7,
        pricePerM2: 8847.74,
        priceTotal: 368950.76,
        egib: null,
        lokalId: "L-1",
        distanceM: 100,
        floor: 4,
        rooms: 2,
        market: "wtorny",
        share: "1/1",
        transType: "wolnyRynek",
        function: "mieszkalna",
        seller: "osobaFizyczna",
        pos: null,
        street: "os. Lecha",
        ...candidate,
      }
    : null;
  return {
    key: "T-1|L-1",
    comparable: {
      pricePerM2: 8847.74,
      area: 41.7,
      source: "rcn",
      transactionId: "T-1",
      lokalId: "L-1",
      ...comparable,
    },
    candidate: cand,
    pricePerM2: 8847.74,
  };
}

describe("extremeComparables — lokale o cenie min i max z joinem kandydata", () => {
  it("wyznacza remis Cmin (dwa lokale) i jeden Cmax, każdy z kandydatem z próby", () => {
    const { min, max } = extremeComparables(inputs1409());
    expect(min.map((l) => l.key)).toEqual(["TEST-TX-01|TEST-LOK-01", "TEST-TX-02|TEST-LOK-02"]);
    expect(max.map((l) => l.key)).toEqual(["TEST-TX-12|TEST-LOK-12"]);
    expect(max[0].candidate?.floor).toBe(4);
    expect(max[0].pricePerM2).toBe(11880);
    expect(min.every((l) => l.candidate != null)).toBe(true);
  });

  it("klucz to candidateKey (transactionId|lokalId), a wiersz bez kandydata w migawce zostaje z candidate: null", () => {
    const inputs = inputs1409();
    inputs.comparables.push({
      pricePerM2: 99_999,
      source: "rcn",
      transactionId: "OBCY",
      lokalId: "X",
    });
    const { max } = extremeComparables(inputs);
    expect(max).toHaveLength(1);
    expect(max[0].key).toBe("OBCY|X");
    expect(max[0].candidate).toBeNull();
  });

  it("wiersz ręczny bez transactionId dostaje klucz z TREŚCI wiersza (data|powierzchnia|cena)", () => {
    const inputs: Pick<KcsInput, "comparables" | "sampleSelection"> = {
      comparables: [
        { date: "2026-03", area: 41.7, pricePerM2: 9000 },
        { date: "2025-11", area: 57.9, pricePerM2: 7000, source: "manual" },
        { date: "2026-01", area: 50, pricePerM2: 8000 },
      ],
      sampleSelection: null,
    };
    const { min, max } = extremeComparables(inputs);
    expect(min.map((l) => l.key)).toEqual(["manual:2025-11|57.9|7000"]);
    expect(max.map((l) => l.key)).toEqual(["manual:2026-03|41.7|9000"]);
  });

  /**
   * Pozycja nie jest tożsamością (recenzja całości bloku, F1). Usunięcie
   * WCZEŚNIEJSZEGO wiersza próby nie może przepiąć klucza wiersza ręcznego na
   * inny lokal — inaczej mapa ocen z kroku 4 zostaje nietknięta, a §12.2 czyta
   * pod tym kluczem ocenę wystawioną komuś innemu.
   */
  it("usunięcie wcześniejszego wiersza próby nie zmienia klucza wiersza ręcznego", () => {
    const reczny = { date: "2026-03", area: 41.7, pricePerM2: 9000, source: "manual" as const };
    const przed = extremeComparables({
      comparables: [{ pricePerM2: 6000, transactionId: "TX-1", lokalId: "L1" }, reczny],
      sampleSelection: null,
    });
    const po = extremeComparables({ comparables: [reczny], sampleSelection: null });
    expect(przed.max.map((l) => l.key)).toEqual(po.max.map((l) => l.key));
  });

  /** Zmiana ceny wiersza ręcznego to inny wiersz — ocena nie może się na niego przenieść. */
  it("zmiana ceny wiersza ręcznego zmienia jego klucz", () => {
    const klucz = (pricePerM2: number) =>
      extremeComparables({
        comparables: [{ date: "2026-03", area: 41.7, pricePerM2, source: "manual" }],
        sampleSelection: null,
      }).max[0].key;
    expect(klucz(9000)).not.toBe(klucz(9500));
  });

  it("pusta próba → pusto, bez wyjątku", () => {
    expect(extremeComparables({ comparables: [], sampleSelection: null })).toEqual({
      min: [],
      max: [],
    });
  });

  it("extremeLokale: Cmax najpierw, potem Cmin; jedna cena w całej próbie daje jeden lokal, nie dwa", () => {
    const list = extremeLokale(inputs1409());
    expect(list.map((l) => [l.side, l.key])).toEqual([
      ["max", "TEST-TX-12|TEST-LOK-12"],
      ["min", "TEST-TX-01|TEST-LOK-01"],
      ["min", "TEST-TX-02|TEST-LOK-02"],
    ]);
    const flat = extremeLokale({
      comparables: [
        { pricePerM2: 9000, transactionId: "A", lokalId: "1" },
        { pricePerM2: 9000, transactionId: "B", lokalId: "1" },
      ],
      sampleSelection: null,
    });
    expect(flat.map((l) => [l.side, l.key])).toEqual([
      ["max", "A|1"],
      ["max", "B|1"],
    ]);
  });

  /**
   * Wiersz rejestru biura nie ma `lokalId` (jeden lokal na wiersz), więc join
   * jest DOKŁADNY tylko dzięki `coopTxId`. Bez tego `candidate` byłby null i
   * P.P nigdy nie dotarłoby do podpowiedzi kroku 4 — kolumna byłaby ozdobą.
   */
  it("wiersz z rejestru biura (lokalId pusty, coopTxId) dowozi kandydata z P.P", () => {
    const candidate: Candidate = {
      ...lokalOf({ annex: true }).candidate!,
      transactionId: "coop-row-1",
      lokalId: "",
      cooperative: "SM Osiedle Młodych",
    };
    const { max } = extremeComparables({
      comparables: [
        {
          pricePerM2: 9000,
          source: "rejestr_sm",
          transactionId: "coop-row-1",
          lokalId: "",
          coopTxId: "coop-row-1",
        },
      ],
      sampleSelection: {
        proposed: [candidate],
        alternates: [],
      } as unknown as NonNullable<KcsInput["sampleSelection"]>,
    });
    expect(max[0].key).toBe("coop-row-1|");
    expect(max[0].candidate?.annex).toBe(true);
    expect(suggestedRating(featureOf("pomieszczenia-przynalezne"), max[0])?.level).toBe("lepsza");
  });

  it("candidateOf zachowuje kontrakt z document-model (R-7): join po transactionId + lokalId, {} → null", () => {
    const inputs = inputs1409();
    expect(candidateOf(inputs.comparables[0], inputs.sampleSelection)).toEqual({
      candidate: inputs.sampleSelection!.proposed[0],
      matched: true,
    });
    expect(candidateOf({}, inputs.sampleSelection)).toBeNull();
  });
});

describe("suggestedRating — podpowiedź z danych rejestru", () => {
  it("piętro: kondygnacja 4 w RCN to 3. piętro → „przeciętna” z progiem 1–3", () => {
    expect(suggestedRating(featureOf("polozenie-na-pietrze"), lokalOf({ floor: 4 }))).toEqual({
      level: "przecietna",
      source: "piętro",
      value: 3,
      bound: { od: 1, do: 3 },
    });
  });

  it("parter (kondygnacja 1 w RCN) → „gorsza”; brak kondygnacji → brak podpowiedzi", () => {
    expect(suggestedRating(featureOf("polozenie-na-pietrze"), lokalOf({ floor: 1 }))?.level).toBe(
      "gorsza",
    );
    expect(suggestedRating(featureOf("polozenie-na-pietrze"), lokalOf({ floor: null }))).toBeNull();
    expect(suggestedRating(featureOf("polozenie-na-pietrze"), lokalOf(null))).toBeNull();
  });

  it("powierzchnia: 41,70 m² przy medianie 49 → „lepsza” (do 48 m²), wartość z wiersza porównania", () => {
    const pow = featureOf("powierzchnia-uzytkowa", {
      measure: powierzchniaMeasure(49),
      definitions: { lepsza: "do 48 m²", gorsza: "od 49 m²" },
    });
    expect(suggestedRating(pow, lokalOf({ area: 41.7 }, { area: 41.7 }))).toEqual({
      level: "lepsza",
      source: "powierzchnia",
      value: 41.7,
      bound: { do: 48 },
    });
    // 57,9 ≈ 58 ≥ 49 → gorsza; bez `area` w porównaniu spada na kandydata.
    expect(suggestedRating(pow, lokalOf({ area: 57.9 }, { area: undefined }))?.level).toBe(
      "gorsza",
    );
  });

  it("pomieszczenia przynależne: P.P tak → „lepsza”, nie → „gorsza”, null/brak kandydata → brak", () => {
    const pp = featureOf("pomieszczenia-przynalezne");
    expect(suggestedRating(pp, lokalOf({ annex: true }))).toEqual({
      level: "lepsza",
      source: "pomieszczenia przynależne",
      annex: true,
    });
    expect(suggestedRating(pp, lokalOf({ annex: false }))?.level).toBe("gorsza");
    expect(suggestedRating(pp, lokalOf({ annex: null }))).toBeNull();
    expect(suggestedRating(pp, lokalOf({}))).toBeNull();
    expect(suggestedRating(pp, lokalOf(null))).toBeNull();
  });

  it("podpowiada tylko poziom OPISANY — P.P nie, gdy „gorsza” nie ma tekstu", () => {
    const pp = featureOf("pomieszczenia-przynalezne", { definitions: { lepsza: "jest piwnica" } });
    expect(suggestedRating(pp, lokalOf({ annex: false }))).toBeNull();
    expect(suggestedRating(pp, lokalOf({ annex: true }))?.level).toBe("lepsza");
  });

  it("cecha bez progów i bez danych (standard, lokalizacja, dodatkowe) → null; ręcznie odłączone progi → null", () => {
    for (const key of ["standard-wykonczenia", "lokalizacja", "dodatkowe"]) {
      expect(suggestedRating(featureOf(key), lokalOf({ floor: 4, annex: true }))).toBeNull();
    }
    expect(
      suggestedRating(featureOf("polozenie-na-pietrze", { measure: null }), lokalOf({ floor: 4 })),
    ).toBeNull();
  });

  it("measuredLevel czyta wyłącznie progi (bez P.P) — ścieżka §12.2 dla szkiców bez ocen", () => {
    expect(measuredLevel(featureOf("polozenie-na-pietrze"), lokalOf({ floor: 4 }))).toBe(
      "przecietna",
    );
    expect(
      measuredLevel(featureOf("pomieszczenia-przynalezne"), lokalOf({ annex: true })),
    ).toBeNull();
  });
});

/**
 * F4 z recenzji S4a. `featureOf` żyje w pliku testowym, więc bramka
 * `fixtures-isolation` jej nie przemiata — ta sama kontrola stoi tutaj, tym
 * samym automatem (`leakingPaths`), żeby nie było dwóch definicji „czystej
 * fabryki”.
 */
describe("featureOf — fabryka nie wydaje kawałków FEATURE_PRESETS", () => {
  const KLUCZE = [
    "standard-wykonczenia",
    "polozenie-na-pietrze",
    "lokalizacja",
    "pomieszczenia-przynalezne",
    "dodatkowe",
  ];

  it.each(KLUCZE)("featureOf(%s) daje dwa niezależne obiekty", (key) => {
    expect(leakingPaths(() => featureOf(key))).toEqual([]);
  });

  /**
   * Kontrola pozytywna: bez niej „zero przecieków” mogłoby znaczyć „automat
   * nic nie sprawdza”. Fabryka, która JAWNIE oddaje obiekt presetu, musi mieć
   * wskazaną ścieżkę.
   */
  it("automat wskazuje przeciek, gdy fabryka odda obiekt presetu wprost", () => {
    expect(
      leakingPaths(() => ({ measure: preset("polozenie-na-pietrze").defaultMeasure })),
    ).toEqual(["measure"]);
  });

  /**
   * Tożsamość na DWÓCH poziomach wobec stałej produkcyjnej: ani sam obiekt
   * definicji/progów, ani obiekt w nim zagnieżdżony nie może być tym, który
   * trzyma `FEATURE_PRESETS`. Płytka kopia przechodzi pierwszy poziom i pada
   * na drugim — i to jest dokładnie ta różnica, którą F4 nazywa.
   */
  it("definicje i progi nie są obiektami presetu ani na pierwszym, ani na drugim poziomie", () => {
    const wzor = preset("polozenie-na-pietrze");
    const f = featureOf("polozenie-na-pietrze");
    expect(f.definitions).not.toBe(wzor.defaultDefinitions);
    expect(f.measure).not.toBe(wzor.defaultMeasure);
    expect(f.measure!.bounds).not.toBe(wzor.defaultMeasure!.bounds);
    expect(f.measure!.bounds.przecietna).not.toBe(wzor.defaultMeasure!.bounds.przecietna);
    // Wartości muszą przy tym zostać te same — kopia, nie przepisanie.
    expect(f.definitions).toEqual(wzor.defaultDefinitions);
    expect(f.measure).toEqual(wzor.defaultMeasure);
  });
});

describe("pruneComparableRatings — oceny tylko dla żywych lokali i żywych cech", () => {
  const ratings = {
    "A|1": { "standard-wykonczenia": "lepsza" as const, dodatkowe: "gorsza" as const },
    "STARY|1": { "standard-wykonczenia": "gorsza" as const },
  };
  it("odcina klucze lokali spoza listy i klucze cech spoza listy; puste → null", () => {
    expect(pruneComparableRatings(ratings, ["A|1"], ["standard-wykonczenia"])).toEqual({
      "A|1": { "standard-wykonczenia": "lepsza" },
    });
    expect(pruneComparableRatings(ratings, null, ["standard-wykonczenia"])).toEqual({
      "A|1": { "standard-wykonczenia": "lepsza" },
      "STARY|1": { "standard-wykonczenia": "gorsza" },
    });
    expect(pruneComparableRatings(ratings, ["NIKT"], null)).toBeNull();
    expect(pruneComparableRatings(null, null, null)).toBeNull();
    expect(pruneComparableRatings({}, null, null)).toBeNull();
  });
  it("nie mutuje wejścia", () => {
    const copy = structuredClone(ratings);
    pruneComparableRatings(ratings, ["A|1"], ["dodatkowe"]);
    expect(ratings).toEqual(copy);
  });
});

/**
 * Fitness function (spec §7, doprecyzowana): wybieranie wierszy o cenie
 * skrajnej (`Math.min/max` + `pricePerM2 ===`) żyje w JEDNYM pliku. Silnik
 * (`kcs.ts`), statystyki §11 (`sample-snapshot.ts`) i podgląd kroku 3 liczą
 * min/max cen, ale nie filtrują po nich wierszy — zostają legalnie.
 */
describe("jedno miejsce wyboru lokali o cenie skrajnej (R4)", () => {
  const SRC = path.join(process.cwd(), "src");
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  it("żaden plik w src/ poza domain/extremes.ts nie łączy Math.min/max z filtrem pricePerM2 ===", () => {
    const offenders = sources(SRC)
      .filter((file) => {
        const text = fs.readFileSync(file, "utf8");
        return /Math\.(min|max)\(/.test(text) && /pricePerM2 === /.test(text);
      })
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual(["domain/extremes.ts"]);
  });
});
