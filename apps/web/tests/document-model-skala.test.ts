import { describe, expect, it } from "vitest";
import {
  buildDocumentModel,
  candidateOf,
  formatNumber,
  formatPln,
  OCENA_SPOZA_REJESTRU,
} from "../src/domain/document-model";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import { computeKcsOnScale } from "../src/domain/feature-rules";
import { AUTOR_TESTOWY } from "./fixtures/document-model-fixture";

function inputsWith(features: KcsInput["features"]): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i * 10,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features,
    sampleMeta: null,
    provenance: null,
  };
}

function modelWith(features: KcsInput["features"]) {
  const inputs = inputsWith(features);
  return buildDocumentModel({
    address: "ul. Przykładowa 1, Poznań",
    area: 50,
    purpose: "sprzedaz",
    kwNumber: "AB1C/1/1",
    propertyRight: "wlasnosc_lokalu" as const,
    client: "Klient Testowy",
    inspectionDate: "2026-07-01",
    approvedAt: new Date("2026-07-02T00:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "testowa kwota słownie",
    author: AUTOR_TESTOWY,
  });
}

describe("document model — skala ocen (Slice 7)", () => {
  it("maps only non-empty levels, in lepsza→przeciętna→gorsza order, with Polish labels", () => {
    const m = modelWith([
      {
        name: "położenie na piętrze",
        weight: 1,
        rating: "przecietna",
        key: "polozenie-na-pietrze",
        definitions: { gorsza: "parter", lepsza: "czwarte piętro i powyżej" },
      },
    ]);
    expect(m.skala_ocen).toEqual([
      {
        cecha: "położenie na piętrze",
        poziomy: [
          { poziom: "lepsza", def: "czwarte piętro i powyżej." },
          { poziom: "gorsza", def: "parter." },
        ],
      },
    ]);
  });

  it("uses the label 'przeciętna' (diacritics) for the przecietna level", () => {
    const m = modelWith([
      {
        name: "standard wykończenia",
        weight: 1,
        rating: "przecietna",
        definitions: { przecietna: "standard dobry" },
      },
    ]);
    expect(m.skala_ocen[0]!.poziomy).toEqual([{ poziom: "przeciętna", def: "standard dobry." }]);
  });

  it("legacy features without definitions → empty skala_ocen (honest silence)", () => {
    const m = modelWith([{ name: "lokalizacja", weight: 1, rating: "lepsza" }]);
    expect(m.skala_ocen).toEqual([]);
  });

  it("weight-0 features are excluded from cechy, opis_* and skala_ocen (defensive shield)", () => {
    const m = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "opis" } },
      {
        name: "rodzaj zabudowy budynku",
        weight: 0,
        rating: "przecietna",
        definitions: { lepsza: "nie powinno się drukować" },
      },
    ]);
    expect(m.cechy.map((c) => c.nazwa)).toEqual(["lokalizacja"]);
    expect(m.opis_przedmiot).toHaveLength(1);
    expect(m.opis_cmin).toHaveLength(1);
    expect(m.opis_cmax).toHaveLength(1);
    expect(m.skala_ocen.map((r) => r.cecha)).toEqual(["lokalizacja"]);
  });

  it("a feature whose definitions are all empty strings contributes no skala_ocen row", () => {
    const m = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "  " } },
    ]);
    expect(m.skala_ocen).toEqual([]);
  });

  it("terminates def with a period only when the appraiser's text doesn't already end in .!?", () => {
    const m = modelWith([
      {
        name: "standard wykończenia",
        weight: 1,
        rating: "przecietna",
        definitions: {
          lepsza: "wykończenie premium.",
          przecietna: "stan dobry?",
          gorsza: "do remontu!",
        },
      },
    ]);
    expect(m.skala_ocen[0]!.poziomy).toEqual([
      { poziom: "lepsza", def: "wykończenie premium." },
      { poziom: "przeciętna", def: "stan dobry?" },
      { poziom: "gorsza", def: "do remontu!" },
    ]);
  });
});

