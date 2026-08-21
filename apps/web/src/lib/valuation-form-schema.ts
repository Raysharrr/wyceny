import { z } from "zod";
import { LOKAL_FEATURE_KEYS, defaultFeatureFormValues } from "@/domain/feature-presets";
import { MANUAL_REJECTION_REASONS } from "@/domain/sample-manual";
import type { CandidatePool } from "@/ports/sample";

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

export const featureDefinitionsSchema = z.object({
  lepsza: z.string().optional(),
  przecietna: z.string().optional(),
  gorsza: z.string().optional(),
});

export const featureSchema = z.object({
  // Closed pool (F-6): a custom feature is added by a commit to the preset,
  // never free-typed (brainstorm decision 2).
  key: z.enum(LOKAL_FEATURE_KEYS, { message: "Nieznana cecha — wybierz z puli." }),
  name: z.string().trim().min(1, "Podaj nazwę cechy."),
  weightPct: z.coerce.number().min(0, "Waga nie może być ujemna."),
  rating: z.enum(["gorsza", "przecietna", "lepsza"]),
  definitions: featureDefinitionsSchema.optional(),
});

/** Mirrors `PoolPoint` from `@/ports/sample` — the subject point the pool was fetched around (ADR-015 v3). */
export const poolPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  source: z.enum(["subject", "uug", "nominatim"]),
});

/** Mirrors `CandidatePool["counts"]` from `@/ports/sample`. */
export const poolCountsSchema = z.object({
  fetched: z.number(),
  deduped: z.number(),
  noPos: z.number(),
});

/** Mirrors `CandidatePool["query"]` from `@/ports/sample`. */
export const poolQuerySchema = z.object({
  bbox: z.array(z.number()),
  count: z.number(),
  sort: z.string(),
  pages: z.number(),
  truncated: z.boolean(),
});

/**
 * `CandidatePool` minus `candidates` (ADR-015 "Dobor proby v3") — the RCN
 * pool fetch's provenance for the whole sample (F-5), persisted alongside
 * `sampleSelection` in `inputs.sampleMeta`. `candidatePoolSchema` (below,
 * this module) extends this with `candidates` rather than redefining the
 * shared fields, so the two stay in lockstep.
 */
export const sampleMetaSchema = z.object({
  point: poolPointSchema,
  maxRadiusM: z.number(),
  counts: poolCountsSchema,
  fetchedAt: z.string(),
  source: z.literal("rcn-wfs-gugik"),
  query: poolQuerySchema,
});

/** Mirrors `Egib` from `@/domain/egib-id` — parsed EGiB identity on an RCN candidate transaction. */
export const egibSchema = z.object({
  teryt: z.string(),
  obreb: z.string(),
  arkusz: z.string(),
  dzialka: z.string(),
  budynek: z.string(),
  lokal: z.string(),
});

/**
 * Mirrors `Candidate` from `@/domain/sample-selection` — one RCN transaction
 * in the sample pool fetched via `PortSampleProposal` (ADR-015). Exported
 * separately from `candidatePoolSchema` (below, this module) so the
 * subject-snapshot schema can reuse it without importing an adapter (F-10).
 */
export const candidateSchema = z.object({
  transactionId: z.string(),
  date: z.string(),
  area: z.number(),
  pricePerM2: z.number(),
  priceTotal: z.number(),
  egib: egibSchema.nullable(),
  lokalId: z.string(),
  distanceM: z.number(),
  floor: z.number().nullable(),
  rooms: z.number().nullable(),
  market: z.enum(["wtorny", "pierwotny"]).nullable(),
  share: z.string(),
  transType: z.string(),
  function: z.string(),
  seller: z.string().nullable(),
  pos: z.object({ x: z.number(), y: z.number() }).nullable(),
});

