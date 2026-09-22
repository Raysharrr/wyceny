import { describe, expect, it } from "vitest";
import { nazwaNiezgodnosci, nazwyNiezgodnosci, podpisyPol } from "@/domain/kw-niezgodnosci";

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
