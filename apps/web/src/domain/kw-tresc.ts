import { z } from "zod";

/**
 * Content of the five sections of a land-register book (I-O, I-Sp, II, III, IV)
 * transcribed by the worker's POST /kw-transcribe — a unit's book in full, a
 * land book selectively down to the subject unit (ADR-024). `ksiegaTrescSchema`
 * mirrors `KsiegaTresc` in apps/worker/app/kw_transcribe.py 1:1 — the MODEL's
 * output schema, without `zakres`, which the worker sets. Every value is the eKW
 * text verbatim, as a string (unit numbers like "NN BUD NN", shares with spaces
 * around "/"). Carries persons' data on purpose (ADR-018 "Zmiana 15.09"): it
 * never goes to a log.
 *
 * Zapisywana jako `inputs.kw.tresc` ZAWSZE, gdy transkrypcja wróciła — także
 * przy `walidacja.ok === false` (ADR-021 reg. 5). Werdykt jedzie obok, w
 * `transkrypcja`, i to on ostrzega: nieudane sprawdzenie jest ostrzeżeniem dla
 * rzeczoznawcy, nie powodem, by wyrzucić to, co księga mówi.
 */
const rubrykaSchema = z.object({
  nazwa: z.string(),
  lp: z.string().nullable(),
  wartosci: z.array(z.string()),
});

const wpisSchema = z.object({
  lp: z.string().nullable(),
  nrPodstawyWpisu: z.string().nullable(),
  rubryki: z.array(rubrykaSchema),
});

const tabelaSchema = z.object({
  naglowek: z.string().nullable(),
  wpisy: z.array(wpisSchema),
});

const dokumentPodstawySchema = z.object({
  nrPodstawyWpisu: z.string(),
  dokument: z.string(),
  dokumentOpisPol: z.string().nullable(),
  wniosek: z.string().nullable(),
  wniosekOpisPol: z.string().nullable(),
});

const dzialSchema = z.object({
  kod: z.enum(["I-O", "I-Sp", "II", "III", "IV"]),
  tytul: z.string(),
  brakWpisow: z.boolean(),
  tabele: z.array(tabelaSchema),
  dokumenty: z.array(dokumentPodstawySchema),
});

/** Zakres treści (ADR-024): księga lokalu w całości, księga gruntu do przedmiotowego lokalu. */
export const zakresSchema = z.enum(["pelna", "przedmiotowy_lokal"]);
export type Zakres = z.infer<typeof zakresSchema>;

/** Lustro schematu WYJŚCIA MODELU (`KsiegaTresc` workera) — bez `zakres`. */
export const ksiegaTrescSchema = z.object({
  naglowek: z.object({
    numerKsiegi: z.string(),
    stanZDnia: z.string().nullable(),
    sad: z.string().nullable(),
    wydzial: z.string().nullable(),
    rodzajKsiegi: z.string().nullable(),
  }),
  dzialy: z.array(dzialSchema),
  polaDodatkowe: z.object({
    numerLokalu: z.string().nullable(),
    kwLokalu: z.string().nullable(),
    kwGruntu: z.string().nullable(),
    udzial: z.string().nullable(),
    powierzchniaUzytkowa: z.string().nullable(),
    podstawaNabycia: z
      .object({
        tytulAktu: z.string().nullable(),
        repA: z.string().nullable(),
        dataAktu: z.string().nullable(),
        notariusz: z.string().nullable(),
        siedzibaNotariusza: z.string().nullable(),
      })
      .nullable(),
  }),
});

/**
 * Treść w migawce (`kw.tresc`, `kwGrunt.tresc`): `zakres` nullish WYŁĄCZNIE do
 * odczytu migawek sprzed ADR-024 (brak = operat bez zdania o zakresie). Nowy
 * zapis zawsze ma `zakres` z workera.
 */
export const ksiegaTrescMigawkiSchema = ksiegaTrescSchema.extend({
  zakres: zakresSchema.nullish(),
});

export type KsiegaTresc = z.infer<typeof ksiegaTrescMigawkiSchema>;

/**
 * Czy nagłówek nazywa księgę GRUNTOWĄ. Ta sama reguła, co `is_land_book`
 * w `apps/worker/app/kw_validate.py` (PR #77, 1f20f8c) — i musi nią zostać:
 * web i worker mają jednakowo rozstrzygać, których pól księga w ogóle ma.
 * Walidator workera od ADR-024 uznaje za księgę gruntu także treść z karty
 * gruntu bez rodzaju w nagłówku; ta funkcja czyta sam nagłówek.
 * eKW pisze rodzaj na trzy sposoby („NIERUCHOMOŚĆ GRUNTOWA", „GRUNT ODDANY
 * W UŻYTKOWANIE WIECZYSTE" i ten sam z budynkiem), więc wspólnym rdzeniem
 * jest „GRUNT", a nie „GRUNTOW". Żaden rodzaj lokalowy nie zawiera „GRUNT",
 * więc test nie zadziała w drugą stronę. Brak rodzaju to NIE księga gruntu.
 */
export function jestKsiegaGruntu(rodzaj: string | null | undefined): boolean {
  return rodzaj != null && rodzaj.toUpperCase().includes("GRUNT");
}

/**
 * The worker's deterministic verdict (check digits, PESEL checksums, fields vs
 * content, structure). Error classes never carry a value, e.g.
 * `kw_cyfra_kontrolna:kwGruntu`, `pesel_suma`, `pole_niezgodne:repA`.
 */
export const kwWalidacjaSchema = z.object({
  ok: z.boolean(),
  bledy: z.array(z.object({ klasa: z.string(), dzial: z.string().optional() })),
});

export type KwWalidacja = z.infer<typeof kwWalidacjaSchema>;

/**
 * The /kw-transcribe 200 body: the content, flat, its scope and its verdict.
 * `zakres` WYMAGANY — worker bez niego to drift kontraktu (F-S1).
 */
export const kwTranscribeResponseSchema = ksiegaTrescSchema.extend({
  zakres: zakresSchema,
  walidacja: kwWalidacjaSchema,
});

export type KwTranscribeResponse = z.infer<typeof kwTranscribeResponseSchema>;
