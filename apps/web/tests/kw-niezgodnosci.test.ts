import { describe, expect, it } from "vitest";
import {
  nazwaNiezgodnosci,
  nazwyNiezgodnosci,
  podpisyPol,
  rodzajNiezgodny,
} from "@/domain/kw-niezgodnosci";
import { jestKsiegaGruntu, type KsiegaTresc } from "@/domain/kw-tresc";

describe("nazwaNiezgodnosci — słownik po polsku (spec §6), nazwa zależna od karty", () => {
  it.each([
    // Numer WŁASNY przepisanej księgi — nazywa go karta, na której stoi baner
    // (F1 recenzji całości KW). Do 22.09 mapa mówiła „lokalu" także na karcie
    // gruntu, a ten `it.each` utrwalał ten defekt jednym wierszem.
    [{ klasa: "kw_cyfra_kontrolna:numerKsiegi" }, "lokal", "cyfra kontrolna numeru księgi lokalu"],
    [{ klasa: "kw_cyfra_kontrolna:numerKsiegi" }, "grunt", "cyfra kontrolna numeru księgi gruntu"],
    // Pola karty lokalu — od karty nie zależą, bo dla księgi gruntu walidator
    // ich w ogóle nie liczy.
    [{ klasa: "kw_cyfra_kontrolna:kwLokalu" }, "lokal", "cyfra kontrolna numeru księgi lokalu"],
    [{ klasa: "kw_cyfra_kontrolna:kwGruntu" }, "lokal", "cyfra kontrolna numeru księgi gruntu"],
    [{ klasa: "pesel_suma", dzial: "III" }, "lokal", "numer PESEL w dziale III"],
    [{ klasa: "pesel_suma", dzial: "III" }, "grunt", "numer PESEL w dziale III"],
    [{ klasa: "pole_niezgodne:kwGruntu" }, "lokal", "numer księgi gruntu"],
    [{ klasa: "pole_niezgodne:kwLokalu" }, "lokal", "numer księgi lokalu"],
    [{ klasa: "pole_niezgodne:numerLokalu" }, "lokal", "numer lokalu"],
    [{ klasa: "pole_niezgodne:udzial" }, "lokal", "udział w nieruchomości wspólnej"],
    [{ klasa: "pole_niezgodne:repA" }, "lokal", "numer Rep. A aktu"],
    [
      { klasa: "brak_wpisow_niespojny", dzial: "IV" },
      "grunt",
      "oznaczenie „brak wpisów” w dziale IV",
    ],
    [{ klasa: "rubryka_separator", dzial: "I-O" }, "grunt", "pusta rubryka w dziale I-O"],
    [{ klasa: "dzialy_niekompletne", dzial: "IV" }, "lokal", "brak działu IV"],
    [
      { klasa: "rodzaj_ksiegi:grunt_na_lokalu" },
      "lokal",
      "rodzaj księgi (treść opisuje nieruchomość gruntową, a to karta księgi lokalu)",
    ],
    [
      { klasa: "rodzaj_ksiegi:lokal_na_gruncie" },
      "grunt",
      "rodzaj księgi (treść nie opisuje nieruchomości gruntowej, a to karta księgi gruntu)",
    ],
  ] as const)("%j na karcie %s → %s", (bledy, ksiega, nazwa) => {
    expect(nazwaNiezgodnosci(bledy, ksiega)).toBe(nazwa);
  });

  it("nazwyNiezgodnosci składa brakujące działy (jeden wpis workera na dział) w jedną nazwę, reszta po kolei", () => {
    expect(
      nazwyNiezgodnosci(
        [
          { klasa: "pesel_suma", dzial: "II" },
          { klasa: "dzialy_niekompletne", dzial: "III" },
          { klasa: "dzialy_niekompletne", dzial: "IV" },
        ],
        "lokal",
      ),
    ).toEqual(["numer PESEL w dziale II", "brak działów III i IV"]);
    expect(nazwyNiezgodnosci([{ klasa: "dzialy_niekompletne", dzial: "IV" }], "lokal")).toEqual([
      "brak działu IV",
    ]);
  });

  it("nazwyNiezgodnosci przenosi kartę na każdą nazwę, nie tylko na pierwszą", () => {
    expect(
      nazwyNiezgodnosci(
        [{ klasa: "pesel_suma", dzial: "II" }, { klasa: "kw_cyfra_kontrolna:numerKsiegi" }],
        "grunt",
      ),
    ).toEqual(["numer PESEL w dziale II", "cyfra kontrolna numeru księgi gruntu"]);
  });

  it("T5: brak wiersza przedmiotowego lokalu w dziale II — ta sama nazwa w banerze i w markerze podglądu (ADR-024)", () => {
    const t5 = { klasa: "brak_wiersza_lokalu", dzial: "II" };
    expect(nazwaNiezgodnosci(t5, "grunt")).toBe("brak wiersza przedmiotowego lokalu w dziale II");
    expect(nazwyNiezgodnosci([t5, { klasa: "dzialy_niekompletne", dzial: "IV" }], "grunt")).toEqual(
      ["brak wiersza przedmiotowego lokalu w dziale II", "brak działu IV"],
    );
    // Bez podpisu pod polem (spec §5.4) — to niezgodność treści, nie pola karty.
    expect(podpisyPol([t5])).toEqual({});
  });

  it("nieznana klasa wraca dosłownie — lepiej surowy kod niż zmyślona nazwa", () => {
    expect(nazwaNiezgodnosci({ klasa: "cos_nowego:x" }, "lokal")).toBe("cos_nowego:x");
  });
});

