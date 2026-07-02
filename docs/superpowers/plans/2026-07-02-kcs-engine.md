# KCS Engine (pure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WR stub (`create-valuation.ts:42`) with the real KCS comparative-approach engine as a pure domain module, with golden test F-1 asserting exactly **1 044 400 zł** for the Kościelna reference operat.

**Architecture:** `computeKcs()` lives in `apps/web/src/domain/kcs.ts` — zero I/O, protected by the existing dependency-cruiser rule (F-10). The form collects comparables + features, the Server Action validates (zod), computes WR, and persists both `wr` and the full `inputs` snapshot (jsonb) so every valuation is reproducible without network (F-3). The detail page recomputes the breakdown server-side from `inputs` with the same pure function.

**Tech Stack:** TypeScript (pure domain), zod 4, react-hook-form `useFieldArray`, Drizzle (jsonb column + migration), vitest, existing FastAPI worker (unchanged — already has the 1 044 400 golden case).

**Spec:** `docs/superpowers/specs/2026-07-02-kcs-engine-design.md`
**Prerequisite:** dev-infra foundations plan executed (`2026-07-02-dev-infra-foundations.md`) — lefthook/prettier/commitlint gates active, smoke E2E exists.

## Global Constraints

- Code/comments/commit messages **English**; UI copy **Polish** (full diacritics).
- **Operat rounding convention** (domain rule, verified empirically 2026-07-01 — do not "simplify"):
  `csr` → 2 dp; `vmin`/`vmax` → 3 dp; `sumUi` → 3 dp; `unitValue` → 2 dp; `wr` → nearest 100 zł. All **half-up** (JS `Math.round`, positive values only).
- Golden values (Kościelna): `csr = 13123.60`, `sumUi = 1.111`, `unitValue = 14580.32`, `wr = 1_044_400`.
- **Do NOT assert `vmin`/`vmax` in F-1** — engine yields `0.919` where the source PDF prints `0.920`; no effect on WR. Do not "fix" the engine to 0.920.
- The engine consumes weights as **fractions** (Σ = 1.0); the UI operates in **%** (Σ = 100) — conversion happens in the action layer.
- Framework APIs (Next 16 Server Actions, RHF `useFieldArray`, shadcn, Drizzle jsonb): verify against `context7`/vercel skills when in doubt — do not invent syntax.
- Every task ends green: `pnpm turbo lint typecheck test --env-mode=loose` + `pnpm depcruise` before each commit.

---

### Task 1: Pure engine + Kościelna fixture + F-1/F-2/F-3 tests

**Files:**

- Create: `apps/web/src/domain/kcs.ts`, `apps/web/tests/fixtures/koscielna.json`
- Rewrite: `apps/web/tests/golden-wr.test.ts` (replaces the stub-pipeline harness)

**Interfaces:**

- Produces: `computeKcs(input: KcsInput): KcsResult` and types `Comparable { date?: string; area?: number; pricePerM2: number }`, `FeatureRating = "gorsza" | "przecietna" | "lepsza"`, `Feature { name: string; weight: number; rating: FeatureRating }`, `KcsInput { comparables: Comparable[]; area: number; features: Feature[] }`, `KcsResult { csr, cmin, cmax, vmin, vmax, ui: FeatureShare[], sumUi, unitValue, wrUnrounded, wr }` with `FeatureShare = Feature & { value: number }`. Tasks 2-5 import these from `@/domain/kcs`.

- [ ] **Step 1: Create the fixture `apps/web/tests/fixtures/koscielna.json`**

Source of truth: reference operat Kościelna from the validated spike (wiki repo `tools/spike/2026-05-14-kcs/spike.py:33-52`; 5/5 reference operaty, error ≤0.16%). No PII (F-9-safe: months, areas, unit prices only).

```json
{
  "name": "Kościelna — reference operat (spike 2026-05-14)",
  "input": {
    "area": 71.63,
    "comparables": [
      { "date": "2024-07", "area": 63.27, "pricePerM2": 14698.91 },
      { "date": "2024-06", "area": 61.35, "pricePerM2": 12061.94 },
      { "date": "2024-04", "area": 76.41, "pricePerM2": 12629.24 },
      { "date": "2024-07", "area": 62.44, "pricePerM2": 12652.15 },
      { "date": "2024-10", "area": 61.62, "pricePerM2": 12788.06 },
      { "date": "2024-09", "area": 70.02, "pricePerM2": 14852.9 },
      { "date": "2025-02", "area": 61.51, "pricePerM2": 13168.59 },
      { "date": "2025-02", "area": 64.28, "pricePerM2": 14452.4 },
      { "date": "2025-06", "area": 71.65, "pricePerM2": 12281.93 },
      { "date": "2025-12", "area": 70.76, "pricePerM2": 13566.99 },
      { "date": "2025-11", "area": 62.15, "pricePerM2": 12228.48 },
      { "date": "2025-11", "area": 74.37, "pricePerM2": 12101.65 }
    ],
    "features": [
      { "name": "standard wykończenia", "weight": 0.4, "rating": "lepsza" },
      { "name": "położenie na piętrze", "weight": 0.3, "rating": "lepsza" },
      { "name": "powierzchnia", "weight": 0.1, "rating": "gorsza" },
      { "name": "pomieszczenia dodatkowe", "weight": 0.1, "rating": "lepsza" },
      { "name": "lokalizacja", "weight": 0.1, "rating": "lepsza" }
    ]
  },
  "expected": { "csr": 13123.6, "sumUi": 1.111, "unitValue": 14580.32, "wr": 1044400 }
}
```

