import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { computeKcs } from "../src/domain/kcs";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";
import {
  effectiveRunFormat,
  expectNoText,
  openDocx,
  sectionParagraphs,
  sectionText,
  type DocxDoc,
  type DocxRun,
} from "./support/docx-invariants";

/**
 * Niezmienniki paczki 1 na WYRENDEROWANYM DOCX (spec §7.3). Osobny plik od
 * `f12-template-integrity.test.ts`, który patrzy na sam szablon: te asercje
 * wymagają modelu, bo pytają o to, co dokument DRUKUJE w danym stanie wyceny,
 * a nie o to, jakie tagi szablon niesie.
 *
 * Nazwa każdego testu zaczyna się od ID niezmiennika (I-11 G … I-19), żeby
 * zgłoszenie z przeglądu dało się przełożyć na test bez szukania.
 */

const render = (wariant: Parameters<typeof wycena1409Anon>[0] = {}) =>
  openDocx(renderOperatDocx(buildDocumentModel(wycena1409Anon(wariant))));

/** Run bez własnego `rPr` w akapicie o zadanym stylu — sonda na styl bazowy. */
function bareRunIn(doc: DocxDoc, style: string | null): DocxRun {
  const paragraph = doc.paragraphs.find((p) => p.style === style && p.container === "body");
  expect(paragraph, `brak akapitu body o stylu ${String(style)}`).toBeDefined();
  return {
    text: "",
    paragraph: paragraph!.index,
    rStyle: null,
    props: { ascii: null, asciiTheme: null, szHalfPt: null },
  };
}

describe("f12 / docx-invariants: czcionka stylów bazowych (TP.0, check dryfu D-1)", () => {
  const doc = render();

  // Segoe UI 10 pt pochodziło dotąd WYŁĄCZNIE z `rPr` runów szablonu źródłowego.
  // Każdy akapit dołożony przez generator (`new_paragraph`, `_plain_para`) nie ma
  // `rPr`, więc dziedziczył krój ze stylu — Arial 11 z `Normalny` albo Times New
  // Roman 12 z `Tekstpodstawowy22`. To jest zgłoszenie M-6 rzeczoznawczyni:
  // akapity §8.2 wychodziły inną czcionką niż reszta operatu.
  it.each([
    ["Normalny (styl domyślny akapitu)", null],
    ["Tekstpodstawowy22", "Tekstpodstawowy22"],
    ["Tekstpodstawowy", "Tekstpodstawowy"],
    ["Akapitzlist", "Akapitzlist"],
  ])("akapit bez rPr w stylu %s wychodzi Segoe UI 10 pt", (_, style) => {
    expect(effectiveRunFormat(doc, bareRunIn(doc, style))).toEqual({
      font: "Segoe UI",
      sizePt: 10,
    });
  });
});

