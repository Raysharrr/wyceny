import { describe, it, expect } from "vitest";
import { operatStreet, PREFIXES_TO_STRIP } from "../src/domain/street-name";

/**
 * Which prefixes may be dropped is a DATA question, and it has now been answered twice.
 * The spike (2026-08-22) measured the export: 991 distinct names, none without a prefix —
 * `ul.` 939, `os.` 32, `pl.` 10, `al.` 5, `rynek` 5. The reference operats (2026-08-23)
 * answered the other half: all FOUR print the prefix in full — `ul. Kościelna` (12×,
 * Kościelna), `ul. Starołęcka` / `ul. Żorska` (Starołęcka), `ul. Józefa Sowińskiego`
 * (Heweliusza), `ul. Chełmińska` (Winiary). Nothing comes off.
 */
describe("operatStreet — nazwa ulicy do operatu", () => {
  it("zachowuje „ul.” — drukują go wszystkie 4 operaty wzorcowe", () => {
    expect(operatStreet("ul. Kościelna")).toBe("ul. Kościelna");
    expect(operatStreet("ul. Józefa Sowińskiego")).toBe("ul. Józefa Sowińskiego");
    expect(operatStreet("ul. Jana Henryka Dąbrowskiego")).toBe("ul. Jana Henryka Dąbrowskiego");
  });

  it("zostawia człon tam, gdzie jest częścią nazwy własnej", () => {
    // „Zwycięstwa”, „Wolności” i „Jeżycki” bez członu wskazują inne miejsce w Poznaniu.
    expect(operatStreet("os. Zwycięstwa")).toBe("os. Zwycięstwa");
    expect(operatStreet("pl. Wolności")).toBe("pl. Wolności");
    expect(operatStreet("rynek Jeżycki")).toBe("rynek Jeżycki");
    expect(operatStreet("al. Niepodległości")).toBe("al. Niepodległości");
  });

  it("zostawia zdublowany prefiks rejestru bez zmian — świadomie", () => {
    // Jedyny taki przypadek w całym eksporcie (991 nazw). Operat drukuje to, co mówi
    // rejestr. Wygląda dziwnie, ale zgadywanie, że akurat tu prefiks jest zbędny, byłoby
    // regułą pisaną pod jeden rekord — do decyzji rzeczoznawcy (open-questions).
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
    expect(PREFIXES_TO_STRIP).toEqual([]);
  });
});