- [ ] **Step 2: Write the failing tests — rewrite `apps/web/tests/golden-wr.test.ts`**

Replace the entire file (the stub-pipeline harness it pinned is retired by this slice; the worker words path stays covered by `worker-contract.test.ts` + worker pytest, which already has the `1044400 → "jeden milion czterdzieści cztery tysiące czterysta złotych zero groszy"` golden case in `apps/worker/tests/test_amount_in_words.py:29`):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";

// F-3 (reproducibility): the reference inputs live in a committed snapshot
// file — this test reads it from disk and must pass with no network and no DB.
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/koscielna.json", import.meta.url)), "utf8"),
) as {
  input: KcsInput;
  expected: { csr: number; sumUi: number; unitValue: number; wr: number };
};

describe("KCS engine — Kościelna reference operat", () => {
  // F-1: golden — the engine reproduces the reference operat TO THE ZŁOTY,
  // including the operat rounding convention (sumUi→3dp, unitValue→2dp,
  // wr→100 zł). Deliberately NOT asserting vmin/vmax (PDF prints 0.920,
  // engine yields 0.919 — no effect on WR).
  it("F-1: reproduces WR = 1 044 400 zł and the printed intermediates", () => {
    const result = computeKcs(fixture.input);
    expect(result.csr).toBe(fixture.expected.csr);
    expect(result.sumUi).toBe(fixture.expected.sumUi);
    expect(result.unitValue).toBe(fixture.expected.unitValue);
    expect(result.wr).toBe(fixture.expected.wr);
  });

  // F-2: determinism — same input, same output, every time. The engine has
  // no Date/random/I-O by construction; this pins it against regressions.
  it("F-2: is deterministic across repeated calls", () => {
    const a = computeKcs(fixture.input);
    const b = computeKcs(fixture.input);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  // F-2 supporting invariant: the engine must not mutate its input.
  it("F-2: does not mutate the input", () => {
    const snapshot = JSON.stringify(fixture.input);
    computeKcs(fixture.input);
    expect(JSON.stringify(fixture.input)).toBe(snapshot);
  });

  it("rejects degenerate inputs", () => {
    expect(() => computeKcs({ ...fixture.input, comparables: [] })).toThrow();
    expect(() => computeKcs({ ...fixture.input, area: 0 })).toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter web test -- golden-wr`
Expected: FAIL — `Cannot find module '../src/domain/kcs'` (or equivalent).

- [ ] **Step 4: Implement `apps/web/src/domain/kcs.ts`**

```ts
/**
 * KCS engine — comparative approach ("korygowanie ceny średniej"), the pure
 * core validated by the 2026-05-14 spike (5/5 reference operaty, error
 * ≤0.16%; wiki repo `tools/spike/2026-05-14-kcs/`).
 *
 * ZERO I/O, ZERO adapter imports (F-10). Deterministic by construction:
 * no Date, no randomness (F-2). Inputs come from the caller; persisted
 * snapshots make every result reproducible offline (F-3).
 *
 * OPERAT ROUNDING CONVENTION (domain rule — F-1 depends on it): the operat
 * document rounds intermediates as it prints them and keeps calculating on
 * the ROUNDED values. The engine mirrors the document, not pure arithmetic:
 * csr→2dp, vmin/vmax→3dp, sumUi→3dp, unitValue→2dp, wr→nearest 100 zł;
 * half-up everywhere (values are always positive here). Full-precision math
 * would yield 1 043 900 for Kościelna instead of the operat's 1 044 400.
 */

export type FeatureRating = "gorsza" | "przecietna" | "lepsza";

export type Comparable = {
  /** Transaction month, e.g. "2024-07" — display metadata only. */
  date?: string;
  /** Usable area in m² — display metadata only. */
  area?: number;
  /** Unit price in zł/m² — the only field the engine consumes. */
  pricePerM2: number;
};

export type Feature = {
  name: string;
  /** Weight as a fraction (Σ over features = 1.0). UI works in %, converts before calling. */
  weight: number;
  rating: FeatureRating;
};

export type KcsInput = {
  comparables: Comparable[];
  /** Usable area of the subject property, m². */
  area: number;
  features: Feature[];
};

export type FeatureShare = Feature & {
  /** Ui — the feature's contribution: weight·vmax (lepsza), weight·vmin (gorsza), weight (przecietna). */
  value: number;
};

export type KcsResult = {
  csr: number;
  cmin: number;
  cmax: number;
  vmin: number;
  vmax: number;
  ui: FeatureShare[];
  sumUi: number;
  unitValue: number;
  wrUnrounded: number;
  /** Market value, rounded to full 100 zł — the operat's headline number. */
  wr: number;
};

/** Half-up decimal rounding (positive inputs only in this domain). */
const roundTo = (value: number, dp: number): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

export function computeKcs(input: KcsInput): KcsResult {
  if (input.comparables.length === 0) {
    throw new Error("KCS engine: at least one comparable transaction is required");
  }
  if (!(input.area > 0)) {
    throw new Error("KCS engine: subject area must be > 0");
  }
  const prices = input.comparables.map((c) => {
    if (!(c.pricePerM2 > 0)) {
      throw new Error("KCS engine: every comparable price must be > 0");
    }
    return c.pricePerM2;
  });

  const cmin = Math.min(...prices);
  const cmax = Math.max(...prices);
  const csr = roundTo(prices.reduce((sum, p) => sum + p, 0) / prices.length, 2);
  const vmin = roundTo(cmin / csr, 3);
  const vmax = roundTo(cmax / csr, 3);

  const ui: FeatureShare[] = input.features.map((f) => ({
    ...f,
    value:
      f.rating === "lepsza" ? f.weight * vmax : f.rating === "gorsza" ? f.weight * vmin : f.weight,
  }));
  const sumUi = roundTo(
    ui.reduce((sum, share) => sum + share.value, 0),
    3,
  );

  const unitValue = roundTo(csr * sumUi, 2);
  const wrUnrounded = roundTo(unitValue * input.area, 2);
  const wr = Math.round(wrUnrounded / 100) * 100;

  return { csr, cmin, cmax, vmin, vmax, ui, sumUi, unitValue, wrUnrounded, wr };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test -- golden-wr`
Expected: PASS (4 tests). Also run: `pnpm depcruise` — expected: PASS (pure domain, no adapter imports).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/domain/kcs.ts apps/web/tests/fixtures/koscielna.json apps/web/tests/golden-wr.test.ts
git commit -m "feat: KCS engine with operat rounding convention and F-1/F-2/F-3 golden tests"
```

---

### Task 2: Rename `stubWr`→`wr` in code + persist `inputs` snapshot (jsonb)

**Files:**

- Modify: `apps/web/src/db/schema.ts`, `apps/web/src/ports/valuation.ts`, `apps/web/src/domain/valuation.ts`, `apps/web/src/app/actions/create-valuation.ts`, `apps/web/src/app/valuations/page.tsx`, `apps/web/src/app/valuations/[id]/page.tsx`, `apps/web/tests/valuation-repo.test.ts`, `apps/web/tests/rls-isolation.test.ts`, `apps/web/tests/docs-route.test.ts`
- Create: one generated Drizzle migration (via `drizzle-kit generate`)
- Check-only: `apps/web/src/adapters/` (the drizzle adapter maps rows generically; `pnpm --filter web typecheck` will reveal if it needs a touch)

**Interfaces:**

- Consumes: `KcsInput` type from Task 1 (`@/domain/kcs`).
- Produces: `Valuation.wr: number`, `Valuation.inputs: KcsInput | null`, `NewValuationInput.wr: number`, `NewValuationInput.inputs: KcsInput | null`. DB column `inputs jsonb` (nullable — legacy stub-era rows stay `NULL`, no backfill). Tasks 3-5 rely on these names.

> **Deliberate deviation from the spec (flagged at plan review):** the TS field is renamed
> `stubWr`→`wr`, but the physical column keeps the name `stub_wr` via
> `doublePrecision("stub_wr")`. A physical `RENAME COLUMN` requires `drizzle-kit generate`'s
> interactive rename prompt, which subagents can't answer reliably; adding only the `inputs`
> column keeps `generate` fully non-interactive. The physical rename rides along with the next
> schema-reshaping slice. `// ponytail:` comment marks it in schema.ts.

- [ ] **Step 1: Write the failing test — extend `apps/web/tests/valuation-repo.test.ts`**

In the existing describe block add (mirror the style of neighboring tests — they create via `valuationRepository.create` against the real test DB):

```ts
it("persists and returns the KCS inputs snapshot (F-3 at the app level)", async () => {
  const created = await repo.create({
    address: "ul. Kościelna 33A, Poznań",
    area: 71.63,
    wr: 1_044_400,
    inputs: {
      area: 71.63,
      comparables: [{ date: "2024-07", area: 63.27, pricePerM2: 14698.91 }],
      features: [{ name: "standard wykończenia", weight: 1, rating: "lepsza" }],
    },
    amountInWords: null,
    docUrl: null,
    ownerId: ownerA.id, // reuse the test's existing seeded owner variable name
  });
  const fetched = await repo.get(created.id, adminUser); // reuse the test's existing admin session variable
  expect(fetched?.wr).toBe(1_044_400);
  expect(fetched?.inputs?.comparables[0]?.pricePerM2).toBe(14698.91);
});
```

(Adjust the two `reuse` identifiers to the actual variable names in the file — the implementer reads the file first.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- valuation-repo`
Expected: FAIL — type errors (`wr`/`inputs` don't exist yet).

- [ ] **Step 3: Update the schema — `apps/web/src/db/schema.ts`**

Replace the `stubWr` line and add `inputs` (also extend the pg-core import with `jsonb`):

```ts
import { doublePrecision, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
```

```ts
  // ponytail: TS field renamed stubWr→wr, physical column stays "stub_wr" —
  // a real RENAME needs drizzle-kit's interactive prompt; rename rides along
  // with the next schema-reshaping migration.
  wr: doublePrecision("stub_wr").notNull(),
  // Full KcsInput snapshot for reproducibility (F-3). NULL = stub-era row.
  inputs: jsonb("inputs"),
```

- [ ] **Step 4: Update ports — `apps/web/src/ports/valuation.ts`**

Add a type-only import at the top (stays pure — type imports only):

```ts
import type { KcsInput } from "../domain/kcs";
```

In `Valuation`: replace `stubWr: number;` with `wr: number;` and add `inputs: KcsInput | null;`.
In `NewValuationInput`: replace `stubWr: number;` with `wr: number;` and add `inputs: KcsInput | null;`.

- [ ] **Step 5: Update domain — `apps/web/src/domain/valuation.ts`**

In `newValuation`, replace `stubWr: input.stubWr,` with:

```ts
    wr: input.wr,
    inputs: input.inputs,
```

- [ ] **Step 6: Mechanical rename at the remaining call sites**

- `create-valuation.ts`: rename the local `const stubWr = ...` to `const wr = ...` (KEEP the stub formula — Task 4 swaps it for the engine) and pass `wr, inputs: null` to `valuationRepository.create`.
- `valuations/page.tsx` and `valuations/[id]/page.tsx`: `valuation.stubWr` → `valuation.wr`.
- `tests/rls-isolation.test.ts`, `tests/docs-route.test.ts`: `stubWr:` in fixtures → `wr:` + `inputs: null`.
- Run `pnpm --filter web typecheck` — if the drizzle adapter (`src/adapters/`) maps fields explicitly, rename there too.

- [ ] **Step 7: Generate the migration (non-interactive — pure column addition)**

```bash
cd apps/web && pnpm exec drizzle-kit generate
```

Expected: a new migration file in `src/db/migrations/` containing only `ALTER TABLE "valuation" ADD COLUMN "inputs" jsonb;` — NO prompt (nothing was physically renamed). Then apply locally:

```bash
pnpm exec drizzle-kit migrate
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm turbo lint typecheck test --env-mode=loose && pnpm depcruise`
Expected: PASS (including the new repo test from Step 1).

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat: rename stubWr to wr and persist KCS inputs snapshot (jsonb)"
```

---

### Task 3: Validation schema + form sections (Próba + Cechy) — still stub-powered

**Files:**

- Create: `apps/web/src/lib/valuation-form-schema.ts`, `apps/web/tests/valuation-form-schema.test.ts`
- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx`, `apps/web/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `FeatureRating` from `@/domain/kcs`.
- Produces: `valuationFormSchema` (zod) + `ValuationFormValues` — Task 4's action validates with the SAME schema. Form field ids for E2E: `#address`, `#area`, `#comparable-date-{i}`, `#comparable-area-{i}`, `#comparable-price-{i}`, `#feature-weight-{i}`, rating buttons `aria-label="{feature name}: {gorsza|przeciętna|lepsza}"`. Buttons: `Dodaj transakcję`, `Usuń` (per row), submit `Utwórz wycenę`.
- **Behavior note:** after this task the form COLLECTS comparables/features and sends them, but the action still computes the stub (extra fields are accepted structurally and ignored). Every commit stays green; the engine swap is Task 4.

- [ ] **Step 1: Write failing schema tests — `apps/web/tests/valuation-form-schema.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { valuationFormSchema } from "../src/lib/valuation-form-schema";

const valid = {
  address: "ul. Kościelna 33A, Poznań",
  area: 71.63,
  comparables: [
    { date: "2024-07", area: 63.27, pricePerM2: 14698.91 },
    { date: "2024-06", area: 61.35, pricePerM2: 12061.94 },
    { date: "2024-04", area: 76.41, pricePerM2: 12629.24 },
  ],
  features: [
    { name: "standard wykończenia", weightPct: 40, rating: "lepsza" },
    { name: "położenie na piętrze", weightPct: 30, rating: "lepsza" },
    { name: "lokalizacja", weightPct: 10, rating: "przecietna" },
    { name: "powierzchnia użytkowa", weightPct: 10, rating: "gorsza" },
    { name: "pomieszczenia przynależne", weightPct: 4, rating: "przecietna" },
    { name: "dodatkowe", weightPct: 6, rating: "przecietna" },
  ],
};

describe("valuationFormSchema", () => {
  it("accepts a valid payload", () => {
    expect(valuationFormSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects fewer than 3 comparables", () => {
    const r = valuationFormSchema.safeParse({
      ...valid,
      comparables: valid.comparables.slice(0, 2),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-positive price", () => {
    const r = valuationFormSchema.safeParse({
      ...valid,
      comparables: [...valid.comparables.slice(0, 2), { pricePerM2: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects weights that do not sum to 100%", () => {
    const features = valid.features.map((f, i) => (i === 0 ? { ...f, weightPct: 50 } : f));
    expect(valuationFormSchema.safeParse({ ...valid, features }).success).toBe(false);
  });

  it("accepts weights within the ±0.1 p.p. tolerance", () => {
    const features = valid.features.map((f, i) => (i === 0 ? { ...f, weightPct: 40.05 } : f));
    expect(valuationFormSchema.safeParse({ ...valid, features }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- valuation-form-schema`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/web/src/lib/valuation-form-schema.ts`**

```ts
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
```

- [ ] **Step 4: Run schema tests — expect PASS**

Run: `pnpm --filter web test -- valuation-form-schema`
Expected: PASS (5 tests).

- [ ] **Step 5: Rebuild the form — `apps/web/src/app/valuations/new/new-valuation-form.tsx`**

Keep the existing component conventions (Controller + Field/FieldLabel/FieldError, `zodResolver`, `submitError` state, Polish copy). Structural changes:

- Resolver: `zodResolver(valuationFormSchema)`; defaults: `{ address: "", area: "", comparables: [emptyRow, emptyRow, emptyRow], features: DEFAULT_FEATURES }` where `emptyRow = { date: "", area: "", pricePerM2: "" }` (strings — `z.coerce` handles conversion).
- Two `useFieldArray` instances: `comparables`, `features`.
- **Sekcja „Próba porównawcza"** (mirrors mockup step 3, manual entry): one row per comparable — inputs `#comparable-date-{index}` (placeholder `2024-07`), `#comparable-area-{index}` (`m²`), `#comparable-price-{index}` (`zł/m²`, `inputMode="decimal"`), `Usuń` button per row (disabled when only 3 rows remain), `Dodaj transakcję` button appending an empty row.
- Live stats line under the table (client-side `watch("comparables")`): `Cmin / Cmax / Cśr` of the valid numeric prices, formatted `pl-PL` — mirrors the mockup's "Statystyki próby" panel.
- **Sekcja „Cechy i wagi"** (mirrors mockup step 4, reduced): one row per feature — feature name as plain text (not editable in this slice), weight input `#feature-weight-{index}` (`%`), rating as three toggle buttons (`gorsza` / `przeciętna` / `lepsza`) — plain shadcn `Button` with `variant={selected ? "default" : "outline"}` wired to a hidden RHF field via `setValue`; each button gets `aria-label="{feature.name}: {label}"` for E2E targeting. Amber warning line when weights don't sum to 100 (`watch("features")`).
- Submit calls `createValuation(values)` unchanged — the action accepts the extra fields structurally and (until Task 4) ignores them.
- UI copy Polish with diacritics; note `przecietna` is the internal enum value while the visible label is `przeciętna`.

- [ ] **Step 6: Update the smoke E2E — `apps/web/e2e/smoke.spec.ts`**

The form now requires ≥3 comparables. Extend the creation section (between filling `#area` and clicking `Utwórz wycenę`):

```ts
const prices = ["12000", "13000", "14000"];
for (const [i, price] of prices.entries()) {
  await page.locator(`#comparable-price-${i}`).fill(price);
}
```

(Default features already sum to 100% — no interaction needed.)

- [ ] **Step 7: Full local check**

Run: `pnpm turbo lint typecheck test --env-mode=loose && pnpm depcruise`
Expected: PASS.
Run (with local stack up, as in the foundations plan Task 5 Step 5): `pnpm --filter web e2e`
Expected: `1 passed`.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat: valuation form collects comparables and features with shared zod schema"
```

---

### Task 4: Swap the stub for the engine in the Server Action

**Files:**

- Modify: `apps/web/src/app/actions/create-valuation.ts`
- Create: `apps/web/tests/kcs-reproducibility.test.ts`

**Interfaces:**

- Consumes: `computeKcs`, `KcsInput` (Task 1); `valuationFormSchema`, `ValuationFormValues` (Task 3); `wr`/`inputs` repo fields (Task 2).
- Produces: `createValuation(input: ValuationFormValues)` — validates with the shared schema, computes the engine, persists `wr` + `inputs`. The stub formula is GONE.

- [ ] **Step 1: Write the failing integration test — `apps/web/tests/kcs-reproducibility.test.ts`**

App-level F-3: what the repo stores is enough to recompute the identical WR offline. Follow the setup style of `valuation-repo.test.ts` (real test DB, `migrate()` in `beforeAll`, seeded owner):

```ts
// Style/setup mirrors valuation-repo.test.ts — real DB, no network.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/koscielna.json", import.meta.url)), "utf8"),
) as { input: KcsInput };

describe("F-3: stored inputs snapshot reproduces the stored WR", () => {
  it("create → read inputs → recompute === stored wr", async () => {
    const wr = computeKcs(fixture.input).wr;
    const created = await repo.create({
      address: "ul. Kościelna 33A, Poznań",
      area: fixture.input.area,
      wr,
      inputs: fixture.input,
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    const fetched = await repo.get(created.id, adminUser);
    expect(fetched?.inputs).toBeTruthy();
    expect(computeKcs(fetched!.inputs!).wr).toBe(fetched!.wr);
    expect(fetched!.wr).toBe(1_044_400);
  });
});
```

(`repo`, `owner`, `adminUser` per the beforeAll pattern copied from `valuation-repo.test.ts` — implementer reads that file and mirrors its setup verbatim.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- kcs-reproducibility`
Expected: FAIL (or errors) until the test setup compiles; the point of RED here is pinning the recompute contract before touching the action.

- [ ] **Step 3: Rewrite the action core — `apps/web/src/app/actions/create-valuation.ts`**

Replace the manual `address`/`area` checks and the stub block (lines 8-42) with schema validation + engine:

```ts
import { valuationFormSchema, type ValuationFormValues } from "@/lib/valuation-form-schema";
import { computeKcs, type KcsInput } from "@/domain/kcs";

export type CreateValuationInput = ValuationFormValues;

export async function createValuation(input: CreateValuationInput): Promise<CreateValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Authoritative validation — same schema as the client resolver.
  const parsed = valuationFormSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza." };
  }
  const { address, area, comparables, features } = parsed.data;

  // % → fractions at the action boundary; the engine works in fractions.
  const kcsInput: KcsInput = {
    area,
    comparables,
    features: features.map((f) => ({ name: f.name, weight: f.weightPct / 100, rating: f.rating })),
  };
  const { wr } = computeKcs(kcsInput);
```

Downstream unchanged except: `worker.amountInWords(wr)`, doc text drops the `(stub)` marker:

```ts
const doc = `Operat\nAdres: ${address}\nPowierzchnia: ${area} m²\nWR: ${wr}\nSłownie: ${amountInWords}`;
```

and persistence:

```ts
const created = await valuationRepository.create({
  address,
  area,
  wr,
  inputs: kcsInput,
  amountInWords,
  docUrl,
  ownerId: session.user.id,
});
```

Also update the detail page's document button label (`valuations/[id]/page.tsx:99`): `Otwórz dokument operatu (stub)` → `Otwórz dokument operatu`.

- [ ] **Step 4: Run everything**

Run: `pnpm turbo lint typecheck test --env-mode=loose && pnpm depcruise`
Expected: PASS — including `kcs-reproducibility` and the untouched golden tests.
Run (local stack up): `pnpm --filter web e2e`
Expected: `1 passed` — the smoke path now exercises the REAL engine.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: server action computes WR with the KCS engine and persists the inputs snapshot"
```

---

### Task 5: Detail page — operat calculation breakdown (T2/T3/T4)

**Files:**

- Modify: `apps/web/src/app/valuations/[id]/page.tsx`, `apps/web/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `computeKcs`, `Valuation.inputs` (null for legacy rows).
- Produces: a „Rozbicie obliczeń" card on the detail page — the mockup step-5 "zero black box" tables, server-rendered (RSC, no `"use client"`).

- [ ] **Step 1: Extend the page**

After the existing summary `Card`, when `valuation.inputs` is non-null, recompute and render (all RSC — pure function call on the server):

```tsx
{
  valuation.inputs ? <KcsBreakdown inputs={valuation.inputs} /> : null;
}
```

with a co-located server component in the same file:

```tsx
import { computeKcs, type KcsInput } from "@/domain/kcs";

const plnPerM2 = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const RATING_LABEL: Record<string, string> = {
  gorsza: "gorsza",
  przecietna: "przeciętna",
  lepsza: "lepsza",
};

function KcsBreakdown({ inputs }: { inputs: KcsInput }) {
  const r = computeKcs(inputs);
  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        {/* T2 — ceny jednostkowe */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Ceny jednostkowe próby (T2)</h2>
          <dl className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-muted-foreground">Cmin</dt>
              <dd>{plnPerM2.format(r.cmin)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cmax</dt>
              <dd>{plnPerM2.format(r.cmax)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cśr</dt>
              <dd>{plnPerM2.format(r.csr)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vmin</dt>
              <dd>{r.vmin.toFixed(3)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vmax</dt>
              <dd>{r.vmax.toFixed(3)}</dd>
            </div>
          </dl>
        </section>
        {/* T3 — współczynniki korygujące */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Współczynniki korygujące (T3)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Cecha</th>
                <th className="py-1 font-medium">Waga</th>
                <th className="py-1 font-medium">Ocena</th>
                <th className="py-1 text-right font-medium">Ui</th>
              </tr>
            </thead>
            <tbody>
              {r.ui.map((u) => (
                <tr key={u.name} className="border-t border-border">
                  <td className="py-1">{u.name}</td>
                  <td className="py-1">{Math.round(u.weight * 100)}%</td>
                  <td className="py-1">{RATING_LABEL[u.rating]}</td>
                  <td className="py-1 text-right tabular-nums">{u.value.toFixed(4)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="py-1" colSpan={3}>
                  Suma współczynników (ΣUi)
                </td>
                <td className="py-1 text-right tabular-nums">{r.sumUi.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        {/* T4 — wartość rynkowa */}
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="text-sm font-semibold text-foreground">Wartość rynkowa (T4)</h2>
          <p className="text-muted-foreground">
            WR = Cśr × ΣUi × P = {plnPerM2.format(r.unitValue)}/m² × {inputs.area} m²
          </p>
          <p className="font-medium text-foreground">
            {plnPerM2.format(r.wrUnrounded)} → po zaokrągleniu{" "}
            <span className="text-primary">{plnPerM2.format(r.wr)}</span>
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
```

(Exact class names may be adapted to the file's existing style; keep it RSC — importing `computeKcs` here is app-layer consuming domain, F-10-legal.)

- [ ] **Step 2: Extend the smoke assertion — `apps/web/e2e/smoke.spec.ts`**

After the existing WR-visible assertions add:

```ts
await expect(page.getByText("Suma współczynników (ΣUi)")).toBeVisible();
```

- [ ] **Step 3: Full check**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: PASS. With local stack: `pnpm --filter web e2e` → `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: detail page renders the operat calculation breakdown from the inputs snapshot"
```

---

### Task 6: Deploy + live verification (S5 — human-gated)

**Files:** none (operational task)

⛔ **CHECKPOINTS: confirm with the user before every secret-bearing step below.**

- [ ] **Step 1: Push + CI green**

```bash
git push origin main
gh run watch --exit-status
```

Expected: `ci` and `e2e` jobs green.

- [ ] **Step 2 (⛔ user checkpoint): apply the migration to the production DB (Railway Postgres)**

Same pattern as Slice 0: run `drizzle-kit migrate` against the production `DATABASE_URL` (obtained via Railway MCP / user-provided env — NEVER committed). Expected output: one migration applied (`ADD COLUMN inputs jsonb`).

- [ ] **Step 3 (⛔ user checkpoint): deploy web to production**

Git-driven CD is still not wired (OAuth grants pending on the user side) — deploy directly as in Slice 0: `vercel --prod` from `apps/web` (confirm the account is the `raysharrr` one before running). Worker unchanged — no Railway deploy needed.

- [ ] **Step 4: Live E2E — the golden moment**

On https://wyceny-mu.vercel.app: log in, create a valuation with the full Kościelna dataset — address `ul. Kościelna 33A, Poznań`, area `71.63`, the 12 comparables from the fixture, and the 6 default feature rows set so they reproduce the fixture's 5 weighted features (the engine only reads weight+rating; names are labels):

| Row (UI)                                                                                                                                                                                                          | Waga | Ocena      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| standard wykończenia                                                                                                                                                                                              | 40   | lepsza     |
| położenie na piętrze                                                                                                                                                                                              | 30   | lepsza     |
| lokalizacja                                                                                                                                                                                                       | 10   | lepsza     |
| powierzchnia użytkowa                                                                                                                                                                                             | 10   | gorsza     |
| pomieszczenia przynależne                                                                                                                                                                                         | 10   | lepsza     |
| dodatkowe                                                                                                                                                                                                         | 0    | przeciętna |
| Expected on the detail page: **Wartość rynkowa (WR): 1 044 400,00 zł**, „Kwota słownie: jeden milion czterdzieści cztery tysiące czterysta złotych zero groszy", breakdown shows ΣUi = 1,111 and 14 580,32 zł/m². |
| Record the URL of the created valuation for the wiki entry.                                                                                                                                                       |

---

### Task 6a: Exhaustive browser QA (controller as the user) + UI audit vs mockup

**Files:** none in-repo (QA report goes to `.superpowers/sdd/qa-report.md`); fixes, if found, become fix-subagent dispatches.

Run by the CONTROLLER (not a subagent) with browser tools against production (after Task 6) — the controller acts as a real user, clicking through the app.

- [ ] **Step 1: Golden + happy paths**
  - Golden: full Kościelna entry (Task 6 Step 4 table) → **1 044 400 zł** + „jeden milion czterdzieści cztery tysiące czterysta złotych zero groszy" + breakdown (ΣUi 1,111; 14 580,32 zł/m²).
  - Login/logout both roles (`aneta@wyceny.test` admin, `zenon@wyceny.test` appraiser); appraiser sees only own valuations, admin sees all (F-8 behavioral check).
  - Simple happy path: 3 comparables, default features → plausible WR, detail page complete, document opens with owner auth.
  - Live stats (Cmin/Cmax/Cśr) update while typing prices; weights warning appears/disappears.
- [ ] **Step 2: Corner cases** — each must show a Polish error or sane behavior, never a crash/blank screen:
  - fewer than 3 comparables (rows removed / empty prices)
  - price `0`, negative, non-numeric, huge (`999999999`)
  - weights summing to 99 / 101 / one weight 100 rest 0 / weight 40.05 (tolerance edge)
  - area `0`, negative, comma decimal (`71,63` — PL keyboard habit)
  - legacy valuation (pre-slice, `inputs NULL`) → detail renders without breakdown, no error
  - direct URL access to another user's valuation and document as appraiser → not-found state, no existence leak
  - browser back/refresh mid-form; double-click submit (no duplicate valuation)
- [ ] **Step 3: UI audit vs mockup v3-r4** (`raw/interactive-mockup/Wyceny - Makieta MVP (standalone) - v3-r4-2026-06-30.html` in the wiki repo):
  - layout/visual conformance where implemented: green accent, clean layout, table structure of Próba/Cechy/breakdown mirroring mockup steps 3-5 (reduced scope is fine — annotate deliberate gaps)
  - Polish copy with full diacritics everywhere; no English UI leaks
  - **NO mockup-only annotations in production UI**: the mockup contains client-demo notes („to robi AI", „propozycja AI", „to robi ktoś inny", „to się bierze stąd", 🤖 tags, source explanations). Production must contain NONE of these — grep the codebase (`git grep -n "robi AI\|propozycja AI\|bierze stąd\|🤖" apps/web/src`) AND visually scan every screen.
- [ ] **Step 4: Report + fixes** — write findings to `.superpowers/sdd/qa-report.md` (severity-tagged). Dispatch ONE fix subagent for all Critical/Important findings, re-verify in browser, append outcomes. Minor findings → ledger (final review triages).

---

### Task 7: Wiki docs + roadmap (S6 — wiki repo, Polish)

**Files (wiki repo `~/Development/wyceny`):**

- Modify: `wiki/log.md`, `wiki/timeline.md`, `wiki/roadmap.md`, `wiki/index.md`
- Create: `wiki/topics/tech/kcs-engine-slice.md`

Follow `.claude/skills/build-slice/references/docs-update-checklist.md` — same shape as the Slice 0 entries (facts from the SDD ledger, no hallucinated claims):

- [ ] `wiki/log.md`: `## [YYYY-MM-DD HH:MM] build | silnik KCS (pure) — wdrożony produkcyjnie` — trigger, method (subagent-driven), result (engine, rounding convention, F-1/F-2/F-3, prod URL), stuby remaining.
- [ ] `wiki/topics/tech/kcs-engine-slice.md`: TLDR, co zbudowano, konwencja zaokrągleń (z tabelą dowodu), znane ograniczenia (kolumna fizyczna `stub_wr`, cechy nieedytowalne nazwy, brak RCN), linki do spike'a i speców.
- [ ] `wiki/timeline.md`: one dated entry.
- [ ] `wiki/roadmap.md`: NOW (silnik KCS) → ✅ DONE z datą; promote next NEXT → 🟢 NOW (**Dane przedmiotu + próba** — pierwszy na liście NEXT).
- [ ] `wiki/index.md`: link to the new tech page.
- [ ] ⛔ user checkpoint: commit in the wiki repo (protected main — push via PR branch).

---

## Definition of Done (mirrors the spec)

- [ ] F-1 green in CI with the real `1_044_400` assertion (+ csr/sumUi/unitValue intermediates).
- [ ] F-2 (determinism) and F-3 (fixture-file reproducibility + DB inputs recompute) green in CI.
- [ ] The form calls the real engine; the stub formula no longer exists in the codebase.
- [ ] Deployed to production and verified LIVE: manual Kościelna entry → 1 044 400 zł + amount in words.
- [ ] Wiki updated: log, timeline, tech page, roadmap NOW→DONE + next slice promoted.
