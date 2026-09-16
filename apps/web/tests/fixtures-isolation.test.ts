import { describe, expect, it } from "vitest";
import { leakingPaths, sharedReferences } from "./support/fixture-isolation";
import {
  approvableInput,
  approvableInputs,
  confirmableInput,
  confirmedProse,
  partialDraftInputs,
  valuationInput,
} from "./fixtures/valuation-inputs";
import {
  goldenInputs,
  KW_AKT_NO_DZIAL,
  KW_STANDARD,
  SUBJECT_NO_MPZP,
  SUBJECT_WITH_MPZP,
  syntheticDocumentInput,
} from "./fixtures/document-model-fixture";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";

/**
 * Fabryka fikstur ma wydawać każdemu wywołaniu WŁASNE dane. Gdy oddaje stałą
 * modułową przez referencję, zapis w jednym teście trafia do następnego i o
 * wyniku decyduje kolejność przebiegu — czego przy zielonym CI nikt nie
 * zobaczy. Groźniejsza strona: test dostaje dane spreparowane przez
 * poprzednika, więc przeciek potrafi ZAMASKOWAĆ prawdziwy błąd.
 *
 * Bramka jest automatem, a nie listą pól, bo trzy kolejne przeglądy „po oku"
 * tego samego kodu dały kolejno 1, 3 i 5 przecieków (15.09). Rekurencyjne
 * porównanie dwóch wywołań odpowiada na pytanie „czy to już wszystkie" i
 * obejmuje pola, których dziś jeszcze nie ma.
 *
 * FABRYKA Z PARAMETRAMI JEST TYLOMA FABRYKAMI, ILE MA SENSOWNYCH ZESTAWÓW
 * ARGUMENTÓW. `goldenInputs()` bez argumentów była czysta i dlatego została
 * wpisana jako czysta — a z argumentami wkładała do wyniku obiekty wołającego
 * (stałe `SUBJECT_WITH_MPZP`, `KW_STANDARD`) i przeciekała. Dopisując fabrykę
 * do tablicy niżej, dopisz każdy zestaw argumentów, którym wołają ją testy.
 *
 * Znane ograniczenia samego przemiatu (dziś nic tego nie używa, więc zostają
 * jako follow-up — ale obietnica „obejmuje pola, których jeszcze nie ma" ich
 * NIE dotyczy):
 * - `Map` i `Set` są niewidoczne, bo `Object.keys(new Map())` to `[]` — świeża
 *   kolekcja wypełniona cudzymi obiektami przejdzie jako czysta;
 * - graf z cyklem wywraca przemiat (`RangeError`), choć `structuredClone`
 *   cykle obsługuje, więc taka fikstura jest legalna.
 */
describe("izolacja fikstur — żadna fabryka nie wydaje cudzych obiektów", () => {
  const FABRYKI: Array<[string, () => unknown]> = [
    ["wycena1409Anon()", () => wycena1409Anon()],
    ["wycena1409Anon({ kw })", () => wycena1409Anon({ kw: "odpis_z_wpisem_dzial_iii" })],
    [
      "wycena1409Anon({ skalaPowierzchni })",
      () => wycena1409Anon({ skalaPowierzchni: "poprawiona" }),
    ],
    ["valuationInput", () => valuationInput("o1", "ul. Przykładowa 1, Poznań")],
    ["approvableInputs", () => approvableInputs()],
    ["approvableInput", () => approvableInput("o1")],
    ["confirmableInput", () => confirmableInput("o1")],
    ["partialDraftInputs", () => partialDraftInputs()],
    ["confirmedProse", () => confirmedProse()],
    ["goldenInputs()", () => goldenInputs()],
    // Zestawy argumentów żywe w `f12-document-sections` (`:54`, `:272`, `:336`,
    // `:372`) — to one przeciekały, mimo że wywołanie bezargumentowe było czyste.
    ["goldenInputs(subject, kw)", () => goldenInputs(SUBJECT_WITH_MPZP, KW_STANDARD)],
    ["goldenInputs(subject, kw akt)", () => goldenInputs(SUBJECT_WITH_MPZP, KW_AKT_NO_DZIAL)],
    ["goldenInputs(subject bez mpzp)", () => goldenInputs(SUBJECT_NO_MPZP)],
    ["syntheticDocumentInput()", () => syntheticDocumentInput()],
    [
      "syntheticDocumentInput(subject, kw)",
      () => syntheticDocumentInput(SUBJECT_WITH_MPZP, KW_STANDARD),
    ],
  ];

  it.each(FABRYKI)("%s daje dwa niezależne obiekty", (_nazwa, fabryka) => {
    expect(leakingPaths(fabryka)).toEqual([]);
  });

  /**
   * Kontrola pozytywna: bez niej „zero przecieków" mogłoby znaczyć „przemiat
   * nic nie sprawdza". Ten sam automat na obiekcie, który JAWNIE współdzieli
   * zagnieżdżoną referencję, ma ją znaleźć i nazwać ścieżką.
   */
  it("przemiat wykrywa współdzielenie, którego szuka", () => {
    const wspolny = { bounds: { lepsza: { od: 4 } } };
    expect(sharedReferences({ a: 1, m: wspolny }, { a: 1, m: wspolny })).toEqual(["m"]);
    // Zagnieżdżenie głębiej niż jeden poziom — spread wygląda na kopię i nią nie jest.
    expect(sharedReferences({ m: { ...wspolny } }, { m: { ...wspolny } })).toEqual(["m.bounds"]);
    // Tablice też, po indeksie.
    expect(sharedReferences({ xs: [wspolny] }, { xs: [wspolny] })).toEqual(["xs[0]"]);
    // Prymitywy porównują się przez wartość — nie ma czego współdzielić.
    expect(sharedReferences({ s: "x", n: 1 }, { s: "x", n: 1 })).toEqual([]);
    // Data jest obiektem i da się ją zapisać (`setFullYear`), więc liczy się tak
    // samo; dwie różne daty o tej samej wartości to już osobne obiekty.
    const data = new Date("2026-09-15T00:00:00Z");
    expect(sharedReferences({ d: data }, { d: data })).toEqual(["d"]);
    expect(sharedReferences({ d: new Date("2026-09-15") }, { d: new Date("2026-09-15") })).toEqual(
      [],
    );
  });
});