/**
 * Runtime validation for `CandidatePool` at the trust boundary — the worker
 * is a separate process/deploy, so a shape drift must fail loudly rather
 * than propagate an `as`-cast lie into the ranking/selection logic. Also
 * used by `_pool-cache.ts` (Task 8) to validate the gzip pool cache read
 * back from `PortStorage` — a corrupt cache must throw, never silently
 * become `null` (only a genuinely missing key does that). Composed from
 * `sampleMetaSchema` (`CandidatePool` minus `candidates`) plus
 * `candidateSchema` above, both defined in this module — not redefined in
 * `adapters/sample-http.ts`, so the adapter's pool validation and the pool
 * cache's re-validation share one definition (F-10: adapters may import
 * from `lib`, but nothing outside `app/`/`adapters/` may import an adapter).
 */
export const candidatePoolSchema = sampleMetaSchema.extend({
  candidates: z.array(candidateSchema),
}) satisfies z.ZodType<CandidatePool>;

/** Mirrors `RejectReason` from `@/domain/sample-selection`. */
const rejectReasonSchema = z.enum([
  "share_not_whole",
  "not_free_market",
  "not_residential",
  "no_price",
  "out_of_window",
  "out_of_area_band",
  "primary_market",
]);

/** Mirrors `RejectedRow` from `@/domain/sample-snapshot` — the compact "Odrzucone" row (Slice 3). */
const rejectedRowSchema = z.object({
  transactionId: z.string(),
  lokalId: z.string(),
  reason: rejectReasonSchema,
  allReasons: z.array(rejectReasonSchema),
  date: z.string(),
  area: z.number(),
  pricePerM2: z.number(),
  distanceM: z.number(),
  pos: z.object({ x: z.number(), y: z.number() }).nullable(),
});

/** Mirrors `ManualRejection` from `@/domain/sample-manual` — the appraiser's manual rejection overlay (Slice 3). */
export const manualRejectionSchema = z.object({
  transactionId: z.string(),
  lokalId: z.string(),
  reason: z.enum(MANUAL_REJECTION_REASONS),
  note: z.string().max(500).optional(),
  at: z.string(),
});

/** Mirrors `StreetViewSnapshot` from `@/domain/street-view-snapshot` — frozen Street View per building (Slice 3, ADR-011). */
export const streetViewSchema = z.record(
  z.string(),
  z.object({
    panoId: z.string().nullable(),
    captureDate: z.string().nullable(),
    thumbnailKey: z.string().nullable(),
    heading: z.number().nullable(),
    lat: z.number(),
    lng: z.number(),
    storeysHint: z.number().nullable().optional(),
  }),
);

/**
 * Mirrors `SampleSelectionSnapshot` from `@/domain/sample-snapshot` — what
 * step 3's domain call persists in `inputs.sampleSelection` (ADR-015 "Dobor
 * proby v3"): the appraiser's proposed/alternate rows plus enough context
 * (flags, radius walk, counts, params) to show badges and re-run the choice.
 */
