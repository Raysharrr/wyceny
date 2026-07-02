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
});

export const featureSchema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę cechy."),
  weightPct: z.coerce.number().min(0, "Waga nie może być ujemna."),
  rating: z.enum(["gorsza", "przecietna", "lepsza"]),
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
