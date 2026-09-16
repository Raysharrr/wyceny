import { z } from "zod";
import { COMPARABLE_SOURCES, POOL_SOURCES } from "@/domain/kcs";
import { kwRequirements } from "@/domain/kw-requirements";
import { ksiegaTrescSchema } from "@/domain/kw-tresc";
import { PROPERTY_RIGHTS } from "@/domain/property-right";
import { LOKAL_FEATURE_KEYS, defaultFeatureFormValues } from "@/domain/feature-presets";
import { definitionsFromMeasure, featureIssues, measureIssues } from "@/domain/feature-rules";
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
  source: z.enum(COMPARABLE_SOURCES).optional(),
  transactionId: z.string().optional(),
  // One notarial act (transactionId) can carry several lokale — this
  // distinguishes them (mirrors Candidate.lokalId/candidateKey in
  // domain/sample-selection.ts). Optional: older drafts saved before this
  // field existed keep validating exactly as before.
  lokalId: z.string().optional(),
  // coop_transaction.id for rows from the cooperative register (S2a) —
  // without it the first step-3 save of a coop valuation would fail here.
  coopTxId: z.string().optional(),
});

export const featureDefinitionsSchema = z.object({
  lepsza: z.string().optional(),
  przecietna: z.string().optional(),
  gorsza: z.string().optional(),
});

/**
 * Mirrors `MeasureBound` from `@/domain/kcs` — an absent edge is unbounded, and
 * an edge that IS there is a whole number: the operats write these bands in
 * whole piętra and whole m², and the touching rule (`prev.do + 1 === next.od`)
 * is only meaningful on integers.
 *
 * Plain `z.number()`, not `z.coerce`: the threshold inputs already hand over a
 * number, and coercion would type the form's own value as `unknown`.
 */
const measureBoundSchema = z.object({
  od: z.number().int("Próg podaj liczbą całkowitą.").optional(),
  do: z.number().int("Próg podaj liczbą całkowitą.").optional(),
});

/**
 * Mirrors `FeatureMeasure` from `@/domain/kcs` (FH.1). `.nullish()`, not
 * `.optional()`: retyping a definition by hand RETRACTS the thresholds, and
 * `setValue(…, undefined)` is not a reliable clear in RHF — the form has to be
 * able to say "there are no thresholds" with a value.
 */
export const featureMeasureSchema = z.object({
  kind: z.enum(["floor", "area"]),
  bounds: z.object({
    lepsza: measureBoundSchema.optional(),
    przecietna: measureBoundSchema.optional(),
    gorsza: measureBoundSchema.optional(),
  }),
});

