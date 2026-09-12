/**
 * T-12 (blok "Prawo spółdzielcze", S1): the closed set of property rights an
 * operat can value, with the wording the document and the gate read from.
 * Texts come verbatim from the Piastowskie operat (research 2026-09-12 §1.1).
 */
import { describe, expect, it } from "vitest";
import {
  PROPERTY_RIGHTS,
  PROPERTY_RIGHT_LABEL,
  PROPERTY_RIGHT_DOC,
} from "../src/domain/property-right";

describe("domain/property-right", () => {
  it("is a closed union with własność first (the column default)", () => {
    expect(PROPERTY_RIGHTS).toEqual(["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"]);
  });

  it("labels match the step-1 mockup", () => {
    expect(PROPERTY_RIGHT_LABEL.wlasnosc_lokalu).toBe("Własność lokalu");
    expect(PROPERTY_RIGHT_LABEL.spoldzielcze_wlasnosciowe).toBe(
      "Spółdzielcze własnościowe prawo do lokalu",
    );
  });

  it("własność: subject phrase in both cases, KW gruntu required, no coop clauses", () => {
    const d = PROPERTY_RIGHT_DOC.wlasnosc_lokalu;
    expect(d.przedmiot.mianownik).toBe("prawo własności nieruchomości lokalowej");
    expect(d.przedmiot.dopelniacz).toBe("prawa własności nieruchomości lokalowej");
    expect(d.podstawyPrawne[0]).toMatch(/^Ustawa z dnia 24 czerwca 1994 r\. o własności lokali/);
    expect(d.klauzule).toEqual([]);
    expect(d.klauzulaPiwnicy).toBeNull();
    expect(d.wymagaKwGruntu).toBe(true);
  });

  it("spółdzielcze: Piastowskie wording, placeholder publikator, KW gruntu not required", () => {
    const d = PROPERTY_RIGHT_DOC.spoldzielcze_wlasnosciowe;
    expect(d.przedmiot.mianownik).toBe("spółdzielcze własnościowe prawo do lokalu mieszkalnego");
    expect(d.przedmiot.dopelniacz).toBe(
      "spółdzielczego własnościowego prawa do lokalu mieszkalnego",
    );
    expect(d.podstawyPrawne).toEqual([
      "Ustawa z dnia 15 grudnia 2000 r. o spółdzielniach mieszkaniowych (Dz. U. — publikator do uzupełnienia)",
    ]);
    expect(d.klauzule).toEqual([
      "Dla spółdzielczego własnościowego prawa do lokalu mieszkalnego nie założono księgi wieczystej.",
    ]);
    expect(d.klauzulaPiwnicy).toBe(
      "Właściciele spółdzielczego własnościowego prawa mają możliwość korzystania z piwnicy, nie jest ona jednak objęta w/w prawem i nie stanowi prawa majątkowego.",
    );
    expect(d.wymagaKwGruntu).toBe(false);
  });
});
