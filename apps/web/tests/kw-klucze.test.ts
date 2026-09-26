import { describe, expect, it } from "vitest";
import {
  kluczeLokalu,
  kwLokaluZmieniony,
  przepisanieGruntuZablokowane,
  trescGruntuDlaInnegoLokalu,
} from "@/domain/kw-klucze";

// Klucze nie w kształcie numeru KW: domena nie sprawdza formatu, a check-no-pii.sh (F-9)
// zatrzymuje w pliku śledzonym każdy ciąg w kształcie numeru KW.
const KW = "KW-A";
const kw = (
  o: Partial<{ kwLokalu: string | null; nrLokalu: string | null; deweloperski: boolean }>,
) => ({ kwLokalu: null, nrLokalu: null, deweloperski: false, ...o });

describe("kluczeLokalu", () => {
  it("M1: numer KW i numer lokalu z karty", () =>
    expect(kluczeLokalu(kw({ kwLokalu: ` ${KW} `, nrLokalu: " 24 " }), "")).toEqual({
      kwLokalu: KW,
      nrLokalu: "24",
    }));
  it("M2: pusta karta lokalu → brak kluczy", () => expect(kluczeLokalu(kw({}), "")).toBeNull());
  it("M3: sam numer KW", () =>
    expect(kluczeLokalu(kw({ kwLokalu: KW }), "")).toEqual({ kwLokalu: KW, nrLokalu: null }));
  it("M4: numer tylko w kwNumber (szkic sprzed ADR-018)", () => {
    expect(kluczeLokalu(null, KW)).toEqual({ kwLokalu: KW, nrLokalu: null });
    expect(kluczeLokalu(kw({ nrLokalu: "24" }), ` ${KW} `)).toEqual({
      kwLokalu: KW,
      nrLokalu: "24",
    });
  });
  it("M5: deweloperski → brak kluczy, nawet z kwNumber", () =>
    expect(kluczeLokalu(kw({ deweloperski: true, kwLokalu: KW }), KW)).toBeNull());
});

describe("przepisanieGruntuZablokowane", () => {
  it("M2: własność bez numeru KW lokalu → zablokowane", () =>
    expect(przepisanieGruntuZablokowane("wlasnosc_lokalu", kw({}), "")).toBe(true));
  it("M2: brak prawa = własność (domyślne); same spacje to brak numeru", () => {
    expect(przepisanieGruntuZablokowane(undefined, null, "")).toBe(true);
    expect(przepisanieGruntuZablokowane(undefined, kw({ kwLokalu: "  " }), " ")).toBe(true);
  });
  it("M1/M3/M4: z numerem → odblokowane", () => {
    expect(przepisanieGruntuZablokowane("wlasnosc_lokalu", kw({ kwLokalu: KW }), "")).toBe(false);
    expect(przepisanieGruntuZablokowane("wlasnosc_lokalu", null, KW)).toBe(false);
  });
  it("M5: deweloperski bez numeru → bez blokady", () =>
    expect(przepisanieGruntuZablokowane("wlasnosc_lokalu", kw({ deweloperski: true }), "")).toBe(
      false,
    ));
  it("M6: spółdzielcze bez numeru → bez blokady", () =>
    expect(przepisanieGruntuZablokowane("spoldzielcze_wlasnosciowe", null, "")).toBe(false));
});

describe("kwLokaluZmieniony / trescGruntuDlaInnegoLokalu", () => {
  const zapisane = { kwLokalu: KW, nrLokalu: "24" };
  it("ten sam numer KW innym zapisem → bez zmiany", () =>
    expect(kwLokaluZmieniony(zapisane, { kwLokalu: " kw / - a ", nrLokalu: "24" })).toBe(false));
  it("M8: inny numer KW → zmiana", () =>
    expect(kwLokaluZmieniony(zapisane, { kwLokalu: "KW-B", nrLokalu: "24" })).toBe(true));
  it("M8: sam numer lokalu się nie liczy (null→wartość, wartość→inna, wartość→null)", () => {
    expect(
      kwLokaluZmieniony({ kwLokalu: KW, nrLokalu: null }, { kwLokalu: KW, nrLokalu: "24" }),
    ).toBe(false);
    expect(kwLokaluZmieniony(zapisane, { kwLokalu: KW, nrLokalu: "25" })).toBe(false);
    expect(kwLokaluZmieniony(zapisane, { kwLokalu: KW, nrLokalu: null })).toBe(false);
  });
  it("null vs null → bez zmiany; null vs klucze i klucze vs null → zmiana", () => {
    expect(kwLokaluZmieniony(null, null)).toBe(false);
    expect(kwLokaluZmieniony(null, zapisane)).toBe(true);
    expect(kwLokaluZmieniony(zapisane, null)).toBe(true);
  });
  const tresc = (zakres?: "pelna" | "przedmiotowy_lokal") => ({ zakres }) as never;
  it("M8: treść przepisana dla innego numeru KW → T4; ten sam KW z uzupełnionym nr lokalu → bez T4", () => {
    expect(
      trescGruntuDlaInnegoLokalu(
        { tresc: tresc("przedmiotowy_lokal"), kluczeLokalu: zapisane },
        { kwLokalu: "KW-B", nrLokalu: "24" },
      ),
    ).toBe(true);
    expect(
      trescGruntuDlaInnegoLokalu(
        { tresc: tresc("przedmiotowy_lokal"), kluczeLokalu: { kwLokalu: KW, nrLokalu: null } },
        { kwLokalu: KW, nrLokalu: "24" },
      ),
    ).toBe(false);
  });
  it("M5→M1: przepisano bez kluczy (deweloperski), a teraz karta lokalu ma numer → T4", () =>
    expect(
      trescGruntuDlaInnegoLokalu(
        { tresc: tresc("przedmiotowy_lokal"), kluczeLokalu: null },
        { kwLokalu: KW, nrLokalu: null },
      ),
    ).toBe(true));
  it("M9: stara migawka bez zakresu → nigdy T4", () => {
    expect(
      trescGruntuDlaInnegoLokalu(
        { tresc: tresc(undefined), kluczeLokalu: undefined },
        { kwLokalu: KW, nrLokalu: "25" },
      ),
    ).toBe(false);
    // Treść księgi LOKALU (`pelna`) nigdy nie jest „przepisana dla innego lokalu”.
    expect(
      trescGruntuDlaInnegoLokalu(
        { tresc: tresc("pelna"), kluczeLokalu: zapisane },
        { kwLokalu: "KW-B", nrLokalu: "24" },
      ),
    ).toBe(false);
  });
  it("bez treści → bez T4", () => expect(trescGruntuDlaInnegoLokalu(null, zapisane)).toBe(false));
});
