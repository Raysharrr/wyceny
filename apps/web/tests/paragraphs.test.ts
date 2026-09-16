import { describe, expect, it } from "vitest";
import { toInlineText, toParagraphs } from "../src/domain/paragraphs";

/**
 * M-11 (D-36/D-37). Jedna reguła zamiany bloku prozy na akapity operatu.
 * Każdy przypadek tutaj był widziany w wydanym dokumencie albo w operatach
 * wzorcowych — to nie są warianty wymyślone przy pisaniu testu.
 */
describe("toParagraphs — akapity prozy operatu (M-11)", () => {
  it("pusta linia zaczyna nowy akapit", () => {
    expect(toParagraphs("Pierwszy.\n\nDrugi.\n\n\nTrzeci.")).toEqual([
      "Pierwszy.",
      "Drugi.",
      "Trzeci.",
    ]);
  });

  it("pojedyncze zawinięcie łączy się SPACJĄ — to naprawia sklejone słowa", () => {
    // Dosłownie z operatu wydanego 14.09: model zawijał po ~88 kolumnach, bo
    // tak zawinięte są few-shoty w jego prompcie, i granica zawinięcia zjadała
    // spację: „35,20 m2do", „zostałaustalona", „porównańzawierały".
    expect(toParagraphs("od 35,20 m2\ndo 48,67 m2.")).toEqual(["od 35,20 m2 do 48,67 m2."]);
    expect(toParagraphs("Średnia cena\nzostała ustalona.")).toEqual([
      "Średnia cena została ustalona.",
    ]);
  });

  it("linia otwierająca punktor jest osobnym akapitem, mimo braku pustej linii", () => {
    // §11 podaje kryteria doboru jako wprowadzenie i listę myślników. Gdyby
    // myślniki łączyły się spacją, jedna nieczytelna §11 zamieniłaby się
    // w drugą — wyszło na renderze, nie w rozumowaniu.
    expect(toParagraphs("Cechy rynku:\n- lokale mieszkalne,\n- transakcje z 2 lat.")).toEqual([
      "Cechy rynku:",
      "- lokale mieszkalne,",
      "- transakcje z 2 lat.",
    ]);
  });

  it.each(["–", "—", "•", "*"])("rozpoznaje też znacznik listy %s", (znak) => {
    expect(toParagraphs(`Nagłówek:\n${znak} pozycja`)).toHaveLength(2);
  });

  it("myślnik w środku zdania NIE jest listą — zawinięcie zostaje zawinięciem", () => {
    expect(toParagraphs("Lokal dwupokojowy\n- w stanie dobrym - po remoncie.")).toHaveLength(2);
    expect(toParagraphs("Zakres 35\n-50 m2 przyjęto do porównań.")).toEqual([
      "Zakres 35 -50 m2 przyjęto do porównań.",
    ]);
  });

  it("puste, białe i brakujące wejście nie daje ani jednego akapitu", () => {
    for (const input of ["", "   ", "\n\n", null, undefined]) {
      expect(toParagraphs(input)).toEqual([]);
    }
  });

  it("normalizuje końce linii z Windowsa", () => {
    expect(toParagraphs("Pierwszy.\r\n\r\nDrugi.")).toEqual(["Pierwszy.", "Drugi."]);
  });

  it("toInlineText skleja te same akapity spacją i nie zostawia znaku nowej linii", () => {
    const text = toInlineText("Pierwszy.\n\nDrugi\nzawinięty.");
    expect(text).toBe("Pierwszy. Drugi zawinięty.");
    expect(text).not.toContain("\n");
  });
});