describe("document model — feature intro fields (Task 9)", () => {
  it("joins active feature names in bag order for §12.1, and counts the §13 attributes", () => {
    const m = modelWith([
      { name: "standard wykończenia", weight: 0.4, rating: "przecietna" },
      { name: "położenie na piętrze", weight: 0.3, rating: "przecietna" },
      { name: "lokalizacja", weight: 0.3, rating: "przecietna" },
    ]);
    expect(m.cechy_lista).toBe("standard wykończenia, położenie na piętrze oraz lokalizacja");
    // 0.3/0.3 tie: Array.prototype.sort is stable, keeps bag order — identical to cechy_lista here.
    expect(m.cechy_lista_wg_wag).toBe(
      "standard wykończenia, położenie na piętrze oraz lokalizacja",
    );
    expect(m.liczba_atrybutow_fraza).toBe("3 atrybutów");
  });

  it("sorts cechy_lista_wg_wag by weight descending, independent of bag order", () => {
    const m = modelWith([
      { name: "a", weight: 0.2, rating: "przecietna" },
      { name: "b", weight: 0.5, rating: "przecietna" },
      { name: "c", weight: 0.3, rating: "przecietna" },
    ]);
    expect(m.cechy_lista).toBe("a, b oraz c");
    expect(m.cechy_lista_wg_wag).toBe("b, c oraz a");
  });

  it("a single active feature has no 'oraz' and a genitive-singular fraza", () => {
    const m = modelWith([{ name: "lokalizacja", weight: 1, rating: "lepsza" }]);
    expect(m.cechy_lista).toBe("lokalizacja");
    expect(m.cechy_lista_wg_wag).toBe("lokalizacja");
    expect(m.liczba_atrybutow_fraza).toBe("1 atrybutu");
  });

  it("weight-0 features are excluded from both lists and the count", () => {
    const m = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza" },
      { name: "rodzaj zabudowy budynku", weight: 0, rating: "przecietna" },
    ]);
    expect(m.cechy_lista).toBe("lokalizacja");
    expect(m.cechy_lista_wg_wag).toBe("lokalizacja");
    expect(m.liczba_atrybutow_fraza).toBe("1 atrybutu");
  });

  it("ma_skale is true only when at least one feature prints a rating-scale row", () => {
    const withDefs = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "opis" } },
    ]);
    expect(withDefs.ma_skale).toBe(true);

    // legacy features without definitions
    const legacyNoDefs = modelWith([{ name: "lokalizacja", weight: 1, rating: "lepsza" }]);
    expect(legacyNoDefs.ma_skale).toBe(false);

    // whitespace-only definition
    const whitespaceOnly = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "  " } },
    ]);
    expect(whitespaceOnly.ma_skale).toBe(false);
  });
});

// I-11 at the document level: Tabela 3 prints a Ui per feature and a ΣUi under
// it, and the reader adds the column up. The engine rounds each Ui before
// summing, so those printed numbers must add up to the printed ΣUi — this is
// what the operat from 14.09 got wrong (1,021 printed under rows summing 1,022).
describe("document model — Tabela 3 sums to the printed ΣUi (I-11)", () => {
  it("the printed Ui column adds up to suma_ui", () => {
    const THREE = {
      lepsza: "opis lepszej",
      przecietna: "opis przeciętnej",
      gorsza: "opis gorszej",
    };
    const m = modelWith([
      { name: "standard", weight: 0.4, rating: "przecietna", definitions: THREE },
      { name: "piętro", weight: 0.3, rating: "lepsza", definitions: THREE },
      { name: "lokalizacja", weight: 0.1, rating: "gorsza", definitions: THREE },
      { name: "powierzchnia", weight: 0.1, rating: "przecietna", definitions: THREE },
      { name: "pomieszczenia", weight: 0.1, rating: "gorsza", definitions: THREE },
    ]);

    const parse = (s: string) => Number(s.replace(",", "."));
    const printed = m.cechy.reduce((sum, row) => sum + parse(row.ui_przedmiot), 0);
    expect(Math.round(printed * 1000) / 1000).toBe(parse(m.suma_ui));
  });
});

/**
 * FH.3 — §12.2 i Tabela 3 na fiksturze 14.09 (D-51…D-54, I-11 U, I-12 U).
 * Operat z 14.09 opisywał Cmin i Cmax szablonowo („wartość najwyższa” przy
 * każdej cesze) i pomijał remis Cmin. Po tej sesji opis wynika z danych.
 */
