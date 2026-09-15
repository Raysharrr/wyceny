import { z } from "zod";

/**
 * Full content of the five sections of a unit's land-register book (I-O, I-Sp,
 * II, III, IV) transcribed by the worker's POST /kw-transcribe — mirrors
 * `KsiegaTresc` in apps/worker/app/kw_transcribe.py 1:1. Every value is the eKW
 * text verbatim, as a string (unit numbers like "NN BUD NN", shares with spaces
 * around "/"). Carries persons' data on purpose (ADR-018 "Zmiana 15.09"): it
 * never goes to a log. Stored as `inputs.kw.tresc` only when the worker's
 * `walidacja.ok` is true.
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

export type KsiegaTresc = z.infer<typeof ksiegaTrescSchema>;

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

/** The /kw-transcribe 200 body: the content, flat, next to its verdict. */
export const kwTranscribeResponseSchema = ksiegaTrescSchema.extend({
  walidacja: kwWalidacjaSchema,
});

export type KwTranscribeResponse = z.infer<typeof kwTranscribeResponseSchema>;