export const featureSchema = z
  .object({
    // Closed pool (F-6): a custom feature is added by a commit to the preset,
    // never free-typed (brainstorm decision 2).
    key: z.enum(LOKAL_FEATURE_KEYS, { message: "Nieznana cecha — wybierz z puli." }),
    name: z.string().trim().min(1, "Podaj nazwę cechy."),
    weightPct: z.coerce.number().min(0, "Waga nie może być ujemna."),
    // ADR-016 reg. 3: no default rating — null until the appraiser picks a level.
    rating: z.enum(["gorsza", "przecietna", "lepsza"]).nullable(),
    definitions: featureDefinitionsSchema.optional(),
    measure: featureMeasureSchema.nullish(),
  })
  // FH.1 (D-46, D-48): thresholds with a gap or an overlap are not a scale —
  // the 14.09 operat shipped both. Saved thresholds also have to BE the texts,
  // so the operat's §12.1 block and the suggestion can never disagree.
  .superRefine((feature, ctx) => {
    if (!feature.measure) return;
    for (const message of measureIssues(feature.measure)) {
      ctx.addIssue({ code: "custom", path: ["measure"], message });
    }
    const generated = definitionsFromMeasure(feature.measure);
    const matches = (["lepsza", "przecietna", "gorsza"] as const).every(
      (level) => (feature.definitions?.[level] ?? "") === (generated[level] ?? ""),
    );
    if (!matches) {
      ctx.addIssue({
        code: "custom",
        path: ["measure"],
        message: "Opisy poziomów nie odpowiadają progom liczbowym.",
      });
    }
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
/** Mirrors `StreetIndexState` from `@/ports/sample` (Slice 3d). Optional: pools cached
 *  before this slice have no such field and must keep parsing — old is not corrupt. */
export const streetIndexStateSchema = z.object({
  status: z.enum(["ready", "building", "unavailable"]),
  cutoff: z.string().nullable(),
  generatedAt: z.string().nullable(),
});

export const sampleMetaSchema = z.object({
  point: poolPointSchema,
  maxRadiusM: z.number(),
  counts: poolCountsSchema,
  fetchedAt: z.string(),
  // Two pool sources since S1 of the "Prawo spółdzielcze" block: RCN via the
  // worker, or the office coop registry. Hyphenated on purpose (this enum keeps
  // the `rcn-wfs-gugik` convention; `Comparable.source` keeps `rcn`/`rejestr_sm`).
  source: z.enum(POOL_SOURCES),
  importedAt: z.string().nullable().optional(),
  query: poolQuerySchema,
  streetIndex: streetIndexStateSchema.optional(),
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
  // B3 — address-derived building key for rows without EGiB (coop registry).
  // `.optional()`: RCN rows and pools frozen before S1 do not carry it.
  buildingRef: z.string().nullable().optional(),
  distanceM: z.number(),
  floor: z.number().nullable(),
  rooms: z.number().nullable(),
  market: z.enum(["wtorny", "pierwotny"]).nullable(),
  // S3 — nullable like function/transType: the coop registry has no share column.
  share: z.string().nullable(),
  // B4 — nullable: the coop registry has neither field; RCN always fills them.
  transType: z.string().nullable(),
  function: z.string().nullable(),
  seller: z.string().nullable(),
  pos: z.object({ x: z.number(), y: z.number() }).nullable(),
  // Slice 3d — adres z eksportu GEOPOZ. `.optional()`, bo kandydatki zamrożone przed
  // tym slice'em (migawki wycen, cache pul, snapshoty F-14) tych pól nie mają.
  street: z.string().nullable().optional(),
  streetNumber: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  // S3 — coop register rows only; absent on RCN rows and older pools.
  rightType: z.enum(PROPERTY_RIGHTS).nullable().optional(),
  cooperative: z.string().optional(),
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
  "manual_area_range",
  "manual_price_range",
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

/** Mirrors `ManualInclusion` from `@/domain/sample-manual` — the appraiser's manual inclusion overlay (Slice 3c); carries the full candidate so it survives a radius change. */
export const manualInclusionSchema = z.object({
  transactionId: z.string(),
  lokalId: z.string(),
  at: z.string(),
  candidate: candidateSchema,
});

/** Mirrors `ReviewedMark` from `@/domain/sample-manual` — review trail, informational only (Slice 3c). */
export const reviewedMarkSchema = z.object({
  transactionId: z.string(),
  lokalId: z.string(),
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
 * Appraiser's own selection band (Slice 6) — powierzchnia [m²] lub cena [zł/m²].
 * Obie granice opcjonalne (pusta = brak ograniczenia z tej strony), ale to jest
 * granica zaufania: wartości przychodzą z formularza i lecą prosto do domeny,
 * więc odwrócone albo ujemne pasmo odrzucamy tutaj, a nie w `selectSample`.
 */
export const manualRangeSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, {
    message: "Dolna granica nie może być większa od górnej",
  });

/**
 * Mirrors `SampleSelectionSnapshot` from `@/domain/sample-snapshot` — what
 * step 3's domain call persists in `inputs.sampleSelection` (ADR-015 "Dobor
 * proby v3"): the appraiser's proposed/alternate rows plus enough context
 * (flags, radius walk, counts, params) to show badges and re-run the choice.
 */
export const sampleSelectionSchema = z.object({
  version: z.literal(3),
  /** Statistics of the collected set for §11 (M-12). Listed here or zod strips it on every step-3 save. */
  poolStats: z
    .object({
      areaMin: z.number(),
      areaMax: z.number(),
      unitPriceMin: z.number(),
      unitPriceMax: z.number(),
      unitPriceMean: z.number(),
      totalMin: z.number(),
      totalMax: z.number(),
      totalMean: z.number(),
      excluded: z.object({ shares: z.boolean(), area: z.boolean(), price: z.boolean() }),
    })
    .optional(),
  proposed: z.array(candidateSchema),
  alternates: z.array(candidateSchema),
  flags: z.record(
    z.string(),
    z.array(
      z.enum([
        "price_outlier",
        "market_unknown",
        "primary_suspect",
        "attributes_unknown",
        "prawo_nieznane",
      ]),
    ),
  ),
  rejectedCounts: z.record(z.string(), z.number()),
  /** Rows rejected by hygiene/band inside `radiusUsedM` (decision a). Optional: pre-Slice-3 snapshots lack it. */
  rejected: z.array(rejectedRowSchema).optional(),
  /** Appraiser's overlay (Slice 3). Optional for the same reason. */
  manualRejections: z.array(manualRejectionSchema).optional(),
  /** Appraiser's explicit additions (Slice 3c). Optional: pre-Slice-3c snapshots lack it. */
  manualInclusions: z.array(manualInclusionSchema).optional(),
  /** Review trail (Slice 3c). Optional: pre-Slice-3c snapshots lack it. */
  reviewed: z.array(reviewedMarkSchema).optional(),
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
    /** Ręczne pasma rzeczoznawcy (Slice 6). Addytywne — stare szkice ich nie mają. */
    areaRange: manualRangeSchema.optional(),
    unitPriceRange: manualRangeSchema.optional(),
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
  // FH.2 — piętro lokalu, parter = 0. Podziemia nie są piętrem lokalu
  // mieszkalnego, więc dolna granica to parter.
  pietro: z.coerce
    .number()
    .int("Piętro podaj liczbą całkowitą.")
    .min(0, "Piętro nie może być ujemne — parter to 0.")
    .max(100, "Piętro wygląda na błędne.")
    .nullish(),
  // M-10 / D-34 — the designation source, nullish so a pre-M-10 draft still
  // parses and opens; B-02 is what refuses to approve it unselected.
  przeznaczenieRodzaj: z.enum(["mpzp", "plan_ogolny", "studium"]).nullish(),
  przeznaczenieNazwa: z.string().optional(),
  przeznaczenieUchwala: z.string().optional(),
  przeznaczenieData: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Podaj datę w formacie RRRR-MM-DD."),
  przeznaczenieSymbol: z.string().optional(),
  przeznaczeniePublikator: z.string().optional(),
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

/** Mirrors `KwAkt` — dział II in three fields (ADR-018 reg. 1). */
export const kwAktSchema = z.object({
  rodzaj: z.string(),
  rep: z.string(),
  data: z.string(),
});

export const kwSchema = z.object({
  source: z.enum(["akt", "odpis_kw", "ekw_reczne"]),
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
  // Optional like the domain type: a snapshot saved before ADR-018 (and every
  // extract the worker emits today) must still parse — no data migration.
  dataBadania: z.string().nullish(),
  nrLokalu: z.string().nullish(),
  akt: kwAktSchema.nullish(),
  // The transcribed content of the five dzialy (b1-kw-read). Mirrors
  // `KwSnapshot["tresc"]`; the schema is the domain's own (`domain/kw-tresc`),
  // not a copy, so a drift in the worker's wire shape fails in ONE place.
  tresc: ksiegaTrescSchema.nullish(),
});

/** Mirrors `KwGruntSnapshot` — the grunt's book, manual-only in paczka 1. */
export const kwGruntSchema = z.object({
  source: z.literal("ekw_reczne"),
  nrKsiegi: z.string().nullable(),
  dataBadania: z.string().nullable(),
  dzial3: kwDzialSchema.nullable(),
  dzial4: kwDzialSchema.nullable(),
});

/** Mirrors `EncumbranceTreatment` — the appraiser's call on a dział III entry (ADR-018 reg. 6). */
export const encumbranceTreatmentSchema = z.object({
  wariant: z.enum(["bez_uwzglednienia", "z_uwzglednieniem"]).nullable(),
  podstawa: z.string(),
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
    )
    // I-10 (ADR-016 reg. 4): a rating the scale does not describe, or a weighted
    // feature with fewer than two described levels, is never saved. A missing
    // rating is saved and blocks approval instead (B-08).
    .superRefine((features, ctx) => {
      features.forEach((f, index) => {
        const weight = Number.isFinite(f.weightPct) ? f.weightPct : 0;
        for (const issue of featureIssues({ ...f, weight })) {
          if (issue.code === "B-08") continue;
          ctx.addIssue({ code: "custom", path: [index], message: issue.label });
        }
      });
    }),
  sampleMeta: sampleMetaSchema.optional(),
  sampleSelection: sampleSelectionSchema.optional(),
  streetView: streetViewSchema.optional(),
  subject: subjectSchema.optional(),
  subjectMeta: subjectMetaSchema.optional(),
  // `.nullish()`, not `.optional()`: retracting an examination is a real act —
  // unticking "zakup deweloperski", or switching the property right — and the
  // form has to be able to SAY "there is no snapshot" rather than merely omit
  // the key. `setValue(…, undefined)` is not a reliable clear in RHF, so the
  // retraction has to be a value, and a value the schema rejects would fail on
  // a path no field renders (the W4 dead-end). `wizard.ts` already writes
  // `parsed.kw ? normalizeKw(parsed.kw) : null`.
  kw: kwSchema.nullish(),
  kwGrunt: kwGruntSchema.nullish(),
  encumbranceTreatment: encumbranceTreatmentSchema.nullish(),
  // `.nullish()` for the same reason as the three above, and since `b1-kw-read`
  // for a sharper one: `retractExamination` now withdraws this too, and a
  // withdrawal has to be a VALUE the schema accepts. `.optional()` would have
  // made `setValue("kwMeta", null)` fail on a path no field renders — the W4
  // dead-end, with the save button silently refusing.
  kwMeta: kwMetaSchema.nullish(),
  purpose: z.enum(["sprzedaz", "zabezpieczenie_kredytu", "informacyjny"], {
    message: "Wybierz cel wyceny.",
  }),
  // T-12. The radio always submits a value; the defaults exist for callers that
  // predate the block (tests, e2e) and mean "the app as it was": własność, no basement.
  propertyRight: z.enum(PROPERTY_RIGHTS).default("wlasnosc_lokalu"),
  hasBasement: z.boolean().default(false),
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
  if (!values.kwNumber && kwRequirements(values.propertyRight, values.kw).numerKwWFormularzu) {
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
