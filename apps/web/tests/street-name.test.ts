import { describe, it, expect } from "vitest";
import { operatStreet, PREFIXES_TO_STRIP } from "../src/domain/street-name";

/**
 * Which prefixes may be dropped is a DATA question, and the spike answered it on the real
 * export: 991 distinct names, none of them without a prefix — `ul.` 939, `os.` 32,
 * `pl.` 10, `al.` 5, `rynek` 5. Only `ul.` is a generic marker; in the other 52 the word
 * is part of the proper name, and dropping it moves the reader somewhere else in Poznań.
 */
describe("operatStreet — nazwa ulicy do operatu", () => {
  it("obcina „ul.” — 939 z 991 nazw w eksporcie", () => {
    expect(operatStreet("ul. Kościelna")).toBe("Kościelna");
    expect(operatStreet("ul. Jana Henryka Dąbrowskiego")).toBe("Jana Henryka Dąbrowskiego");
  });

  it("zostawia człon tam, gdzie jest częścią nazwy własnej", () => {
    // „Zwycięstwa”, „Wolności” i „Jeżycki” bez członu wskazują inne miejsce w Poznaniu.
    expect(operatStreet("os. Zwycięstwa")).toBe("os. Zwycięstwa");
    expect(operatStreet("pl. Wolności")).toBe("pl. Wolności");
    expect(operatStreet("rynek Jeżycki")).toBe("rynek Jeżycki");
    expect(operatStreet("al. Niepodległości")).toBe("al. Niepodległości");
  });

  it("zostawia zdublowany prefiks rejestru bez zmian — świadomie", () => {
    // Jedyny taki przypadek w całym eksporcie (991 nazw). „al.” nie jest na liście do
    // obcięcia, więc operat wydrukuje to, co mówi rejestr. Wygląda dziwnie, ale zgadywanie,
    // że akurat tu prefiks jest zbędny, byłoby regułą pisaną pod jeden rekord — do decyzji
    // rzeczoznawcy (open-questions), nie do zgadnięcia w kodzie.
    expect(operatStreet("al. Aleje Karola Marcinkowskiego")).toBe(
      "al. Aleje Karola Marcinkowskiego",
    );
  });

  it("brak adresu to kreska, nigdy pusty string ani „undefined”", () => {
    expect(operatStreet(null)).toBe("—");
    expect(operatStreet(undefined)).toBe("—");
    expect(operatStreet("   ")).toBe("—");
  });

  it("lista prefiksów jest jedną stałą — zmiana decyzji kosztuje linijkę", () => {
    expect(PREFIXES_TO_STRIP).toEqual(["ul."]);
  });
});