describe("I-13 G / I-19: zdania o księgach i o akcie tylko z faktów (TP.1)", () => {
  /**
   * Brak badania (`kw == null`, stan z 14.09). Operat nie ma prawa powiedzieć ani
   * że zbadano księgi, ani jaki akt jest podstawą nabycia, ani że dowód „pozostaje
   * w dokumentacji rzeczoznawcy" — a udział, którego księga nie podała, jest kreską.
   */
  it("I-19: bez zbadanej księgi operat milczy o księgach, o akcie i o odpisie", () => {
    const doc = render({ kw: "brak" });
    for (const phrase of [
      "Badanie ksiąg wieczystych przeprowadzono",
      "Badanie ksiąg wieczystych –",
      "Wypis aktu notarialnego",
      "Dla nieruchomości gruntowej",
      "Pełna treść odpisu KW",
      "wg odpisu księgi wieczystej",
      "dokonano badania księgi wieczystej",
    ]) {
      expectNoText(doc, phrase);
    }
    expect(sectionText(doc, "8.2.")).toContain("Udział w nieruchomości wspólnej: —");
  });

  /**
   * Ścieżka codzienna biura: obie księgi zbadane ręcznie w eKW. §7 nazywa akt
   * danymi z działu II (D-12), a §2 podaje numer księgi gruntu z sądem (D-07).
   */
  it("I-13 G: przy badaniu ręcznym §7 podaje akt z działu II, a §2 sąd i numer księgi gruntu", () => {
    const doc = render({ kw: "ekw_reczne_obie_ksiegi" });
    const model = buildDocumentModel(wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" }));

    expect(model.akt_opis).toBe("UMOWA SPRZEDAŻY, Rep. A nr 1234/2015 z dnia 20.03.2015");
    expect(sectionText(doc, "7.")).toContain(`Wypis aktu notarialnego – ${model.akt_opis},`);
    expect(sectionText(doc, "7.")).toContain("Badanie ksiąg wieczystych –");

    expect(sectionText(doc, "2.")).toContain(
      `Dla nieruchomości gruntowej ${model.sad_ksiegi_gruntu} prowadzi ` +
        `księgę wieczystą nr ${model.nr_ksiegi_gruntu}.`,
    );
    expectNoText(doc, "właściwy sąd rejonowy");
    expectNoText(doc, "umowa ustanowienia odrębnej własności lokalu i sprzedaży");
  });

  /**
   * Ten sam fakt bez sądu. `nr_ksiegi_gruntu` pochodzi z migawki GRUNTU, a
   * `sad_ksiegi_gruntu` z pól księgi LOKALU — więc księga gruntu bywa zbadana,
   * a sądu nie ma (`document-model.ts`: „the two are NOT filled together"). Bez
   * osobnego wariantu zdanie wyszłoby z dziurą i podwójną spacją.
   */
  it("I-13 G: bez sądu §2 drukuje pełne zdanie z samym numerem, nie zdanie z dziurą", () => {
    const input = wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" });
    input.inputs.kw!.sad = null;
    input.inputs.kw!.wydzial = null;
    const model = buildDocumentModel(input);
    expect(model.sad_ksiegi_gruntu).toBe("");

    const doc = openDocx(renderOperatDocx(model));
    expect(sectionText(doc, "2.")).toContain(
      `Dla nieruchomości gruntowej prowadzona jest księga wieczysta nr ${model.nr_ksiegi_gruntu}.`,
    );
    expectNoText(doc, "gruntowej  prowadzi");
  });
});

describe("I-13 G: §8.2 w kolejności operatu wzorcowego (TP.2, D-21/D-24/D-25)", () => {
  const sec82 = (wariant: Parameters<typeof wycena1409Anon>[0]) => {
    const doc = render(wariant);
    return { doc, paragraphs: sectionParagraphs(doc, "8.2."), text: sectionText(doc, "8.2.") };
  };

  it("bez badania: ani protokołu, ani tabeli, ani zdań o działach", () => {
    const { doc, paragraphs } = sec82({ kw: "brak" });
    expectNoText(doc, "dokonano badania księgi wieczystej");
    expectNoText(doc, "Dział III:");
    expectNoText(doc, "Dział IV:");
    expect(paragraphs.filter((p) => p.container === "table")).toHaveLength(0);
  });

  it("obie księgi ręcznie: dwa protokoły zdaniami, bez tabeli", () => {
    const { paragraphs, text } = sec82({ kw: "ekw_reczne_obie_ksiegi" });
    // Zdanie protokołu jest cytatem z operatów biura — sprawdzamy je w całości,
    // razem z „r." bez spacji, domeną bez polskich znaków i dwukropkiem.
    expect(text).toContain(
      "W dniu 14.09.2026r. dokonano badania księgi wieczystej nieruchomości lokalowej " +
        "nr XX1X/00000000/0 (źródło: przegladarka-ekw.ms.gov.pl):",
    );
    expect(text).toContain(
      "W dniu 14.09.2026r. dokonano badania księgi wieczystej nieruchomości gruntowej " +
        "nr XX1X/00000001/0 (źródło: przegladarka-ekw.ms.gov.pl):",
    );
    // Dwukropek protokołu musi coś wprowadzać — także przy księdze gruntu,
    // której nigdy nie transkrybujemy (§P1.8).
    expect(text).toContain("Dział III: Służebność osobista mieszkania");
    expect(text).toContain("Dział IV: brak wpisów.");
    expect(text).toContain("Numer lokalu wg księgi wieczystej: 12.");
    expect(paragraphs.filter((p) => p.container === "table")).toHaveLength(0);
  });

  it("PDF lokalu z treścią: tabela działów w kolejności eKW, zamiast zdań", () => {
    const { doc, paragraphs, text } = sec82({ kw: "pdf_lokalu_z_trescia" });
    const cells = paragraphs.filter((p) => p.container === "table").map((p) => p.text);
    expect(
      cells.filter((c) => c.startsWith("DZIAŁ ")),
      "pięć działów w kolejności eKW",
    ).toEqual([
      "DZIAŁ I-O - OZNACZENIE NIERUCHOMOŚCI",
      "DZIAŁ I-SP - SPIS PRAW ZWIĄZANYCH Z WŁASNOŚCIĄ",
      "DZIAŁ II - WŁASNOŚĆ",
      "DZIAŁ III - PRAWA, ROSZCZENIA I OGRANICZENIA",
      "DZIAŁ IV - HIPOTEKA",
    ]);
    expect(cells).toContain("Ulica");
    expect(cells).toContain("UL. ZIELARSKA");
    // Transkrypcja zastępuje zdania ścieżki ręcznej dla KSIĘGI LOKALU — zdania o
    // działach księgi gruntu zostają, bo tej nigdy nie transkrybujemy.
    expectNoText(sectionText(doc, "8.2."), "Numer lokalu wg księgi wieczystej:");
    expectNoText(sectionText(doc, "8.2."), "Dział III: Służebność osobista mieszkania");
    expect(doc).toBeDefined();
    // Księga gruntu nadal ręczna, więc jej protokół zostaje zdaniami.
    expect(text).toContain("dokonano badania księgi wieczystej nieruchomości gruntowej");
  });

  /**
   * Trzy stany obciążenia, nie dwa (kontrakt po PR #55). `wariant === null` to
   * decyzja w połowie: podstawa wpisana, brzmienie niewybrane. B-07 nie dopuści
   * tego do zatwierdzenia, ale PODGLĄD tam sięga — i dokument nie ma prawa
   * wybrać brzmienia za rzeczoznawcę.
   */
  it("D-25: akapit „Uwaga” tylko przy wybranym wariancie obciążenia", () => {
    const wybrany = sec82({ kw: "ekw_reczne_obie_ksiegi" });
    expect(wybrany.text).toContain(
      "Uwaga: w dziale III księgi wieczystej lokalu ujawniony jest wpis ograniczonego prawa rzeczowego.",
    );
    expect(wybrany.text).toContain("Wartość rynkową określono bez uwzględnienia tego obciążenia.");

    const polDecyzji = wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" });
    polDecyzji.inputs.encumbranceTreatment!.wariant = null;
    const doc = openDocx(renderOperatDocx(buildDocumentModel(polDecyzji)));
    expectNoText(doc, "Uwaga: w dziale III księgi wieczystej lokalu");
    expectNoText(doc, "bez uwzględnienia tego obciążenia");
    expectNoText(doc, "z uwzględnieniem tego obciążenia");

    const zUwzglednieniem = wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" });
    zUwzglednieniem.inputs.encumbranceTreatment!.wariant = "z_uwzglednieniem";
    const docZ = openDocx(renderOperatDocx(buildDocumentModel(zUwzglednieniem)));
    expect(sectionText(docZ, "8.2.")).toContain(
      "Wartość rynkową określono z uwzględnieniem tego obciążenia.",
    );
  });

  // Wariant `brak` nie dokłada w §8.2 ani jednego akapitu — nie ma tu czego mierzyć.
  it.each([
    ["ekw_reczne_obie_ksiegi", "ekw_reczne_obie_ksiegi"],
    ["pdf_lokalu_z_trescia", "pdf_lokalu_z_trescia"],
  ] as const)("§8.2 (%s): akapity dołożone w TP.2 mają jawny pStyle", (_, kw) => {
    const { paragraphs } = sec82({ kw });
    const dolozone = paragraphs.filter(
      (p) => p.container === "table" || SENTINELS_82.some((s) => p.text.includes(s)),
    );
    expect(dolozone.length).toBeGreaterThan(0);
    expect(dolozone.filter((p) => p.style == null)).toEqual([]);
  });
});

/**
 * I-14 (TP.3, ADR-018 „Zmiana 15.09”). Wycena BEZ uwzględnienia ograniczonego
 * prawa rzeczowego to nie przypis — to doprecyzowanie, CO wyceniono, więc fraza
 * wraca wszędzie tam, gdzie operat wzorcowy nazywa przedmiot albo wynik.
 *
 * Każde miejsce sprawdzane osobno (`expectExactlyOne` na tekście sekcji, nie
 * globalnie): asercja globalna przepuściłaby brak frazy w jednym miejscu, gdy
 * gdzie indziej stoi dwa razy.
 */
describe("I-14: fraza o obciążeniu w siedmiu miejscach i nigdzie indziej (TP.3)", () => {
  const FRAZA = "bez uwzględnienia obciążenia ograniczonym prawem rzeczowym";
  const bez = () => render({ kw: "ekw_reczne_obie_ksiegi" });

  const zWariantem = (wariant: "z_uwzglednieniem" | null) => {
    const input = wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" });
    input.inputs.encumbranceTreatment!.wariant = wariant;
    return openDocx(renderOperatDocx(buildDocumentModel(input)));
  };

  it("wariant „bez”: fraza dokładnie raz w każdym z siedmiu miejsc", () => {
    const doc = bez();
    // Okładka i wstęp wyciągu stoją przed pierwszym nagłówkiem.
    const naglowek = doc.paragraphs.findIndex((p) =>
      p.text.startsWith("1. Wyciąg z operatu szacunkowego "),
    );
    expect(naglowek).toBeGreaterThan(0);
    const przedWyciagiem = doc.paragraphs
      .slice(0, naglowek)
      .filter((p) => p.container !== "txbx-vml")
      .map((p) => p.text)
      .join("\n");
    expect(przedWyciagiem.split(FRAZA)).toHaveLength(2); // okładka ×1

    const wyciag = sectionText(doc, "1.");
    // wstęp + „Zakres wyceny” + „Cel wyceny” + „Określona wartość rynkowa”
    expect(wyciag.split(FRAZA)).toHaveLength(5);
    expect(sectionText(doc, "2.").split(FRAZA)).toHaveLength(2);
    expect(sectionText(doc, "3.").split(FRAZA)).toHaveLength(2);
  });

  it("wariant „bez”: wiersz „Przedmiot wyceny” i §13 zostają bez frazy", () => {
    const doc = bez();
    const przedmiot = doc.paragraphs.find((p) =>
      p.text.startsWith("Nieruchomość lokalowa obejmująca lokal mieszkalny."),
    );
    expect(przedmiot?.text).not.toContain(FRAZA);
    expectNoText(sectionText(doc, "13."), FRAZA);
  });

  it("D-35: założenie §10.1 z podstawą stoi przy każdym stanie obciążenia", () => {
    for (const doc of [bez(), zWariantem("z_uwzglednieniem"), zWariantem(null)]) {
      const sec = sectionText(doc, "10.1.");
      expect(sec).toContain("W dziale III księgi wieczystej lokalu ujawniono wpis");
      expect(sec).toContain("ograniczone prawo rzeczowe nie zostaje uwzględnione");
    }
  });

  it("wariant „z” i decyzja w połowie: nigdzie ani słowa frazy", () => {
    for (const doc of [zWariantem("z_uwzglednieniem"), zWariantem(null)]) {
      expectNoText(doc, FRAZA);
    }
  });

  it("bez wpisu w dziale III: ani frazy, ani założenia, ani „Uwagi”", () => {
    const doc = render({ kw: "odpis_z_wpisem_dzial_iii" });
    expect(doc).toBeDefined();
    const bezObciazenia = render({ kw: "brak" });
    expectNoText(bezObciazenia, FRAZA);
    expectNoText(bezObciazenia, "W dziale III księgi wieczystej lokalu ujawniono wpis");
    expectNoText(bezObciazenia, "Uwaga: w dziale III księgi wieczystej lokalu");
  });
});

describe("I-11 G / I-12 G: Tabela 3 i opisy §12.2 (TP.4, D-47 unieważnione / D-51…D-54)", () => {
  const doc = render({ skalaPowierzchni: "poprawiona" });
  const model = buildDocumentModel(wycena1409Anon({ skalaPowierzchni: "poprawiona" }));

  /**
   * Powierzchnia w wariancie `jak_zgloszono` ma skalę DWUSTOPNIOWĄ. Dawne D-47
   * kazało w takim wierszu drukować kreskę w kolumnie Ui śr; operat wzorcowy
   * (Kościelna, Tabela 3) pokazuje tam 0,100 przy SUMIE 1,000, bo Ui min/śr/max
   * wynikają z wagi i przedziału Cmin–Cmax, a nie z liczby opisanych poziomów.
   */
  it("I-11 G: Ui śr wypełnione także przy skali dwustopniowej", () => {
    const dwustopniowa = buildDocumentModel(wycena1409Anon({ skalaPowierzchni: "jak_zgloszono" }));
    const powierzchnia = dwustopniowa.cechy.find((c) => c.nazwa === "Powierzchnia użytkowa");
    expect(powierzchnia).toBeDefined();
    expect(powierzchnia!.ui_sr).not.toBe("—");
    expect(powierzchnia!.ui_sr).toMatch(/^\d+,\d{3}$/);

    const tabela3 = render({ skalaPowierzchni: "jak_zgloszono" });
    const komorki = sectionParagraphs(tabela3, "12.3.")
      .filter((p) => p.container === "table")
      .map((p) => p.text);
    for (const cecha of dwustopniowa.cechy) expect(komorki).toContain(cecha.ui_sr);
  });

  it("I-11 G: SUMA kolumny Ui śr przychodzi z modelu, nie jest literałem", () => {
    const komorki = sectionParagraphs(doc, "12.3.")
      .filter((p) => p.container === "table")
      .map((p) => p.text);
    expect(komorki).toContain(model.suma_ui_sr);
    // Σ kolumny Ui śr = Σ wag, więc przy wagach sumujących się do 100 % to
    // „1,000" — ta sama liczba, którą operat źródłowy miał tu wpisaną na
    // sztywno. Dlatego asercją jest RÓWNOŚĆ Z KOLUMNĄ, nie sam literał: on
    // przechodziłby także po cofnięciu poprawki.
    const suma = model.cechy.reduce((s, c) => s + Number(c.ui_sr.replace(",", ".")), 0);
    expect(model.suma_ui_sr).toBe((Math.round(suma * 1000) / 1000).toFixed(3).replace(".", ","));
    // ΣUi kolumny przedmiotu (Tabela 3) = ΣUi, którym Tabela 4 mnoży cenę.
    expect(komorki).toContain(model.suma_ui);
    expect(sectionText(doc, "12.3.")).toContain(model.suma_ui);
  });

  /**
   * Nośnik mutacji dla komórki SUMA. Na fiksturze bazowej Σ wag wynosi dokładnie
   * 1,000 — czyli TYLE SAMO, co literał operatu źródłowego, który tu stał — więc
   * cofnięcie poprawki przechodziłoby niezauważone (zmierzone). Wycena, w której
   * jedna cecha nie liczy się do wyniku, daje 0,940 i rozstrzyga, skąd ta komórka
   * bierze liczbę.
   */
  it("I-11 G: SUMA Ui śr przy niepełnym zestawie cech pokazuje 0,940, nie 1,000", () => {
    const input = wycena1409Anon({ skalaPowierzchni: "poprawiona" });
    input.inputs.features = input.inputs.features.filter((f) => f.key !== "dodatkowe");
    input.kcs = computeKcs(input.inputs);
    const m = buildDocumentModel(input);
    expect(m.suma_ui_sr).toBe("0,940");

    const komorki = sectionParagraphs(openDocx(renderOperatDocx(m)), "12.3.")
      .filter((p) => p.container === "table")
      .map((p) => p.text);
    expect(komorki).toContain("0,940");
    expect(komorki).not.toContain("1,000");
  });

  it("I-12 G: §12.2 nazywa ulicę lokalu Cmin/Cmax, nie „analizowany obszar rynku”", () => {
    expectNoText(doc, "w analizowanym obszarze rynku");
    const sec = sectionText(doc, "12.2.");
    expect(model.lokalizacja_cmin).not.toBe("");
    expect(sec).toContain(`Lokal mieszkalny położony jest przy ${model.lokalizacja_cmin}.`);
    expect(sec).toContain(`Lokal mieszkalny położony jest przy ${model.lokalizacja_cmax}.`);
    expect(sec).toContain("Lokal mieszkalny położony jest pod adresem: ul. Testowa 7/12, Poznań.");
  });

  /**
   * D-53: dwie transakcje fikstury mają tę samą najniższą cenę jednostkową.
   * Opis musi objąć OBIE, każdą jej własnymi danymi — dawna płaska lista brała
   * tylko pierwszy lokal.
   */
  it("I-12 G: remis ceny opisuje wszystkie lokale, każdy swoimi cechami (D-52, D-53)", () => {
    expect(model.lokale_cmin).toHaveLength(2);
    const sec = sectionText(doc, "12.2.");
    for (const lokal of model.lokale_cmin) {
      expect(sec).toContain(`Lokal mieszkalny położony jest przy ${lokal.lokalizacja}.`);
      for (const cecha of lokal.cechy) expect(sec).toContain(`${cecha.nazwa} – ${cecha.opis},`);
    }
    // Dwa lokale o różnych ulicach -> dwa różne zdania o położeniu w Cmin.
    expect(new Set(model.lokale_cmin.map((l) => l.lokalizacja)).size).toBe(2);
  });

  it("D-51: bez ulicy w rejestrze zdanie o położeniu znika, a opis cech zostaje", () => {
    const input = wycena1409Anon({ skalaPowierzchni: "poprawiona" });
    for (const c of input.inputs.sampleSelection!.proposed) c.street = null;
    const m = buildDocumentModel(input);
    expect(m.lokalizacja_cmin).toBe("");
    const d = openDocx(renderOperatDocx(m));
    expectNoText(d, "Lokal mieszkalny położony jest przy .");
    expectNoText(d, "położony jest przy {lokalizacja}");
    expect(sectionText(d, "12.2.")).toContain(`${m.lokale_cmin[0].cechy[0].nazwa} – `);
  });
});

/** Sentinele akapitów, które w §8.2 dokłada etap 14 generatora. */
const SENTINELS_82 = [
  "dokonano badania księgi wieczystej",
  "Dział III:",
  "Dział IV:",
  "Numer lokalu wg księgi wieczystej:",
  "Uwaga: w dziale III księgi wieczystej lokalu",
];
