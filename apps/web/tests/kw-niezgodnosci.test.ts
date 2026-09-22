import { describe, expect, it } from "vitest";
import {
  nazwaNiezgodnosci,
  nazwyNiezgodnosci,
  podpisyPol,
  rodzajNiezgodny,
} from "@/domain/kw-niezgodnosci";
import { jestKsiegaGruntu, type KsiegaTresc } from "@/domain/kw-tresc";

describe("nazwaNiezgodnosci — słownik po polsku (spec §6)", () => {
  it.each([
    [{ klasa: "kw_cyfra_kontrolna:numerKsiegi" }, "cyfra kontrolna numeru księgi lokalu"],
    [{ klasa: "kw_cyfra_kontrolna:kwLokalu" }, "cyfra kontrolna numeru księgi lokalu"],
    [{ klasa: "kw_cyfra_kontrolna:kwGruntu" }, "cyfra kontrolna numeru księgi gruntu"],
    [{ klasa: "pesel_suma", dzial: "III" }, "numer PESEL w dziale III"],
    [{ klasa: "pole_niezgodne:kwGruntu" }, "numer księgi gruntu"],
    [{ klasa: "pole_niezgodne:kwLokalu" }, "numer księgi lokalu"],
    [{ klasa: "pole_niezgodne:numerLokalu" }, "numer lokalu"],
    [{ klasa: "pole_niezgodne:udzial" }, "udział w nieruchomości wspólnej"],
    [{ klasa: "pole_niezgodne:repA" }, "numer Rep. A aktu"],
    [{ klasa: "brak_wpisow_niespojny", dzial: "IV" }, "oznaczenie „brak wpisów” w dziale IV"],
    [{ klasa: "rubryka_separator", dzial: "I-O" }, "pusta rubryka w dziale I-O"],
    [{ klasa: "dzialy_niekompletne", dzial: "IV" }, "brak działu IV"],
    [
      { klasa: "rodzaj_ksiegi:grunt_na_lokalu" },
      "rodzaj księgi (treść opisuje nieruchomość gruntową, a to karta księgi lokalu)",
    ],
    [
      { klasa: "rodzaj_ksiegi:lokal_na_gruncie" },
      "rodzaj księgi (treść nie opisuje nieruchomości gruntowej, a to karta księgi gruntu)",
    ],
  ])("%j → %s", (bledy, nazwa) => {
    expect(nazwaNiezgodnosci(bledy)).toBe(nazwa);
  });

  it("nazwyNiezgodnosci składa brakujące działy (jeden wpis workera na dział) w jedną nazwę, reszta po kolei", () => {
    expect(
      nazwyNiezgodnosci([
        { klasa: "pesel_suma", dzial: "II" },
        { klasa: "dzialy_niekompletne", dzial: "III" },
        { klasa: "dzialy_niekompletne", dzial: "IV" },
      ]),
    ).toEqual(["numer PESEL w dziale II", "brak działów III i IV"]);
    expect(nazwyNiezgodnosci([{ klasa: "dzialy_niekompletne", dzial: "IV" }])).toEqual([
      "brak działu IV",
    ]);
  });

  it("nieznana klasa wraca dosłownie — lepiej surowy kod niż zmyślona nazwa", () => {
    expect(nazwaNiezgodnosci({ klasa: "cos_nowego:x" })).toBe("cos_nowego:x");
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
      kwGruntu: "Cyfra kontrolna nie zgadza się z numerem.",
    });
  });
});

/**
 * Niezgodności, których worker zobaczyć nie może: zna rodzaj księgi, nie zna
 * karty. Reguła rodzaju to ta sama funkcja `jestKsiegaGruntu`, co odcina pola
 * lokalowe — i ten sam próg, co `is_land_book` w workerze.
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
