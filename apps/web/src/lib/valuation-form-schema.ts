import { z } from "zod";

/**
 * Shared validation for the valuation form — used by BOTH the client
 * (react-hook-form resolver) and the Server Action (authoritative re-check).
 * Polish messages (UI copy). Weights are edited in % here; the action
 * converts to fractions before calling the KCS engine.
 */

export const comparableSchema = z.object({
  date: z.string().trim().optional(),
  area: z.coerce.number().positive("Powierzchnia musi być większa od zera.").optional(),
  pricePerM2: z.coerce.number().positive("Cena zł/m² musi być większa od zera."),
  // Provenance (F-5) — set when a comparable came from the RCN auto-fetch
  // rather than manual entry. Optional so manual-only submissions keep
  // validating exactly as before.
  source: z.enum(["rcn", "manual"]).optional(),
  transactionId: z.string().optional(),
});

export const featureSchema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę cechy."),
  weightPct: z.coerce.number().min(0, "Waga nie może być ujemna."),
  rating: z.enum(["gorsza", "przecietna", "lepsza"]),
});

/** Mirrors `SampleMeta` from `@/ports/sample` — the RCN fetch's provenance for the whole sample (F-5). */
export const sampleMetaSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  fetchedAt: z.string(),
  source: z.string(),
  query: z.object({
    bbox: z.array(z.number()),
    count: z.number(),
    sort: z.string(),
  }),
});

/** Mirrors `SubjectSnapshot` from `@/domain/subject-snapshot` — the auto-fetched EGiB/MPZP subject data. */
export const subjectSchema = z.object({
  parcelId: z.string().optional(),
  obreb: z.string().optional(),
  arkusz: z.string().optional(),
  nrDzialki: z.string().optional(),
  powEwidHa: z.coerce
    .number()
    .positive("Powierzchnia działki musi być większa od zera.")
    .optional(),
  uzytek: z.string().optional(),
  budynekRodzaj: z.string().optional(),
  kondygnacjeNadziemne: z.coerce.number().int().min(0).optional(),
  kondygnacjePodziemne: z.coerce.number().int().min(0).optional(),
  rokBudowy: z.coerce
    .number()
    .int()
    .min(1500, "Rok budowy wygląda na błędny.")
    .max(2100, "Rok budowy wygląda na błędny.")
    .optional(),
  mpzpAbsent: z.boolean().optional(),
  mpzpSymbol: z.string().optional(),
  mpzpNazwa: z.string().optional(),
  mpzpUchwala: z.string().optional(),
  mpzpData: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Podaj datę w formacie RRRR-MM-DD."),
  mpzpPubl: z.string().optional(),
  przeznaczenieStudium: z.string().optional(),
});

/** Mirrors `SubjectMetaSnapshot` from `@/domain/subject-snapshot` — the fetch's provenance for the subject snapshot (F-5). */
export const subjectMetaSchema = z.object({
  x: z.number(),
  y: z.number(),
  teryt: z.string(),
  fetchedAt: z.string(),
  source: z.string(),
  mpzpAbsent: z.boolean(),
});

export const valuationFormSchema = z.object({
  address: z.string().trim().min(1, "Podaj adres nieruchomości."),
  area: z.coerce.number().positive("Powierzchnia musi być większa od zera."),
  comparables: z.array(comparableSchema).min(3, "Podaj co najmniej 3 transakcje porównawcze."),
  features: z
    .array(featureSchema)
    .min(1, "Podaj co najmniej jedną cechę.")
    .refine(
      (features) => Math.abs(features.reduce((sum, f) => sum + f.weightPct, 0) - 100) <= 0.1,
      "Suma wag musi wynosić 100%.",
    ),
  sampleMeta: sampleMetaSchema.optional(),
  subject: subjectSchema.optional(),
  subjectMeta: subjectMetaSchema.optional(),
  purpose: z.enum(["sprzedaz", "zabezpieczenie_kredytu", "informacyjny"], {
    message: "Wybierz cel wyceny.",
  }),
  kwNumber: z.string().trim().min(1, "Podaj numer księgi wieczystej."),
  client: z.string().trim().min(1, "Podaj zamawiającego wycenę."),
  inspectionDate: z.string().min(1, "Podaj datę oględzin."),
});

export type ValuationFormValues = z.infer<typeof valuationFormSchema>;

/** Default feature bag for a lokal — weights per mockup v3-r4 (docelowo derived from market analysis). */
export const DEFAULT_FEATURES: ValuationFormValues["features"] = [
  { name: "standard wykończenia", weightPct: 40, rating: "przecietna" },
  { name: "położenie na piętrze", weightPct: 30, rating: "przecietna" },
  { name: "lokalizacja", weightPct: 10, rating: "przecietna" },
  { name: "powierzchnia użytkowa", weightPct: 10, rating: "przecietna" },
  { name: "pomieszczenia przynależne", weightPct: 4, rating: "przecietna" },
  { name: "dodatkowe", weightPct: 6, rating: "przecietna" },
];