describe("podpisyPol — bursztynowy podpis pod polem (makieta 4)", () => {
  it("mapuje klasy na pola karty; klasy bez pola nie dają podpisu", () => {
    expect(
      podpisyPol([
        { klasa: "pole_niezgodne:udzial", dzial: "I-Sp" },
        { klasa: "kw_cyfra_kontrolna:kwGruntu" },
        { klasa: "pesel_suma", dzial: "II" },
      ]),
    ).toEqual({
      udzial: "W dziale I-Sp księga podaje inny udział.",
      kwGruntu: "Numer w przepisanej treści ma błędną cyfrę kontrolną.",
    });
  });
});

/**
 * Niezgodność rodzaju księgi wobec karty — reguła webu: worker zna kartę od
 * ADR-024, ale przeniesienie tej reguły do walidatora odroczono (R4). Reguła
 * rodzaju to ta sama funkcja `jestKsiegaGruntu`, co odcina pola lokalowe — i ten
 * sam próg, co `is_land_book` w workerze.
 */
describe("rodzajNiezgodny — karta kontra rodzaj księgi (E2E koordynatora 22.09)", () => {
  const tresc = (rodzajKsiegi: string | null): KsiegaTresc =>
    ({ naglowek: { rodzajKsiegi } }) as KsiegaTresc;

  it.each([
    ["NIERUCHOMOŚĆ GRUNTOWA", "lokal", { klasa: "rodzaj_ksiegi:grunt_na_lokalu" }],
    ["GRUNT ODDANY W UŻYTKOWANIE WIECZYSTE", "lokal", { klasa: "rodzaj_ksiegi:grunt_na_lokalu" }],
    ["NIERUCHOMOŚĆ GRUNTOWA", "grunt", null],
    ["LOKALOWA", "grunt", { klasa: "rodzaj_ksiegi:lokal_na_gruncie" }],
    ["LOKALOWA", "lokal", null],
  ] as const)("rodzaj %s na karcie %s → %j", (rodzaj, karta, oczekiwane) => {
    expect(rodzajNiezgodny(tresc(rodzaj), karta)).toEqual(oczekiwane);
  });

  it.each(["lokal", "grunt"] as const)(
    "nagłówek bez rodzaju nie daje niezgodności na karcie %s — nie zgadujemy",
    (karta) => {
      expect(rodzajNiezgodny(tresc(null), karta)).toBeNull();
      expect(rodzajNiezgodny(tresc("   "), karta)).toBeNull();
    },
  );

  it("jestKsiegaGruntu odpowiada `is_land_book` workera: rdzeń „GRUNT”, brak rodzaju to nie grunt", () => {
    expect(jestKsiegaGruntu("nieruchomość gruntowa")).toBe(true);
    expect(jestKsiegaGruntu("GRUNT ODDANY W UŻYTKOWANIE WIECZYSTE")).toBe(true);
    expect(jestKsiegaGruntu("LOKALOWA")).toBe(false);
    expect(jestKsiegaGruntu(null)).toBe(false);
  });

  it("podpis siada pod polem numeru tej karty, której dotyczy (makieta 4)", () => {
    expect(podpisyPol([{ klasa: "rodzaj_ksiegi:grunt_na_lokalu" }])).toEqual({
      kwLokalu: "Sprawdź, czy wklejono właściwą księgę.",
    });
    expect(podpisyPol([{ klasa: "rodzaj_ksiegi:lokal_na_gruncie" }])).toEqual({
      kwGruntu: "Sprawdź, czy wklejono właściwą księgę.",
    });
  });
});
