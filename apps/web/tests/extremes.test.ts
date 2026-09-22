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

/**
 * Lokale o cenie skrajnej (ADR-022, R4): jedno źródło dla §12.2, kroku 4 i
 * bramki B-18. Fikstura 14.09: remis Cmin (TX-01, TX-02), Cmax = TX-12 na
 * kondygnacji 4 (piętro 3).
 */
const inputs1409 = () => wycena1409Anon().inputs;

const preset = (key: string) => FEATURE_PRESETS.lokal.find((e) => e.key === key)!;
const featureOf = (key: string, over: Partial<Feature> = {}): Feature => ({
  name: preset(key).name,
  weight: 0.1,
  rating: null,
  key,
  definitions: { ...preset(key).defaultDefinitions },
  measure: preset(key).defaultMeasure ? structuredClone(preset(key).defaultMeasure!) : null,
  ...over,
});

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

  it("wiersz ręczny bez transactionId dostaje klucz pozycyjny manual:<indeks>", () => {
    const inputs: Pick<KcsInput, "comparables" | "sampleSelection"> = {
      comparables: [
        { pricePerM2: 9000 },
        { pricePerM2: 7000, source: "manual" },
        { pricePerM2: 8000 },
      ],
      sampleSelection: null,
    };
    const { min, max } = extremeComparables(inputs);
    expect(min.map((l) => l.key)).toEqual(["manual:1"]);
    expect(max.map((l) => l.key)).toEqual(["manual:0"]);
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
  // TODO(Zadanie 3): odblokować po przeniesieniu lokaleAtPrice
  it.skip("żaden plik w src/ poza domain/extremes.ts nie łączy Math.min/max z filtrem pricePerM2 ===", () => {
    const offenders = sources(SRC)
      .filter((file) => {
        const text = fs.readFileSync(file, "utf8");
        return /Math\.(min|max)\(/.test(text) && /pricePerM2 === /.test(text);
      })
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual(["domain/extremes.ts"]);
  });
});
