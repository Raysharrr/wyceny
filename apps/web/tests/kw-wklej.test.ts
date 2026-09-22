import { describe, expect, it } from "vitest";
import {
  brakujaceDzialy,
  dopiszWklejenie,
  dzialyWTekscie,
  htmlNaTekst,
  listaDzialow,
} from "@/domain/kw-wklej";

describe("htmlNaTekst — schowek przeglądarki KW", () => {
  it("wiersz tabeli staje się „etykieta | wartość | nr podstawy” (spike 21.09)", () => {
    const html =
      '<html><head><meta charset="utf-8"><style>td{x:1}</style></head><body><table><tr><td>Numer działki</td><td>103/1</td><td>1, 10</td></tr></table></body></html>';
    expect(htmlNaTekst(html)).toBe("Numer działki | 103/1 | 1, 10");
  });

  it("nagłówek działu poza tabelą przeżywa, encje są odkodowane, spacje zbite", () => {
    const html =
      "<h2>DZIAŁ I-O - OZNACZENIE&nbsp;NIERUCHOMOŚCI</h2><table><tr><th>Lp.</th><th>Ulica</th></tr><tr><td>1</td><td>UL.&amp;nbsp;TESTOWA  </td></tr></table>";
    expect(htmlNaTekst(html)).toBe(
      "DZIAŁ I-O - OZNACZENIE NIERUCHOMOŚCI\nLp. | Ulica\n1 | UL.&nbsp;TESTOWA",
    );
  });

  it("bez tabel zwraca tekst z tagów blokowych jako linie", () => {
    expect(htmlNaTekst("<div>a</div><p>b<br>c</p>")).toBe("a\nb\nc");
  });
});

describe("dzialyWTekscie / brakujaceDzialy", () => {
  const trzy =
    "TREŚĆ KSIĘGI\nDZIAŁ I-O - OZNACZENIE\nDZIAŁ I-SP - SPIS PRAW\nDZIAŁ II - WŁASNOŚĆ\n";
  it("liczy działy po nagłówkach, w kolejności eKW, bez powtórzeń", () => {
    expect(dzialyWTekscie(trzy + "\n" + trzy)).toEqual(["I-O", "I-Sp", "II"]);
    expect(brakujaceDzialy(trzy)).toEqual(["III", "IV"]);
  });
  it("„DZIAŁ II” nie łapie się na „DZIAŁ III”; „Dzial IV” bez ogonka też liczy", () => {
    expect(dzialyWTekscie("DZIAŁ III - PRAWA\nDzial IV - HIPOTEKA")).toEqual(["III", "IV"]);
  });
  it("pusty tekst → 0 z 5", () => {
    expect(dzialyWTekscie("")).toEqual([]);
    expect(brakujaceDzialy("")).toHaveLength(5);
  });
});

describe("dopiszWklejenie / listaDzialow", () => {
  it("kolejne wklejenia dopisują z pustą linią między nimi; pierwsze nie zaczyna od pustej", () => {
    expect(dopiszWklejenie("", "A")).toBe("A");
    expect(dopiszWklejenie("A\n", "B")).toBe("A\n\nB");
  });
  it("lista po polsku: „III i IV”, „I-O, III i IV”, „IV”", () => {
    expect(listaDzialow(["III", "IV"])).toBe("III i IV");
    expect(listaDzialow(["I-O", "III", "IV"])).toBe("I-O, III i IV");
    expect(listaDzialow(["IV"])).toBe("IV");
  });
});
