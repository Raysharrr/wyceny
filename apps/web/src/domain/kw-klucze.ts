/**
 * Klucze przedmiotowego lokalu, po których worker wybiera wiersz lokalu z list
 * księgi gruntu (ADR-024 pkt 2). Czysta domena — bez I/O (F-10).
 */
import type { KwGruntSnapshot, KwSnapshot } from "./kw-snapshot";
import type { PropertyRight } from "./property-right";

// Typ żyje tutaj; `kw-snapshot.ts` importuje go dla pola `kwGrunt.kluczeLokalu`
// (tylko `import type` — bez cyklu w runtime).
export type KluczeLokalu = { kwLokalu: string; nrLokalu: string | null };

// Luźno: `getValues("kw")` oddaje kształt formularza, nie `KwSnapshot`.
type KartaLokalu = {
  kwLokalu?: KwSnapshot["kwLokalu"];
  nrLokalu?: KwSnapshot["nrLokalu"];
  deweloperski?: KwSnapshot["deweloperski"];
};

const trim = (v: string | null | undefined): string | null => v?.trim() || null;

/**
 * Numer KW z karty lokalu, a gdy go nie ma — z płaskiego `kwNumber` (szkic sprzed
 * ADR-018 trzyma numer tylko tam; pole karty też go tak pokazuje). Lokal
 * deweloperski nie ma własnej księgi, więc nie ma kluczy — listy lokali pomijamy.
 */
export function kluczeLokalu(
  kw: KartaLokalu | null | undefined,
  kwNumber: string | null | undefined,
): KluczeLokalu | null {
  if (kw?.deweloperski) return null;
  const kwLokalu = trim(kw?.kwLokalu) ?? trim(kwNumber);
  return kwLokalu ? { kwLokalu, nrLokalu: trim(kw?.nrLokalu) } : null;
}

/** Decyzja usera 26.09: własność bez numeru KW lokalu — najpierw księga lokalu (T1). */
export function przepisanieGruntuZablokowane(
  propertyRight: PropertyRight | undefined,
  kw: KartaLokalu | null | undefined,
  kwNumber: string | null | undefined,
): boolean {
  return (
    (propertyRight ?? "wlasnosc_lokalu") === "wlasnosc_lokalu" &&
    !kw?.deweloperski &&
    kluczeLokalu(kw, kwNumber) == null
  );
}

// Ta sama normalizacja co T5 w walidatorze workera: spacje i „/" nic nie znaczą.
const normKw = (v: string) => v.replace(/[\s/]/g, "").toUpperCase();

/**
 * Czy zmienił się numer KW lokalu (decyzja koordynatora 26.09). Numer lokalu się
 * nie liczy: wiersz lokalu na listach księgi gruntu wybiera numer KW, więc
 * uzupełnienie czy poprawka samego numeru lokalu nie unieważnia przepisanej treści.
 */
export function kwLokaluZmieniony(
  zapisane: KluczeLokalu | null,
  biezace: KluczeLokalu | null,
): boolean {
  if (zapisane == null || biezace == null) return zapisane !== biezace;
  return normKw(zapisane.kwLokalu) !== normKw(biezace.kwLokalu);
}

/**
 * T4 (decyzja usera 26.09, doprecyzowana przez koordynatora): treść gruntu
 * przepisana dla innego numeru KW lokalu niż dziś na karcie lokalu. Migawka
 * sprzed ADR-024 (bez `zakres`) nigdy — to odczyt zamrożonego stanu, nie gałąź
 * nowego liczenia.
 */
export function trescGruntuDlaInnegoLokalu(
  kwGrunt:
    (Pick<KwGruntSnapshot, "tresc"> & { kluczeLokalu?: KluczeLokalu | null }) | null | undefined,
  biezace: KluczeLokalu | null,
): boolean {
  return (
    kwGrunt?.tresc?.zakres === "przedmiotowy_lokal" &&
    kwLokaluZmieniony(kwGrunt.kluczeLokalu ?? null, biezace)
  );
}