export const sampleSelectionSchema = z.object({
  version: z.literal(3),
  proposed: z.array(candidateSchema),
  alternates: z.array(candidateSchema),
  flags: z.record(
    z.string(),
    z.array(z.enum(["price_outlier", "market_unknown", "primary_suspect"])),
  ),
  rejectedCounts: z.record(z.string(), z.number()),
  /** Rows rejected by hygiene/band inside `radiusUsedM` (decision a). Optional: pre-Slice-3 snapshots lack it. */
  rejected: z.array(rejectedRowSchema).optional(),
  /** Appraiser's overlay (Slice 3). Optional for the same reason. */
  manualRejections: z.array(manualRejectionSchema).optional(),
  radiusUsedM: z.number(),
  radiusWalk: z.array(
    z.object({
      radiusM: z.number(),
      inRadius: z.number(),
      afterHygiene: z.number(),
      afterBand: z.number(),
    }),
  ),
  counts: z.object({
    pool: z.number(),
    inRadius: z.number(),
    afterHygiene: z.number(),
    afterBand: z.number(),
    proposed: z.number(),
  }),
  params: z.object({
    subjectArea: z.number(),
    todayMonth: z.string(),
    subjectEgib: z
      .object({
        obreb: z.string(),
        dzialka: z.string(),
        arkusz: z.string().optional(),
        budynek: z.string().optional(),
      })
      .optional(),
    radiusOverrideM: z.number().optional(),
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
  // GEOPOZ ID_BUDYNKU (ULDK parcel id as fallback) — feeds `subjectEgib` for
  // the sample-selection scoring (ADR-015 "same building" bonus).
  buildingId: z.string().nullable().optional(),
});

/** Mirrors `KwDzialSnapshot`/`KwSnapshot` from `@/domain/kw-snapshot` (Slice 6). */
export const kwDzialSchema = z.object({ wpisy: z.boolean(), tresc: z.array(z.string()) });

export const kwSchema = z.object({
  source: z.enum(["akt", "odpis_kw"]),
  kwLokalu: z.string().nullable(),
  kwGruntu: z.string().nullable(),
  kwInne: z.array(z.string()),
  deweloperski: z.boolean(),
  powUzytkowaKw: z.number().nullable(),
  udzial: z.string().nullable(),
  sad: z.string().nullable(),
  wydzial: z.string().nullable(),
  dataDokumentu: z.string().nullable(),
  dzial3: kwDzialSchema.nullable(),
  dzial4: kwDzialSchema.nullable(),
});

/** Mirrors `KwMetaSnapshot` from `@/domain/kw-snapshot`. */
export const kwMetaSchema = z.object({
  model: z.string(),
  extractedAt: z.string(),
  docTypeDetected: z.enum(["akt", "odpis_kw"]),
  docTypeDeclared: z.enum(["akt", "odpis_kw"]),
});

/**
 * The plain object schema, exported separately because zod 4's `.pick()`
 * throws at runtime on a schema carrying refinements (verified empirically) —
 * `.superRefine()` below adds one. Call sites that need `.pick()` (e.g.
 * `get-subject-data.ts`, `get-sample-proposal.ts`) must import this instead
 * of `valuationFormSchema`. `.shape` access still works on the refined
 * schema, so existing `valuationFormSchema.shape.*` usages are unaffected.
 */
export const valuationFormObject = z.object({
  address: z.string().trim().min(1, "Podaj adres nieruchomości."),
  area: z.coerce.number().positive("Powierzchnia musi być większa od zera."),
  comparables: z.array(comparableSchema).min(3, "Podaj co najmniej 3 transakcje porównawcze."),
  features: z
    .array(featureSchema)
    .min(1, "Podaj co najmniej jedną cechę.")
    .refine(
      (features) => Math.abs(features.reduce((sum, f) => sum + f.weightPct, 0) - 100) <= 0.1,
      "Suma wag musi wynosić 100%.",
    )
    .refine(
      (features) => new Set(features.map((f) => f.key)).size === features.length,
      "Każda cecha może wystąpić najwyżej raz.",
    ),
  sampleMeta: sampleMetaSchema.optional(),
  sampleSelection: sampleSelectionSchema.optional(),
  streetView: streetViewSchema.optional(),
  subject: subjectSchema.optional(),
  subjectMeta: subjectMetaSchema.optional(),
  kw: kwSchema.optional(),
  kwMeta: kwMetaSchema.optional(),
  purpose: z.enum(["sprzedaz", "zabezpieczenie_kredytu", "informacyjny"], {
    message: "Wybierz cel wyceny.",
  }),
  kwNumber: z.string().trim().optional(),
  client: z.string().trim().min(1, "Podaj zamawiającego wycenę."),
  inspectionDate: z.string().min(1, "Podaj datę oględzin."),
});

/**
 * kwNumber is required only on the manual path (no `kw` extract attached) —
 * a document-sourced `kw` snapshot carries its own KW numbers
 * (`kwLokalu`/`kwGruntu`), so the flat field becomes optional once an
 * extract is present (Slice 6).
 */
export const valuationFormSchema = valuationFormObject.superRefine((values, ctx) => {
  if (!values.kw && !values.kwNumber) {
    ctx.addIssue({
      code: "custom",
      path: ["kwNumber"],
      message: "Podaj numer księgi wieczystej.",
    });
  }
});

export type ValuationFormValues = z.infer<typeof valuationFormSchema>;

/** Default feature bag for a lokal — derived from the domain preset (F-6, ADR-006). */
export const DEFAULT_FEATURES: ValuationFormValues["features"] = defaultFeatureFormValues();