describe("document model — Cmin/Cmax per cecha (FH.3)", () => {
  const reported = () => buildDocumentModel(wycena1409Anon());

  // Ceny i piętra brane z próby, nie z komentarza — fikstura jest źródłem.
  const proposed = wycena1409Anon().inputs.sampleSelection!.proposed;
  const prices = proposed.map((c) => c.pricePerM2);
  const cmaxRows = proposed.filter((c) => c.pricePerM2 === Math.max(...prices));
  const cminRows = proposed.filter((c) => c.pricePerM2 === Math.min(...prices));

  it("Tabela 1 jest identyczna jak przed wydzieleniem `candidateOf` (R-7)", () => {
    expect(reported().transakcje).toEqual(
      proposed.map((c) => ({
        data_msc: c.date.slice(0, 7),
        miasto: "Poznań",
        ulica: c.street!,
        pow: formatNumber(c.area, 2),
        cena_jedn: formatPln(c.pricePerM2),
      })),
    );
  });

  it("`candidateOf` łączy porównanie z kandydatem po transactionId + lokalId", () => {
    const { inputs } = wycena1409Anon();
    const comparable = inputs.comparables[0];
    expect(candidateOf(comparable, inputs.sampleSelection)).toEqual({
      candidate: proposed[0],
      matched: true,
    });
    // Porównanie spoza migawki (ręczny wiersz) nie ma kandydata — stąd kreski w Tabeli 1.
    expect(candidateOf({}, inputs.sampleSelection)).toBeNull();
  });

  it("Cmax na 3. kondygnacji to „wartość pośrednia”, nie „najwyższa” (D-52)", () => {
    expect(cmaxRows).toHaveLength(1);
    // Kondygnacja 3 w RCN = 2 piętro, czyli przedział „piętra pośrednie” (1–3).
    expect(cmaxRows[0].floor).toBe(3);
    const [lokal] = reported().lokale_cmax;
    expect(lokal.cechy).toEqual([
      { nazwa: "Standard wykończenia", opis: OCENA_SPOZA_REJESTRU },
      { nazwa: "Położenie na piętrze", opis: "wartość pośrednia cechy" },
      { nazwa: "Lokalizacja szczegółowa", opis: OCENA_SPOZA_REJESTRU },
      // 35,9 m² ≤ 43 m² → „lepsza”, wyższy z dwóch opisanych poziomów.
      { nazwa: "Powierzchnia użytkowa", opis: "wartość najwyższa cechy" },
      { nazwa: "Pomieszczenia przynależne", opis: OCENA_SPOZA_REJESTRU },
      { nazwa: "Dodatkowe", opis: OCENA_SPOZA_REJESTRU },
    ]);
  });

  it("remis ceny najniższej opisuje oba lokale, każdy ze swoim piętrem (D-53)", () => {
    expect(cminRows).toHaveLength(2);
    const { lokale_cmin } = reported();
    expect(lokale_cmin).toHaveLength(2);
    const pietro = (i: number) =>
      lokale_cmin[i].cechy.find((c) => c.nazwa === "Położenie na piętrze")!.opis;
    // Kondygnacje 10 i 5 = piętra 9 i 4 — oba w „4 piętro i powyżej”.
    expect(cminRows.map((c) => c.floor)).toEqual([10, 5]);
    expect([pietro(0), pietro(1)]).toEqual(["wartość najwyższa cechy", "wartość najwyższa cechy"]);
    // 48,6 i 47,9 m² ≥ 44 m² → „gorsza”, niższy z dwóch opisanych poziomów.
    const pow = (i: number) =>
      lokale_cmin[i].cechy.find((c) => c.nazwa === "Powierzchnia użytkowa")!.opis;
    expect([pow(0), pow(1)]).toEqual(["wartość najniższa cechy", "wartość najniższa cechy"]);
  });

  it("położenie Cmin/Cmax bierze ulicę z danych transakcji, bez numeru budynku (D-51)", () => {
    const m = reported();
    expect(m.lokale_cmin.map((l) => l.lokalizacja)).toEqual(cminRows.map((c) => c.street));
    expect(m.lokalizacja_cmax).toBe(cmaxRows[0].street);
    expect(m.lokalizacja_cmin).toBe(cminRows[0].street);
    // Numer budynku (`streetNumber`) jest w danych, ale nie może trafić do operatu (F-12).
    for (const lokal of [...m.lokale_cmin, ...m.lokale_cmax]) {
      expect(lokal.lokalizacja).not.toMatch(/\d/);
    }
  });

  it("brak ulicy w danych → puste pole, zdanie zostawia szablonowi", () => {
    const v = wycena1409Anon();
    v.inputs.sampleSelection!.proposed = v.inputs.sampleSelection!.proposed.map((c) => ({
      ...c,
      street: null,
    }));
    expect(buildDocumentModel(v).lokalizacja_cmax).toBe("");
  });

  it("cecha bez progów mówi wprost, że ocena nie wynika z danych rejestru (D-52)", () => {
    const opisy = reported().lokale_cmax[0].cechy.map((c) => c.opis);
    // Cztery cechy niemierzalne — żadna nie udaje oceny wyprowadzonej z rejestru.
    expect(opisy.filter((o) => o === OCENA_SPOZA_REJESTRU)).toHaveLength(4);
    expect(OCENA_SPOZA_REJESTRU).not.toContain("wartość");
  });

  /**
   * RCN trzyma `lok_nr_kond` — numer kondygnacji liczony od 1 — a skala mówi o
   * piętrach z parterem 0. Pomiar na 8 migawkach (80 000 rekordów): lokale
   * handlowo-usługowe stoją w 839 z 976 przypadków na 1, a garaże w 10 117 z
   * 11 779 na −1, co trzyma się kupy tylko przy parterze = 1. Rejestr
   * spółdzielczy wpisuje piętro ręcznie pod etykietą „Piętro” i nie jest
   * przeliczany (PR #58).
   */
  describe("kondygnacja RCN staje się piętrem (wariant b)", () => {
    const naKondygnacji = (floor: number | null, source: "rcn" | "rejestr_sm") => {
      const v = wycena1409Anon();
      const najdrozszy = Math.max(...v.inputs.comparables.map((c) => c.pricePerM2));
      const rows = v.inputs.comparables.filter((c) => c.pricePerM2 === najdrozszy);
      expect(rows).toHaveLength(1);
      rows[0].source = source;
      const kandydat = v.inputs.sampleSelection!.proposed.find(
        (c) => c.transactionId === rows[0].transactionId,
      )!;
      kandydat.floor = floor;
      return buildDocumentModel(v).lokale_cmax[0].cechy.find(
        (c) => c.nazwa === "Położenie na piętrze",
      )!.opis;
    };

    it("kondygnacja 1 to parter, czyli najniższy poziom skali — nie „pośredni”", () => {
      expect(naKondygnacji(1, "rcn")).toBe("wartość najniższa cechy");
      // Bez konwersji ta sama liczba wpadłaby w „piętra pośrednie”.
      expect(naKondygnacji(1, "rejestr_sm")).toBe("wartość pośrednia cechy");
    });

    it("kondygnacja podziemna i zero nie trafiają w żaden przedział", () => {
      // Garaż na −1 i wiersz bez numeru kondygnacji (0 w RCN nie występuje jako
      // parter) schodzą poniżej parteru — operat mówi wprost, że nie wie.
      expect(naKondygnacji(-1, "rcn")).toBe(OCENA_SPOZA_REJESTRU);
      expect(naKondygnacji(0, "rcn")).toBe(OCENA_SPOZA_REJESTRU);
      expect(naKondygnacji(null, "rcn")).toBe(OCENA_SPOZA_REJESTRU);
    });
  });

  it("`opis_cmin`/`opis_cmax` to zdania pierwszego lokalu o tej cenie", () => {
    const m = reported();
    expect(m.opis_cmin).toEqual(m.lokale_cmin[0].cechy.map((c) => `${c.nazwa} – ${c.opis},`));
    expect(m.opis_cmax).toEqual(m.lokale_cmax[0].cechy.map((c) => `${c.nazwa} – ${c.opis},`));
  });
});

describe("document model — opis przedmiotu i Tabela 3 (FH.3, D-54, I-11 U)", () => {
  it("opis przedmiotu idzie z pozycji w opisanej skali, nie z klucza oceny (D-54)", () => {
    const m = buildDocumentModel(wycena1409Anon());
    expect(m.opis_przedmiot).toEqual([
      "Standard wykończenia – wartość pośrednia cechy,",
      "Położenie na piętrze – wartość najwyższa cechy,",
      // Opisane lepsza/przeciętna, ocena „przeciętna” = NIŻSZY z dwóch — rdzeń błędu 14.09.
      "Lokalizacja szczegółowa – wartość najniższa cechy,",
      // Ocena na poziomie bez opisu nie ma pozycji — operat nie zgaduje.
      "Powierzchnia użytkowa – —,",
      "Pomieszczenia przynależne – wartość najniższa cechy,",
      "Dodatkowe – wartość najniższa cechy,",
    ]);
  });

  it("Tabela 3: Ui śr „—” przy dwóch opisanych poziomach, liczba przy trzech (ADR-016 reg. 6)", () => {
    const m = buildDocumentModel(wycena1409Anon());
    expect(m.cechy.map((c) => [c.nazwa, c.ui_sr])).toEqual([
      ["Standard wykończenia", "0,400"],
      ["Położenie na piętrze", "0,300"],
      ["Lokalizacja szczegółowa", "—"],
      ["Powierzchnia użytkowa", "—"],
      ["Pomieszczenia przynależne", "—"],
      ["Dodatkowe", "—"],
    ]);
    // Ui min i Ui max drukują się dalej — „—” dotyczy tylko kolumny środkowej.
    expect(m.cechy[2].ui_min).toBe("0,088");
    expect(m.cechy[2].ui_max).toBe("0,115");
    expect(m.suma_ui_sr).toBe("—");
    expect(m.ma_skale_dwustopniowe).toBe(true);
  });

  it("same skale trzypoziomowe → Ui śr liczbowe i suma 1,000", () => {
    const m = modelWith([
      {
        name: "standard wykończenia",
        weight: 0.5,
        rating: "przecietna",
        definitions: { lepsza: "a", przecietna: "b", gorsza: "c" },
      },
      {
        name: "lokalizacja",
        weight: 0.5,
        rating: "lepsza",
        definitions: { lepsza: "a", przecietna: "b", gorsza: "c" },
      },
    ]);
    expect(m.cechy.map((c) => c.ui_sr)).toEqual(["0,500", "0,500"]);
    expect(m.suma_ui_sr).toBe("1,000");
    expect(m.ma_skale_dwustopniowe).toBe(false);
  });

  it("ΣUi Tabeli 3 = ΣUi wskaźnika WR, także na silniku ze skalą (I-11 U)", () => {
    // Wariant „poprawiona” policzony tak, jak liczy aplikacja — przez
    // `computeKcsOnScale` (jedyne wejście do silnika, pilnowane osobnym testem
    // w `feature-rules.test.ts`).
    const v = wycena1409Anon({ skalaPowierzchni: "poprawiona" });
    for (const m of [
      buildDocumentModel(wycena1409Anon()),
      buildDocumentModel({ ...v, kcs: computeKcsOnScale(v.inputs) }),
    ]) {
      const suma = m.cechy.reduce((acc, c) => acc + Number(c.ui_przedmiot.replace(",", ".")), 0);
      expect(formatNumber(Math.round(suma * 1000) / 1000, 3)).toBe(m.suma_ui);
    }
  });

  it("wiersz Tabeli 3 niesie Ui swojej cechy — „—” nie wędruje między wierszami", () => {
    const v = wycena1409Anon();
    const m = buildDocumentModel(v);
    // Gdyby zipowanie cech z Ui się rozjechało, kreska usiadłaby na cesze
    // trzypoziomowej, a każdy wiersz dalej drukowałby jakąś liczbę.
    expect(m.cechy.map((c) => c.nazwa)).toEqual(v.inputs.features.map((f) => f.name));
    expect(m.cechy.map((c) => c.ui_przedmiot)).toEqual(
      v.kcs.ui.map((u) => formatNumber(u.value, 3)),
    );
  });

  it("lokal opisany w §12.2 ma cenę, którą drukuje §12 (jedno źródło ceny)", () => {
    const v = wycena1409Anon();
    const m = buildDocumentModel(v);
    const prices = v.inputs.comparables.map((c) => c.pricePerM2);
    expect(m.cena_min).toBe(formatPln(Math.min(...prices)));
    expect(m.cena_max).toBe(formatPln(Math.max(...prices)));
  });
});
