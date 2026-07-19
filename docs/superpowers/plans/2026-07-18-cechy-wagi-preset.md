# Feature Bag Preset + Rating-Scale Definitions (Slice 7, F-6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "Cechy i wagi" form section works on an editable feature bag (Aneta's canonical 6+3 pool) with per-valuation rating-scale definitions seeded from a domain preset; unedited preset values enter F-4 as `preset — to_verify` with a "Potwierdź cechy i wagi" confirm; the operat prints THIS valuation's definitions (replacing hardcoded Kościelna literals in §12.1) plus the honest weights sentence (ADR-006 short variant, AC-8). New fitness function **F-6** guards the preset in CI.

**Architecture:** Preset lives as a domain const (`feature-presets.ts`, bag per object type — today only `lokal`); the form copies it, the appraiser edits per valuation, everything persists into write-once `inputs` jsonb (**zero DDL**). Provenance is assigned server-side by comparing the submission against the expected preset (incl. the area-median-derived powierzchnia threshold) — the client cannot fake a manual edit. `computeKcs` is **untouched** (new `key`/`definitions` fields are metadata the engine never reads — F-1/F-2/F-3 unchanged). Worker untouched (F-11 no risk).

**Tech Stack:** Next.js 16 (App Router, server actions), react-hook-form + zod 4, docxtemplater, vitest + jsdom/RTL (infra exists since Slice 6), python-docx (wiki-repo template builder).

**Spec:** `docs/superpowers/specs/2026-07-18-cechy-wagi-preset-design.md` (approved 2026-07-18).

## Global Constraints

- Code/comments/commits: **English**; commit subject ≤100 chars, conventional, lowercase-leading. NO tool attribution in commits.
- UI copy and operat content: **Polish with full diacritics** (internal enum value `przecietna` stays diacritic-free; visible labels use "przeciętna").
- **F-1 golden untouched:** `apps/web/tests/fixtures/koscielna.json` is NOT modified; `golden-wr.test.ts` must stay green with WR = 1 044 400 zł. `computeKcs` logic is NOT modified (type-only extension of `Feature` allowed).
- **F-9:** synthetic fixtures only; no PESEL-shaped (11-digit) or KW-shaped literals anywhere.
- **F-11 untouched:** worker not modified at all in this slice.
- **Zero DDL:** no new migrations; everything rides in `inputs` jsonb.
- Per-task gates: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`. Commit + `git push` per task (EXCEPT Task 7 — local commit, pushes with Task 8), then `gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'` → `gh run watch <id> --exit-status` (bare `gh run watch` is interactive-only).
- Focused web tests: `pnpm --filter web exec vitest run <path>` (a bare `-- <pattern>` does NOT filter in this repo).
- Template regenerates ONLY via wiki-repo `tools/spike/2026-07-15-template-koscielna/build_template.py`; never hand-edit the .docx. The wiki-repo `build_template.py` diff stays **UNCOMMITTED in the wiki repo** (rides the S6 wiki PR — Slice 5/6 convention).
- Invisible chars (NBSP) only as escape sequences; the Edit tool converts escapes to live NBSP — write such fragments via Python file I/O. (No new NBSP needed in this slice.)
- New RTL test files: per-file pragma `// @vitest-environment jsdom` + the cleanup/ResizeObserver/mock preamble pattern from `apps/web/tests/rtl-kw-section.test.tsx`.
- Ports/adapters: adapters import ports **relatively** (`../ports/x`); only `app/`/`_deps` use `@/`.

## File Structure (new/modified)

```
packages/shared/src/sourced.ts                       MOD  ProvenanceSource += "preset"
apps/web/src/domain/feature-presets.ts               NEW  pool const + defaults + median/match helpers (pure)
apps/web/tests/f6-feature-preset.test.ts             NEW  F-6 fitness function
apps/web/src/domain/kcs.ts                           MOD  Feature += key?/definitions? (metadata only)
apps/web/src/lib/valuation-form-schema.ts            MOD  featureSchema += key/definitions; DEFAULT_FEATURES derived
apps/web/src/app/actions/create-valuation.ts         MOD  features mapping += key + normalized definitions
apps/web/src/lib/assign-provenance.ts                MOD  weights/featureDefs preset-vs-edited logic
apps/web/src/domain/provenance.ts                    MOD  InputsProvenance.featureDefs + gate blocker
apps/web/src/domain/valuation.ts                     MOD  confirmFeaturesProvenance
apps/web/src/ports/valuation.ts                      MOD  PortValuation.confirmFeatures
apps/web/src/adapters/valuation-drizzle.ts           MOD  confirmFeatures (byte-mirror of confirmKw)
apps/web/src/app/actions/confirm-features.ts         NEW  server action (mirror of confirm-kw)
apps/web/src/app/valuations/[id]/valuation-actions.tsx MOD  "Potwierdź cechy i wagi" button
apps/web/src/app/valuations/[id]/page.tsx            MOD  hasFeaturesToVerify + FeaturesCard + footer fix
apps/web/src/app/valuations/new/new-valuation-form.tsx MOD  bag add/remove + definitions accordion + median prefill
apps/web/tests/rtl-features-section.test.tsx         NEW  RTL for the bag + definitions UI
apps/web/src/domain/document-model.ts                MOD  skala_ocen rows + weight>0 filter
apps/web/tests/document-model-skala.test.ts          NEW  model unit tests
apps/web/tests/f12-template-integrity.test.ts        MOD  new tags + anti-literals + required prose
apps/web/tests/f12-document-sections.test.ts         MOD  golden features get definitions; render asserts
apps/web/templates/operat-szablon.docx               REGEN via wiki-repo builder (Task 8)
apps/web/src/domain/operat-sections.ts               REGEN by builder (headings unchanged expected)
wiki-repo tools/spike/2026-07-15-template-koscielna/build_template.py  MOD (UNCOMMITTED)
```

Also updated in place (test fallout): `valuation-form-schema.test.ts`, `assign-provenance.test.ts`, `f4-approval-gate.test.ts`, `create-valuation-action.test.ts`, `valuation-lifecycle.test.ts` — any fixture building `features` rows gains `key` (and optionally `definitions`).

---

### Task 1: Kernel source + domain preset module + F-6

**Files:**

- Modify: `packages/shared/src/sourced.ts:7-8`
- Create: `apps/web/src/domain/feature-presets.ts`
- Test: `apps/web/tests/f6-feature-preset.test.ts`

**Interfaces:**

- Produces: `ProvenanceSource` now includes `"preset"`.
- Produces (all pure, consumed by Tasks 2–6):
  - `FEATURE_LEVELS: readonly ["lepsza","przecietna","gorsza"]` (document/display order)
  - `FeatureDefinitions = Partial<Record<FeatureRating, string>>`
  - `FeaturePresetEntry = { key; name; defaultWeightPct; kind: "basic"|"exceptional"; defaultDefinitions }`
  - `LOKAL_FEATURE_KEYS` (9-key const tuple), `FEATURE_PRESETS: { lokal: FeaturePresetEntry[] }`
  - `medianAreaM2(areas: Array<number|null|undefined>): number | null` (half-up to whole m²)
  - `powierzchniaDefinitions(medianM2: number | null): FeatureDefinitions` (`{}` when null)
  - `presetDefinitionsFor(key: string, medianM2: number | null): FeatureDefinitions`
  - `normalizeDefText(s: string | undefined): string` (trim + collapse whitespace)
  - `matchesPresetWeights(features: Array<{key: string; weightPct: number}>): boolean`
  - `matchesPresetDefinitions(features: Array<{key: string; definitions?: FeatureDefinitions}>, medianM2: number | null): boolean`
  - `defaultFeatureFormValues(): Array<{key; name; weightPct; rating: "przecietna"; definitions: FeatureDefinitions}>`

- [ ] **Step 1: Write the failing F-6 test**

`apps/web/tests/f6-feature-preset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FEATURE_PRESETS,
  LOKAL_FEATURE_KEYS,
  defaultFeatureFormValues,
  matchesPresetDefinitions,
  matchesPresetWeights,
  medianAreaM2,
  powierzchniaDefinitions,
} from "../src/domain/feature-presets";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import fixture from "./fixtures/koscielna.json";

/**
 * F-6 (fitness function): the expert preset (ADR-006) is the single source of
 * truth for the lokal feature bag. Guards: Σ(basic weights) = 100 exactly, the
 * bag is Aneta's canonical 6+3 list, the basic six reproduce the golden-era
 * form defaults (40/30/10/10/4/6), and the engine ignores the new metadata.
 */
describe("F-6: lokal feature preset", () => {
  const lokal = FEATURE_PRESETS.lokal;
  const basic = lokal.filter((e) => e.kind === "basic");

  it("has exactly Aneta's canonical 9-key bag, in pool order", () => {
    expect(lokal.map((e) => e.key)).toEqual([...LOKAL_FEATURE_KEYS]);
    expect(LOKAL_FEATURE_KEYS).toEqual([
      "standard-wykonczenia",
      "polozenie-na-pietrze",
      "lokalizacja",
      "powierzchnia-uzytkowa",
      "pomieszczenia-przynalezne",
      "dodatkowe",
      "funkcjonalnosc-lokalu",
      "liczba-izb",
      "rodzaj-zabudowy",
    ]);
  });

  it("basic six reproduce the pre-Slice-7 hardcoded form defaults exactly", () => {
    expect(basic.map((e) => [e.name, e.defaultWeightPct])).toEqual([
      ["standard wykończenia", 40],
      ["położenie na piętrze", 30],
      ["lokalizacja", 10],
      ["powierzchnia użytkowa", 10],
      ["pomieszczenia przynależne", 4],
      ["dodatkowe", 6],
    ]);
  });

  it("basic weights sum to exactly 100; exceptional entries carry weight 0", () => {
    expect(basic.reduce((s, e) => s + e.defaultWeightPct, 0)).toBe(100);
    for (const e of lokal.filter((x) => x.kind === "exceptional")) {
      expect(e.defaultWeightPct).toBe(0);
    }
  });

  it("every declared default definition is non-empty; powierzchnia is dynamic (empty static defaults)", () => {
    for (const e of lokal) {
      if (e.key === "powierzchnia-uzytkowa") {
        expect(e.defaultDefinitions).toEqual({});
        continue;
      }
      const levels = Object.values(e.defaultDefinitions);
      expect(levels.length).toBeGreaterThan(0);
      for (const text of levels) expect(text!.trim().length).toBeGreaterThan(0);
    }
  });

  it("powierzchnia definitions derive from the sample median (half-up, whole m²)", () => {
    expect(medianAreaM2([])).toBeNull();
    expect(medianAreaM2([50, 60, 70])).toBe(60);
    expect(medianAreaM2([50, 60])).toBe(55);
    expect(medianAreaM2([50, 61])).toBe(56); // 55.5 → half-up
    expect(medianAreaM2([undefined, null, 70])).toBe(70);
    expect(powierzchniaDefinitions(null)).toEqual({});
    const defs = powierzchniaDefinitions(65);
    expect(defs.lepsza).toContain("65");
    expect(defs.gorsza).toContain("65");
    expect(defs.przecietna).toBeUndefined();
  });

  it("defaultFeatureFormValues() = active basic bag, all przecietna, static definitions copied", () => {
    const defaults = defaultFeatureFormValues();
    expect(defaults.map((f) => [f.key, f.weightPct, f.rating])).toEqual(
      basic.map((e) => [e.key, e.defaultWeightPct, "przecietna"]),
    );
    // powierzchnia starts empty — the form fills it from the live sample median
    expect(defaults.find((f) => f.key === "powierzchnia-uzytkowa")!.definitions).toEqual({});
  });

  it("matchesPresetWeights: true for untouched defaults, false for any edit", () => {
    const defaults = defaultFeatureFormValues();
    expect(matchesPresetWeights(defaults)).toBe(true);
    expect(matchesPresetWeights([{ ...defaults[0], weightPct: 41 }, ...defaults.slice(1)])).toBe(
      false,
    );
    expect(matchesPresetWeights(defaults.slice(1))).toBe(false); // removed a feature
    expect(matchesPresetWeights([...defaults, { key: "rodzaj-zabudowy", weightPct: 0 }])).toBe(
      false,
    ); // added from pool (no `name` — the param type is {key; weightPct} only)
  });

  it("matchesPresetDefinitions: whitespace-insensitive; median-prefilled powierzchnia counts as preset", () => {
    const defaults = defaultFeatureFormValues().map((f) =>
      f.key === "powierzchnia-uzytkowa" ? { ...f, definitions: powierzchniaDefinitions(60) } : f,
    );
    expect(matchesPresetDefinitions(defaults, 60)).toBe(true);
    // extra whitespace still matches
    const spaced = defaults.map((f) =>
      f.key === "standard-wykonczenia"
        ? { ...f, definitions: { ...f.definitions, lepsza: `  ${f.definitions.lepsza}  ` } }
        : f,
    );
    expect(matchesPresetDefinitions(spaced, 60)).toBe(true);
    // a real edit does not
    const edited = defaults.map((f) =>
      f.key === "standard-wykonczenia"
        ? { ...f, definitions: { ...f.definitions, lepsza: "własny tekst rzeczoznawcy" } }
        : f,
    );
    expect(matchesPresetDefinitions(edited, 60)).toBe(false);
    // wrong median → not preset
    expect(matchesPresetDefinitions(defaults, 70)).toBe(false);
  });

  it("engine ignores the new metadata: enriched features give a byte-identical result (F-1 safe)", () => {
    // koscielna.json is a {name, input, expected} wrapper (see golden-wr.test.ts) — use .input.
    const base = (fixture as { input: KcsInput }).input;
    const enriched: KcsInput = {
      ...base,
      features: base.features.map((f) => ({
        ...f,
        key: "standard-wykonczenia",
        definitions: { lepsza: "dowolny tekst" },
      })),
    };
    const a = computeKcs(base);
    const b = computeKcs(enriched);
    expect(b.wr).toBe(a.wr);
    expect(b.sumUi).toBe(a.sumUi);
    expect(b.unitValue).toBe(a.unitValue);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run tests/f6-feature-preset.test.ts`
Expected: FAIL — `Cannot find module '../src/domain/feature-presets'`.

- [ ] **Step 3: Add `"preset"` to the kernel source enum**

In `packages/shared/src/sourced.ts` replace lines 7–8 with:

```ts
export type ProvenanceSource =
  | "geokoder"
  | "ewidencja"
  | "mpzp"
  | "odpis_kw"
  | "akt"
  | "rcn"
  | "ogledziny"
  | "rzeczoznawca"
  | "preset";
```

- [ ] **Step 4: Create `apps/web/src/domain/feature-presets.ts`**

```ts
import type { FeatureRating } from "./kcs";

/**
 * Expert feature preset (F-6, ADR-006) — the domain source of truth for the
 * feature bag, default weights and default rating-scale definitions, per
 * object type (today only "lokal"; a new type = a new entry, ADR-008
 * open/closed). Copied into the form on valuation creation; the appraiser
 * edits per valuation; the snapshot persists in write-once `inputs`.
 *
 * Definition TEXTS are hypothesis-grade defaults derived from the Kościelna
 * operat and the Gościejewko court operat §9.1 (wiki: cechy-porownawcze-lokali)
 * — Aneta verifies them during app testing (user decision 2026-07-15). The
 * MODEL (per-valuation, editable) is confirmed. Pure module: zero I/O (F-10).
 */

/** Document/display order of rating levels. */
export const FEATURE_LEVELS = ["lepsza", "przecietna", "gorsza"] as const;

export type FeatureDefinitions = Partial<Record<FeatureRating, string>>;

export type FeaturePresetEntry = {
  /** Stable slug (no diacritics) — closed pool, validated by zod. */
  key: string;
  /** Polish display name — flows into the engine's Feature.name and the operat. */
  name: string;
  defaultWeightPct: number;
  /** basic = active by default; exceptional = waits in the pool with weight 0. */
  kind: "basic" | "exceptional";
  /** Static level definitions; powierzchnia-uzytkowa is dynamic — see powierzchniaDefinitions(). */
  defaultDefinitions: FeatureDefinitions;
};

export const LOKAL_FEATURE_KEYS = [
  "standard-wykonczenia",
  "polozenie-na-pietrze",
  "lokalizacja",
  "powierzchnia-uzytkowa",
  "pomieszczenia-przynalezne",
  "dodatkowe",
  "funkcjonalnosc-lokalu",
  "liczba-izb",
  "rodzaj-zabudowy",
] as const;

export type LokalFeatureKey = (typeof LOKAL_FEATURE_KEYS)[number];

export const FEATURE_PRESETS: { lokal: FeaturePresetEntry[] } = {
  lokal: [
    {
      key: "standard-wykonczenia",
      name: "standard wykończenia",
      defaultWeightPct: 40,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "standard dobry, wykończenie materiałami lepszej jakości",
        przecietna: "standard dobry, wykończenie materiałami dobrej jakości",
        gorsza: "wymagany remont lub odświeżenie części elementów wykończenia",
      },
    },
    {
      key: "polozenie-na-pietrze",
      name: "położenie na piętrze",
      defaultWeightPct: 30,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "czwarte piętro i powyżej",
        przecietna: "piętra pośrednie (1–3)",
        gorsza: "parter",
      },
    },
    {
      key: "lokalizacja",
      name: "lokalizacja",
      defaultWeightPct: 10,
      kind: "basic",
      defaultDefinitions: {
        lepsza:
          "położenie w otoczeniu zabudowy mieszkaniowej wielorodzinnej, w bliskiej odległości od punktów handlowo-usługowych i szlaków komunikacyjnych",
        przecietna:
          "położenie w otoczeniu zabudowy mieszkaniowej wielorodzinnej i terenów zielonych, w dalszej odległości od punktów handlowo-usługowych",
      },
    },
    {
      key: "powierzchnia-uzytkowa",
      name: "powierzchnia użytkowa",
      defaultWeightPct: 10,
      kind: "basic",
      // Dynamic: threshold comes from the comparable-sample area median —
      // powierzchniaDefinitions(). Static defaults stay empty (honest silence
      // in the operat until a sample exists or the appraiser types a text).
      defaultDefinitions: {},
    },
    {
      key: "pomieszczenia-przynalezne",
      name: "pomieszczenia przynależne",
      defaultWeightPct: 4,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "przynależna komórka lokatorska lub inne pomieszczenie",
        gorsza: "brak pomieszczeń przynależnych",
      },
    },
    {
      key: "dodatkowe",
      name: "dodatkowe",
      defaultWeightPct: 6,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "ogródek, miejsce postojowe lub komórka lokatorska do wyłącznego korzystania",
        gorsza: "brak elementów dodatkowych",
      },
    },
    {
      key: "funkcjonalnosc-lokalu",
      name: "funkcjonalność lokalu",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "układ funkcjonalny bez skosów i pomieszczeń przechodnich",
        gorsza: "skosy lub pomieszczenia przechodnie ograniczające funkcjonalność",
      },
    },
    {
      key: "liczba-izb",
      name: "liczba izb",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "liczba izb większa niż typowa dla lokali o zbliżonej powierzchni",
        gorsza: "liczba izb mniejsza niż typowa dla lokali o zbliżonej powierzchni",
      },
    },
    {
      key: "rodzaj-zabudowy",
      name: "rodzaj zabudowy budynku",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "rodzaj zabudowy preferowany na rynku lokalnym",
        gorsza: "rodzaj zabudowy mniej preferowany na rynku lokalnym",
      },
    },
  ],
};

/** Median of valid areas, half-up to whole m²; null when no usable area. */
export function medianAreaM2(areas: Array<number | null | undefined>): number | null {
  const valid = areas
    .filter((a): a is number => typeof a === "number" && Number.isFinite(a) && a > 0)
    .sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  const median = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return Math.round(median);
}

/** Sample-derived powierzchnia definitions; {} when the sample carries no areas. */
export function powierzchniaDefinitions(medianM2: number | null): FeatureDefinitions {
  if (medianM2 == null) return {};
  return {
    lepsza: `powierzchnia użytkowa poniżej ${medianM2} m²`,
    gorsza: `powierzchnia użytkowa ${medianM2} m² i więcej`,
  };
}

/** Expected preset definitions for a key, resolving the dynamic powierzchnia case. */
export function presetDefinitionsFor(key: string, medianM2: number | null): FeatureDefinitions {
  if (key === "powierzchnia-uzytkowa") return powierzchniaDefinitions(medianM2);
  return FEATURE_PRESETS.lokal.find((e) => e.key === key)?.defaultDefinitions ?? {};
}

/** Trim + collapse inner whitespace — deterministic preset comparison (spec: Ryzyka). */
export function normalizeDefText(s: string | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/** True iff the bag composition AND all weights equal the untouched basic preset. */
export function matchesPresetWeights(features: Array<{ key: string; weightPct: number }>): boolean {
  const basic = FEATURE_PRESETS.lokal.filter((e) => e.kind === "basic");
  if (features.length !== basic.length) return false;
  return basic.every((e) => {
    const f = features.find((x) => x.key === e.key);
    return f != null && Number(f.weightPct) === e.defaultWeightPct;
  });
}

/** True iff every feature's definitions equal the expected preset texts (whitespace-insensitive). */
export function matchesPresetDefinitions(
  features: Array<{ key: string; definitions?: FeatureDefinitions | null }>,
  medianM2: number | null,
): boolean {
  return features.every((f) => {
    const expected = presetDefinitionsFor(f.key, medianM2);
    return FEATURE_LEVELS.every(
      (level) => normalizeDefText(f.definitions?.[level]) === normalizeDefText(expected[level]),
    );
  });
}

/** Form seed: the active basic bag (weights in %, all przecietna, definitions copied). */
export function defaultFeatureFormValues(): Array<{
  key: LokalFeatureKey;
  name: string;
  weightPct: number;
  rating: "przecietna";
  definitions: FeatureDefinitions;
}> {
  return FEATURE_PRESETS.lokal
    .filter((e) => e.kind === "basic")
    .map((e) => ({
      key: e.key as LokalFeatureKey,
      name: e.name,
      weightPct: e.defaultWeightPct,
      rating: "przecietna" as const,
      definitions: { ...e.defaultDefinitions },
    }));
}
```

- [ ] **Step 5: Extend `Feature` in `apps/web/src/domain/kcs.ts` (type-only — NO logic change)**

Replace the `Feature` type (lines 46–51) with:

```ts
export type Feature = {
  name: string;
  /** Weight as a fraction (Σ over features = 1.0). UI works in %, converts before calling. */
  weight: number;
  rating: FeatureRating;
  /** Preset pool key (Slice 7, F-6) — display/audit metadata only; the engine never reads it. */
  key?: string;
  /** Per-level rating-scale definitions (Slice 7) — operat content only; the engine never reads them. */
  definitions?: Partial<Record<FeatureRating, string>> | null;
};
```

- [ ] **Step 6: Run the F-6 test — verify GREEN**

Run: `pnpm --filter web exec vitest run tests/f6-feature-preset.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Full gates, commit, push, CI**

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git add packages/shared/src/sourced.ts apps/web/src/domain/feature-presets.ts apps/web/src/domain/kcs.ts apps/web/tests/f6-feature-preset.test.ts
git commit -m "feat: lokal feature preset domain module + preset provenance source (F-6)"
git push
gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'  # then: gh run watch <id> --exit-status
```

---

### Task 2: Form schema + create-action mapping

**Files:**

- Modify: `apps/web/src/lib/valuation-form-schema.ts:21-25` (featureSchema), `:120-126` (features refine), `:158-166` (DEFAULT_FEATURES)
- Modify: `apps/web/src/app/actions/create-valuation.ts:136-148` (kcsInput features mapping)
- Test: `apps/web/tests/valuation-form-schema.test.ts` (extend), `apps/web/tests/create-valuation-action.test.ts` (extend), `apps/web/tests/f6-feature-preset.test.ts` (one added assert)

**Interfaces:**

- Consumes: `LOKAL_FEATURE_KEYS`, `defaultFeatureFormValues`, `normalizeDefText`, `FeatureDefinitions` (Task 1).
- Produces: `featureSchema` rows now `{ key, name, weightPct, rating, definitions? }`; `DEFAULT_FEATURES` derived from the preset (same export name/type — form untouched until Task 5); persisted `inputs.features[i]` = `{ name, weight, rating, key, definitions }` with definitions normalized (trimmed, empty levels dropped).

- [ ] **Step 1: Write failing schema tests** (extend `apps/web/tests/valuation-form-schema.test.ts` — follow the file's existing helper for a valid base payload):

```ts
// inside the existing describe — new cases:
it("rejects a feature key outside the pool", () => {
  const values = validPayload();
  values.features = [{ key: "wlasna-cecha", name: "własna", weightPct: 100, rating: "przecietna" }];
  expect(valuationFormSchema.safeParse(values).success).toBe(false);
});

it("rejects duplicate feature keys", () => {
  const values = validPayload();
  values.features = [
    { key: "lokalizacja", name: "lokalizacja", weightPct: 50, rating: "przecietna" },
    { key: "lokalizacja", name: "lokalizacja", weightPct: 50, rating: "lepsza" },
  ];
  const result = valuationFormSchema.safeParse(values);
  expect(result.success).toBe(false);
});

it("accepts optional per-level definitions and DEFAULT_FEATURES parses", () => {
  const values = validPayload();
  values.features = DEFAULT_FEATURES.map((f) => ({ ...f }));
  expect(valuationFormSchema.safeParse(values).success).toBe(true);
});
```

Run: `pnpm --filter web exec vitest run tests/valuation-form-schema.test.ts` → FAIL (key rejected by current schema shape / missing key).

- [ ] **Step 2: Implement schema changes** in `apps/web/src/lib/valuation-form-schema.ts`:

Add import at top: `import { LOKAL_FEATURE_KEYS, defaultFeatureFormValues } from "@/domain/feature-presets";`

Replace `featureSchema` with:

```ts
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
```

In `valuationFormObject`, chain one more refine on the `features` array (after the Σ=100 refine):

```ts
    .refine(
      (features) => new Set(features.map((f) => f.key)).size === features.length,
      "Każda cecha może wystąpić najwyżej raz.",
    ),
```

Replace the `DEFAULT_FEATURES` literal with the derived export (F-6 pins the values):

```ts
/** Default feature bag for a lokal — derived from the domain preset (F-6, ADR-006). */
export const DEFAULT_FEATURES: ValuationFormValues["features"] = defaultFeatureFormValues();
```

- [ ] **Step 3: Add the DEFAULT_FEATURES pin to F-6** (`apps/web/tests/f6-feature-preset.test.ts`):

```ts
import { DEFAULT_FEATURES } from "../src/lib/valuation-form-schema";
// new test inside the describe:
it("DEFAULT_FEATURES is exactly the derived preset (golden-era form reproduced)", () => {
  expect(DEFAULT_FEATURES).toEqual(defaultFeatureFormValues());
});
```

- [ ] **Step 4: Map key/definitions into the snapshot** in `apps/web/src/app/actions/create-valuation.ts`.

Add import: `import { normalizeDefText, type FeatureDefinitions } from "@/domain/feature-presets";`

Add helper next to `trimToNull`:

```ts
/** Normalize per-level definitions: trim + collapse whitespace, drop empty levels. */
function normalizeDefinitions(defs?: {
  lepsza?: string;
  przecietna?: string;
  gorsza?: string;
}): FeatureDefinitions {
  const out: FeatureDefinitions = {};
  for (const level of ["lepsza", "przecietna", "gorsza"] as const) {
    const t = normalizeDefText(defs?.[level]);
    if (t) out[level] = t;
  }
  return out;
}
```

Replace the features mapping line (`features: features.map((f) => ({ name: f.name, weight: f.weightPct / 100, rating: f.rating })),`) with:

```ts
    features: features.map((f) => ({
      name: f.name,
      weight: f.weightPct / 100,
      rating: f.rating,
      key: f.key,
      definitions: normalizeDefinitions(f.definitions),
    })),
```

- [ ] **Step 5: Fix test fallout across the suite.** Any test fixture submitting `features` without `key` now fails validation — update them to spread `DEFAULT_FEATURES` (or add valid keys). Run the full suite and fix every red:

Run: `pnpm --filter web exec vitest run`
Expected: all green, incl. `create-valuation-action.test.ts` — add there one new assert that the persisted snapshot carries the metadata:

```ts
// in the existing successful-create test, after capturing the repo call:
const persisted = repoCreateCall.inputs.features[0];
expect(persisted.key).toBe("standard-wykonczenia");
expect(persisted.definitions).toEqual({
  lepsza: "standard dobry, wykończenie materiałami lepszej jakości",
  przecietna: "standard dobry, wykończenie materiałami dobrej jakości",
  gorsza: "wymagany remont lub odświeżenie części elementów wykończenia",
});
```

(Adapt the capture variable to the file's existing mock pattern.)

- [ ] **Step 6: Full gates, commit, push, CI** (same commands as Task 1).

```bash
git commit -m "feat: feature bag schema — closed pool keys + per-level definitions in snapshot"
```

---

### Task 3: Server-side preset provenance + F-4 blocker (LOCAL commit, NO push)

> **Push sequencing (advisor finding #1):** after this task the e2e smoke
> (`apps/web/e2e/smoke.spec.ts` test 2) would FAIL on main — it approves a
> draft built on untouched defaults, and the new `preset — to_verify` blocker
> disables the approve button until the "Potwierdź cechy i wagi" button
> (Task 4) exists. Therefore Task 3 commits LOCALLY and pushes TOGETHER with
> Task 4 (same convention as Task 7+8).

**Files:**

- Modify: `apps/web/src/lib/assign-provenance.ts`
- Modify: `apps/web/src/domain/provenance.ts:10-22` (InputsProvenance), `:77-86` region (gate)
- Test: `apps/web/tests/assign-provenance.test.ts`, `apps/web/tests/f4-approval-gate.test.ts` (extend both)

**Interfaces:**

- Consumes: `matchesPresetWeights`, `matchesPresetDefinitions`, `medianAreaM2` (Task 1); `featureSchema` shape (Task 2).
- Produces: `InputsProvenance.featureDefs?: Provenance` (present on every Slice-7+ snapshot; absent on legacy); `assignProvenance` Pick gains `"features"`; gate blocker label `"Definicje skali ocen"`; weights may now be `{ source: "preset", status: "to_verify" }`.

- [ ] **Step 1: Write failing provenance tests** (extend `apps/web/tests/assign-provenance.test.ts`; use `DEFAULT_FEATURES` + the file's existing base values):

```ts
import { DEFAULT_FEATURES } from "../src/lib/valuation-form-schema";
import { powierzchniaDefinitions } from "../src/domain/feature-presets";

it("untouched preset bag → weights and featureDefs are preset/to_verify", () => {
  const { provenance } = assignProvenance({
    ...base,
    features: DEFAULT_FEATURES.map((f) => ({ ...f })),
  });
  expect(provenance.weights).toEqual({ source: "preset", status: "to_verify" });
  expect(provenance.featureDefs).toEqual({ source: "preset", status: "to_verify" });
  expect(provenance.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
});

it("edited weight → weights rzeczoznawca/confirmed (featureDefs independent)", () => {
  const features = DEFAULT_FEATURES.map((f, i) =>
    i === 0 ? { ...f, weightPct: 39 } : i === 1 ? { ...f, weightPct: 31 } : { ...f },
  );
  const { provenance } = assignProvenance({ ...base, features });
  expect(provenance.weights).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  expect(provenance.featureDefs).toEqual({ source: "preset", status: "to_verify" });
});

it("added/removed feature → weights rzeczoznawca/confirmed", () => {
  const removed = DEFAULT_FEATURES.slice(1).map((f, i) =>
    i === 0 ? { ...f, weightPct: 70 } : { ...f },
  );
  expect(assignProvenance({ ...base, features: removed }).provenance.weights.source).toBe(
    "rzeczoznawca",
  );
});

it("edited definition → featureDefs rzeczoznawca/confirmed", () => {
  const features = DEFAULT_FEATURES.map((f, i) =>
    i === 0 ? { ...f, definitions: { ...f.definitions, lepsza: "własny opis" } } : { ...f },
  );
  expect(assignProvenance({ ...base, features }).provenance.featureDefs).toEqual({
    source: "rzeczoznawca",
    status: "confirmed",
  });
});

it("median-prefilled powierzchnia definitions still count as preset", () => {
  const comparables = [
    { pricePerM2: 10000, area: 50 },
    { pricePerM2: 10100, area: 60 },
    { pricePerM2: 10200, area: 70 },
  ];
  const features = DEFAULT_FEATURES.map((f) =>
    f.key === "powierzchnia-uzytkowa"
      ? { ...f, definitions: powierzchniaDefinitions(60) }
      : { ...f },
  );
  const { provenance } = assignProvenance({ ...base, comparables, features });
  expect(provenance.featureDefs).toEqual({ source: "preset", status: "to_verify" });
});
```

And in `apps/web/tests/f4-approval-gate.test.ts`:

```ts
it("featureDefs to_verify blocks with a Polish label; legacy provenance without the key does not", () => {
  const blocked = approvalGate({
    ...passingGateInput,
    provenance: { ...confirmedProvenance, featureDefs: { source: "preset", status: "to_verify" } },
  });
  expect(blocked.ok).toBe(false);
  expect((blocked as { blockers: Blocker[] }).blockers.map((b) => b.path)).toContain(
    "provenance.featureDefs",
  );
  expect(
    (blocked as { blockers: Blocker[] }).blockers.find((b) => b.path === "provenance.featureDefs")!
      .label,
  ).toBe("Definicje skali ocen — do weryfikacji.");
  // legacy: no featureDefs key at all → no blocker
  expect(approvalGate({ ...passingGateInput, provenance: confirmedProvenance }).ok).toBe(true);
});
```

(Adapt `base`/`passingGateInput`/`confirmedProvenance` to the files' existing fixtures.)

Run both files → FAIL.

- [ ] **Step 2: Implement `InputsProvenance.featureDefs` + gate branch** in `apps/web/src/domain/provenance.ts`:

Add to `InputsProvenance` (after `ratings`):

```ts
  /**
   * Present on every Slice-7+ snapshot (assignProvenance always sets it);
   * absent on legacy snapshots — the gate skips it then (no retro-blockers
   * on old prod drafts).
   */
  featureDefs?: Provenance;
```

Add to `approvalGate`, right after the `SCALAR_KEYS` loop:

```ts
// Rating-scale definitions (Slice 7): gated only when the snapshot carries
// the key — legacy drafts (pre-preset) stay approvable unchanged.
if (input.provenance?.featureDefs != null) {
  const fd = input.provenance.featureDefs;
  const s = sourced("featureDefs", fd.source, fd.status);
  if (isBlocking(s)) {
    blockers.push({
      path: "provenance.featureDefs",
      label: `Definicje skali ocen — ${statusLabel(fd.status)}.`,
    });
  }
}
```

- [ ] **Step 3: Implement preset detection** in `apps/web/src/lib/assign-provenance.ts`:

Add imports:

```ts
import {
  matchesPresetDefinitions,
  matchesPresetWeights,
  medianAreaM2,
} from "@/domain/feature-presets";
```

Extend the `Pick` with `"features"`:

```ts
  values: Pick<
    ValuationFormValues,
    "comparables" | "features" | "sampleMeta" | "subject" | "subjectMeta" | "kw" | "kwMeta" | "area"
  >,
```

Inside the function, before building `provenance`:

```ts
// Preset detection (Slice 7, brainstorm decision 5): server-side comparison
// against the expected preset — the client cannot fake a manual edit. The
// powierzchnia threshold is recomputed here from the SUBMITTED comparables,
// so a median-prefilled definition still counts as the app's proposal.
const median = medianAreaM2(values.comparables.map((c) => c.area));
const presetWeights = matchesPresetWeights(values.features);
const presetDefs = matchesPresetDefinitions(values.features, median);
```

And in the returned `provenance` object replace the `weights`/`ratings` lines with:

```ts
    weights: presetWeights ? ({ source: "preset", status: "to_verify" } as const) : confirmed,
    ratings: confirmed,
    featureDefs: presetDefs ? ({ source: "preset", status: "to_verify" } as const) : confirmed,
```

- [ ] **Step 4: Run both test files → GREEN; then full suite** (`pnpm --filter web exec vitest run`) and fix fallout: tests calling `assignProvenance` without `features` need the field added. `valuation-lifecycle.test.ts` fixtures may need `featureDefs` added where they assert full provenance objects. (The e2e smoke is expected RED at this point — it is fixed in Task 4 and both tasks push together.)

- [ ] **Step 5: Full gates, commit LOCALLY — do NOT push** (pushes with Task 4).

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git commit -m "feat: preset provenance — server-side detection, featureDefs scalar, f4 blocker"
```

---

### Task 4: Confirm pipeline + detail page (pushes Task 3 + 4)

**Files:**

- Modify: `apps/web/src/domain/valuation.ts` (add `confirmFeaturesProvenance` after `confirmKwProvenance`)
- Modify: `apps/web/src/ports/valuation.ts` (add `confirmFeatures` to `PortValuation`)
- Modify: `apps/web/src/adapters/valuation-drizzle.ts` (add `confirmFeatures`)
- Create: `apps/web/src/app/actions/confirm-features.ts`
- Modify: `apps/web/src/app/valuations/[id]/valuation-actions.tsx`
- Modify: `apps/web/src/app/valuations/[id]/page.tsx`
- Modify: `apps/web/e2e/smoke.spec.ts` (confirm-features click before approve — advisor finding #1)
- Test: `apps/web/tests/valuation-lifecycle.test.ts` (extend)

**Interfaces:**

- Consumes: `InputsProvenance.featureDefs` (Task 3).
- Produces: `confirmFeaturesProvenance(valuation): Valuation` (flips `weights` + `featureDefs` → confirmed); `PortValuation.confirmFeatures(id, user)`; server action `confirmFeatures(id)`; `ValuationActions` prop `hasFeaturesToVerify: boolean`.

- [ ] **Step 1: Write failing lifecycle tests** (extend `apps/web/tests/valuation-lifecycle.test.ts`, mirroring the confirmSubjectProvenance cases):

```ts
it("confirmFeaturesProvenance flips weights + featureDefs to confirmed, draft-only", () => {
  const draft = draftWith({
    provenance: {
      ...confirmedProvenance,
      weights: { source: "preset", status: "to_verify" },
      featureDefs: { source: "preset", status: "to_verify" },
    },
  });
  const updated = confirmFeaturesProvenance(draft);
  expect(updated.inputs!.provenance!.weights).toEqual({ source: "preset", status: "confirmed" });
  expect(updated.inputs!.provenance!.featureDefs).toEqual({
    source: "preset",
    status: "confirmed",
  });
});

it("confirmFeaturesProvenance on legacy provenance (no featureDefs) flips weights only", () => {
  const draft = draftWith({ provenance: { ...confirmedProvenance } }); // no featureDefs key
  const updated = confirmFeaturesProvenance(draft);
  expect(updated.inputs!.provenance!.featureDefs).toBeUndefined();
  expect(updated.inputs!.provenance!.weights.status).toBe("confirmed");
});

it("confirmFeaturesProvenance throws for non-draft and for missing inputs", () => {
  expect(() => confirmFeaturesProvenance({ ...approvedValuation })).toThrow();
  expect(() => confirmFeaturesProvenance(draftWith(null))).toThrow(/no inputs snapshot/);
});
```

(Adapt `draftWith`/`confirmedProvenance`/`approvedValuation` to the file's existing helpers.)

Run: `pnpm --filter web exec vitest run tests/valuation-lifecycle.test.ts` → FAIL.

- [ ] **Step 2: Implement the domain transition** in `apps/web/src/domain/valuation.ts`, right after `confirmKwProvenance` (byte-for-byte sibling style):

```ts
/**
 * Mirrors `confirmSubjectProvenance` for the feature preset group (Slice 7):
 * flips `weights` (always present) and `featureDefs` (when present — legacy
 * snapshots lack it) to confirmed. Draft-only, throw-on-missing-inputs,
 * byte-for-byte like its siblings.
 */
export function confirmFeaturesProvenance(valuation: Valuation): Valuation {
  assertDraft(valuation);
  if (!valuation.inputs) {
    throw new Error(`Valuation ${valuation.id} has no inputs snapshot — nothing to confirm`);
  }
  const { provenance: p } = valuation.inputs;
  const provenance = p
    ? {
        ...p,
        weights: { ...p.weights, status: "confirmed" as const },
        ...(p.featureDefs
          ? { featureDefs: { ...p.featureDefs, status: "confirmed" as const } }
          : {}),
      }
    : p;
  return { ...valuation, inputs: { ...valuation.inputs, provenance } };
}
```

- [ ] **Step 3: Port + adapter.** In `apps/web/src/ports/valuation.ts` add to `PortValuation` (after `confirmKw`):

```ts
  /**
   * Confirms the feature-preset provenance on a draft (weights + featureDefs →
   * confirmed). Mirrors `confirmSample`'s owner-only null/throw contract.
   */
  confirmFeatures(id: string, user: SessionUser): Promise<Valuation | null>;
```

In `apps/web/src/adapters/valuation-drizzle.ts`: import `confirmFeaturesProvenance` alongside its siblings (line 6–8 import block) and add a `confirmFeatures` method that is a **byte-mirror of `confirmKw` (lines ~140–150)** with `confirmKwProvenance` → `confirmFeaturesProvenance`. Copy the sibling verbatim — same ownership lookup, same null/persist shape.

- [ ] **Step 4: Server action** — create `apps/web/src/app/actions/confirm-features.ts` (mirror of `confirm-kw.ts`):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

export type ConfirmFeaturesResult = { error: string } | undefined;

/**
 * Bulk-confirm the feature preset (mirrors confirmSample/confirmSubject/confirmKw):
 * flips the draft's weights + featureDefs provenance to confirmed.
 */
export async function confirmFeatures(id: string): Promise<ConfirmFeaturesResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.confirmFeatures(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("confirmFeatures failed", error);
    return { error: "Nie udało się potwierdzić cech i wag — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
}
```

- [ ] **Step 5: Action bar button.** In `apps/web/src/app/valuations/[id]/valuation-actions.tsx`: import `confirmFeatures`, add prop `hasFeaturesToVerify: boolean`, and render (after the KW button, before approve):

```tsx
{
  hasFeaturesToVerify ? (
    <Button
      type="button"
      variant="outline"
      data-testid="confirm-features-button"
      disabled={isPending}
      onClick={() => run(confirmFeatures)}
    >
      {isPending ? "Potwierdzanie…" : "Potwierdź cechy i wagi"}
    </Button>
  ) : null;
}
```

- [ ] **Step 6: Detail page.** In `apps/web/src/app/valuations/[id]/page.tsx`:

(a) compute (next to `hasKwToVerify`):

```ts
const hasFeaturesToVerify =
  isDraft && valuation.inputs
    ? valuation.inputs.provenance?.weights?.status === "to_verify" ||
      valuation.inputs.provenance?.featureDefs?.status === "to_verify"
    : false;
```

and pass `hasFeaturesToVerify={hasFeaturesToVerify}` to `<ValuationActions … />`.

(b) add `FeaturesCard` (place next to `KwCard`'s definition; render it in the JSX right after the `ComparablesProvenance` card):

```tsx
const LEVEL_LABEL: Record<"lepsza" | "przecietna" | "gorsza", string> = {
  lepsza: "lepsza",
  przecietna: "przeciętna",
  gorsza: "gorsza",
};

/** Feature bag + rating-scale definitions (Slice 7). Mirrors SubjectCard's structure. */
function FeaturesCard({ inputs }: { inputs: KcsInput }) {
  const features = inputs.features ?? [];
  if (features.length === 0) return null;
  const provenance = inputs.provenance;
  const rows = features
    .map((f) => ({
      name: f.name,
      defs: (["lepsza", "przecietna", "gorsza"] as const)
        .filter((level) => f.definitions?.[level]?.trim())
        .map((level) => `${LEVEL_LABEL[level]} – ${f.definitions![level]!.trim()}`),
    }))
    .filter((r) => r.defs.length > 0);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Cechy i wagi</h2>
          <div className="flex flex-wrap gap-2">
            <GroupProvenanceBadge label="Wagi cech" status={provenance?.weights?.status} />
            {provenance?.featureDefs ? (
              <GroupProvenanceBadge
                label="Definicje skali ocen"
                status={provenance.featureDefs.status}
              />
            ) : null}
          </div>
        </div>
        {rows.length > 0 ? (
          <dl className="flex flex-col gap-2 text-sm">
            {rows.map((r) => (
              <div key={r.name}>
                <dt className="text-xs text-muted-foreground">{r.name}</dt>
                {r.defs.map((d) => (
                  <dd key={d}>{d}</dd>
                ))}
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Brak definicji skali ocen.</p>
        )}
      </CardContent>
    </Card>
  );
}
```

(c) fix the now-lying `ComparablesProvenance` footer (lines ~391–400): weights may be preset/to_verify. Replace the paragraph with:

```tsx
{
  inputs.provenance ? (
    <p className="text-xs text-muted-foreground">
      {areaProvenanceText
        ? `Adres: rzeczoznawca (potwierdzone) · ${areaProvenanceText}`
        : "Adres, powierzchnia: rzeczoznawca (potwierdzone)"}
      {` · wagi: ${
        inputs.provenance.weights.source === "preset"
          ? `preset — ${provenanceStatusText(inputs.provenance.weights.status)}`
          : "rzeczoznawca (potwierdzone)"
      }`}
      {" · oceny: rzeczoznawca (potwierdzone)"}
      {inputs.provenance.geocode
        ? ` · geokodowanie: ${provenanceStatusText(inputs.provenance.geocode.status)}`
        : ""}
    </p>
  ) : null;
}
```

- [ ] **Step 7: Fix the e2e smoke.** In `apps/web/e2e/smoke.spec.ts` (test 2 — the approve flow): after the draft is created/opened and BEFORE asserting the approve button is enabled, confirm the preset:

```ts
// Slice 7: untouched defaults enter as preset — to_verify; confirm them first.
await page.getByTestId("confirm-features-button").click();
await expect(page.getByTestId("confirm-features-button")).toHaveCount(0);
```

(Adapt placement to the test's existing structure; Playwright auto-waits on the revalidated page.) Verify locally: `pnpm --filter web exec playwright test` with the CI env flags (`NEXT_PUBLIC_SUBJECT_AUTOFETCH=off`, `NEXT_PUBLIC_KW_UPLOAD=off`) per the e2e job setup.

- [ ] **Step 8: Run lifecycle tests → GREEN; full gates; commit; push BOTH commits (T3+T4); CI.**

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git commit -m "feat: confirm features pipeline — domain flip, port/adapter, action, detail card"
git push   # publishes Task 3 + Task 4
gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'  # then: gh run watch <id> --exit-status
```

---

### Task 5: Form UI — bag add/remove from pool

**Files:**

- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx` (features section, lines ~648–730 + `useFieldArray` at :160)
- Test: `apps/web/tests/rtl-features-section.test.tsx` (NEW)

**Interfaces:**

- Consumes: `FEATURE_PRESETS` (Task 1); `featureSchema` with `key`/`definitions` (Task 2).
- Produces: add/remove UI; rows carry `key` end-to-end. `data-testid`s: `add-feature-select`, `remove-feature-<key>`.

- [ ] **Step 1: Write failing RTL tests.** Create `apps/web/tests/rtl-features-section.test.tsx` with the exact preamble pattern of `rtl-kw-section.test.tsx` (pragma, `afterEach(cleanup)`, ResizeObserver shim, `NEXT_PUBLIC_SUBJECT_AUTOFETCH = "off"`, the same `vi.mock` block for `create-valuation`, `get-sample-proposal`, `get-subject-data`, `mint-kw-token`, `kw-extract-client`), then:

```tsx
import { NewValuationForm } from "@/app/valuations/new/new-valuation-form";

describe("features section — bag add/remove (Slice 7)", () => {
  it("renders the 6 basic features and an add-from-pool select with the 3 exceptional ones", async () => {
    render(<NewValuationForm />);
    expect(screen.getByText("standard wykończenia")).toBeTruthy();
    expect(screen.getByText("pomieszczenia przynależne")).toBeTruthy();
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("funkcjonalność lokalu");
    expect(options).toContain("liczba izb");
    expect(options).toContain("rodzaj zabudowy budynku");
  });

  it("adding from the pool appends a row with weight 0 and removes it from the select", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    await user.selectOptions(select, "rodzaj-zabudowy");
    expect(screen.getByText("rodzaj zabudowy budynku")).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).not.toContain("rodzaj-zabudowy");
  });

  it("removing a feature deletes its row and returns it to the pool", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    await user.click(screen.getByTestId("remove-feature-dodatkowe"));
    // NOTE: don't queryByText("dodatkowe") — the pool <option> now carries that
    // exact text (advisor finding #4); the row's remove button is the row proxy.
    expect(screen.queryByTestId("remove-feature-dodatkowe")).toBeNull();
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("dodatkowe");
  });
});
```

Run: `pnpm --filter web exec vitest run tests/rtl-features-section.test.tsx` → FAIL (no select/testids).

- [ ] **Step 2: Implement.** In `new-valuation-form.tsx`:

(a) import `FEATURE_PRESETS` from `@/domain/feature-presets`;

(b) destructure the array helpers (line ~160):

```ts
const {
  fields: featureFields,
  append: appendFeature,
  remove: removeFeature,
} = useFieldArray({ control, name: "features" });
```

(c) compute the available pool (after `weightsBalanced`):

```ts
const activeFeatureKeys = new Set((features ?? []).map((f) => f?.key));
const availableFeatures = FEATURE_PRESETS.lokal.filter((e) => !activeFeatureKeys.has(e.key));
```

(d) in the features `<Table>` add a 4th header `<TableHead />` and per-row a remove cell (after the rating cell):

```tsx
<TableCell>
  <Button
    type="button"
    size="sm"
    variant="ghost"
    data-testid={`remove-feature-${features?.[index]?.key ?? index}`}
    aria-label={`Usuń cechę ${field.name}`}
    disabled={featureFields.length === 1}
    onClick={() => removeFeature(index)}
  >
    Usuń
  </Button>
</TableCell>
```

(e) below the table (before the error/warning paragraphs), the pool select — resets to placeholder after each add:

```tsx
{
  availableFeatures.length > 0 ? (
    <select
      data-testid="add-feature-select"
      aria-label="Dodaj cechę z puli"
      className="w-fit rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
      value=""
      onChange={(e) => {
        const entry = FEATURE_PRESETS.lokal.find((x) => x.key === e.target.value);
        if (!entry) return;
        appendFeature({
          key: entry.key,
          name: entry.name,
          weightPct: 0,
          rating: "przecietna",
          definitions: { ...entry.defaultDefinitions },
        });
      }}
    >
      <option value="">+ Dodaj cechę z puli…</option>
      {availableFeatures.map((e) => (
        <option key={e.key} value={e.key}>
          {e.name}
        </option>
      ))}
    </select>
  ) : null;
}
```

- [ ] **Step 3: RTL green; full gates, commit, push, CI.**

```bash
git commit -m "feat: feature bag ui — add/remove from closed pool with weight-0 entry"
```

---

### Task 6: Form UI — definitions accordion + median prefill

**Files:**

- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx`
- Test: `apps/web/tests/rtl-features-section.test.tsx` (extend)

**Interfaces:**

- Consumes: `medianAreaM2`, `powierzchniaDefinitions` (Task 1).
- Produces: per-feature `<details>` editor for `features.<i>.definitions.<level>`; powierzchnia definitions auto-track the sample median until first manual edit (`powDefsEdited` ref — the Slice-6 "seeded" pattern).

- [ ] **Step 1: Write failing RTL tests** (append to `rtl-features-section.test.tsx`):

```tsx
describe("features section — rating-scale definitions (Slice 7)", () => {
  it("shows editable default definitions per level", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    await user.click(screen.getByTestId("feature-defs-summary-standard-wykonczenia"));
    const input = screen.getByTestId("feature-def-standard-wykonczenia-lepsza") as HTMLInputElement;
    expect(input.value).toBe("standard dobry, wykończenie materiałami lepszej jakości");
  });

  it("prefills powierzchnia definitions from the sample area median and re-tracks it", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    // Comparable-area inputs carry NO labels (advisor finding #5) — target
    // their ids (#comparable-area-N, see new-valuation-form.tsx ~:527). Do
    // NOT use the subject "Powierzchnia (m²)" label — that field is the
    // SUBJECT area and never feeds the median.
    const areaInput = (i: number) =>
      document.querySelector(`#comparable-area-${i}`) as HTMLInputElement;
    const areas = [areaInput(0), areaInput(1), areaInput(2)];
    await user.type(areas[0], "50");
    await user.type(areas[1], "60");
    await user.type(areas[2], "70");
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toContain("60");
    // median changes → prefill follows (not yet edited)
    await user.clear(areas[2]);
    await user.type(areas[2], "90");
    expect(lepsza.value).toContain("60"); // median of 50,60,90 is still 60
    await user.clear(areas[1]);
    await user.type(areas[1], "80");
    expect(lepsza.value).toContain("80"); // median of 50,80,90
  });

  it("a manual edit freezes the powierzchnia definitions against later sample changes", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    await user.type(lepsza, "własny próg rzeczoznawcy");
    const area0 = document.querySelector("#comparable-area-0") as HTMLInputElement;
    await user.type(area0, "55");
    expect(lepsza.value).toContain("własny próg rzeczoznawcy");
  });
});
```

(Adjust the comparable-area selector to the actual aria-label/name used by the form's comparables rows — check the existing markup around line 527.)

Run → FAIL.

- [ ] **Step 2: Implement.** In `new-valuation-form.tsx`:

(a) imports: add `medianAreaM2, powierzchniaDefinitions` to the `@/domain/feature-presets` import; add `useEffect` to the react import if missing;

(b) state + median (near `areaSeededFromKw`):

```ts
// Slice 7 (Slice-6 "seeded" pattern): powierzchnia definitions track the
// sample median until the appraiser edits them — then they freeze.
const powDefsEdited = useRef(false);
```

(c) prefill effect (after the `weightsBalanced` block):

```ts
const comparableAreas = (comparables ?? [])
  .map((c) => Number(c?.area))
  .filter((a) => Number.isFinite(a) && a > 0);
const areasKey = comparableAreas.join(",");
useEffect(() => {
  if (powDefsEdited.current) return;
  const current = getValues("features") ?? [];
  const idx = current.findIndex((f) => f?.key === "powierzchnia-uzytkowa");
  if (idx < 0) return;
  const defs = powierzchniaDefinitions(medianAreaM2(comparableAreas));
  setValue(`features.${idx}.definitions`, {
    lepsza: defs.lepsza ?? "",
    przecietna: "",
    gorsza: defs.gorsza ?? "",
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- areasKey is the dependency proxy for comparableAreas
}, [areasKey]);
```

(d) definitions row — inside `featureFields.map`, return a `<Fragment key={field.id}>` wrapping the existing `<TableRow>` plus a second row (import `Fragment` from react; move `key` off the inner rows):

```tsx
<TableRow>
  <TableCell colSpan={4} className="py-0">
    <details>
      <summary
        data-testid={`feature-defs-summary-${features?.[index]?.key ?? index}`}
        className="cursor-pointer py-1.5 text-xs text-muted-foreground"
      >
        Definicje skali ocen — {field.name}
      </summary>
      <div className="flex flex-col gap-2 pb-3">
        {(["lepsza", "przecietna", "gorsza"] as const).map((level) => (
          <Controller
            key={level}
            control={control}
            name={`features.${index}.definitions.${level}`}
            render={({ field: defField }) => (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">
                  {level === "przecietna" ? "przeciętna" : level}
                </span>
                <Input
                  data-testid={`feature-def-${features?.[index]?.key ?? index}-${level}`}
                  placeholder="puste pole — poziom nie pojawi się w operacie"
                  name={defField.name}
                  onBlur={defField.onBlur}
                  ref={defField.ref}
                  value={toInputValue(defField.value)}
                  onChange={(e) => {
                    if (features?.[index]?.key === "powierzchnia-uzytkowa") {
                      powDefsEdited.current = true;
                    }
                    defField.onChange(e.target.value);
                  }}
                />
              </label>
            )}
          />
        ))}
      </div>
    </details>
  </TableCell>
</TableRow>
```

- [ ] **Step 3: RTL green; full suite; full gates, commit, push, CI.**

```bash
git commit -m "feat: rating-scale definitions editor with sample-median powierzchnia prefill"
```

---

### Task 7: Document model — skala_ocen + weight-0 filter (LOCAL commit, NO push)

**Files:**

- Modify: `apps/web/src/domain/document-model.ts` (`DocumentModel`, `buildDocumentModel`)
- Test: `apps/web/tests/document-model-skala.test.ts` (NEW)

**Interfaces:**

- Consumes: `Feature.definitions` (Task 1/2).
- Produces: `DocumentModel.skala_ocen: Array<{ cecha: string; poziomy: Array<{ poziom: string; def: string }> }>`; `cechy`/`opis_cmin`/`opis_cmax`/`opis_przedmiot` now include ONLY weight > 0 features. Template tags (Task 8 contract): `{#skala_ocen}{cecha}` / nested `{#poziomy}{poziom} – {def}{/poziomy}` / `{/skala_ocen}`.

- [ ] **Step 1: Write failing model tests** — `apps/web/tests/document-model-skala.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { computeKcs, type KcsInput } from "../src/domain/kcs";

function inputsWith(features: KcsInput["features"]): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i * 10,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features,
    sampleMeta: null,
    provenance: null,
  };
}

function modelWith(features: KcsInput["features"]) {
  const inputs = inputsWith(features);
  return buildDocumentModel({
    address: "ul. Przykładowa 1, Poznań",
    area: 50,
    purpose: "sprzedaz",
    kwNumber: "AB1C/1/1",
    client: "Klient Testowy",
    inspectionDate: "2026-07-01",
    approvedAt: new Date("2026-07-02T00:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "testowa kwota słownie",
  });
}

describe("document model — skala ocen (Slice 7)", () => {
  it("maps only non-empty levels, in lepsza→przeciętna→gorsza order, with Polish labels", () => {
    const m = modelWith([
      {
        name: "położenie na piętrze",
        weight: 1,
        rating: "przecietna",
        key: "polozenie-na-pietrze",
        definitions: { gorsza: "parter", lepsza: "czwarte piętro i powyżej" },
      },
    ]);
    expect(m.skala_ocen).toEqual([
      {
        cecha: "położenie na piętrze",
        poziomy: [
          { poziom: "lepsza", def: "czwarte piętro i powyżej" },
          { poziom: "gorsza", def: "parter" },
        ],
      },
    ]);
  });

  it("uses the label 'przeciętna' (diacritics) for the przecietna level", () => {
    const m = modelWith([
      {
        name: "standard wykończenia",
        weight: 1,
        rating: "przecietna",
        definitions: { przecietna: "standard dobry" },
      },
    ]);
    expect(m.skala_ocen[0]!.poziomy).toEqual([{ poziom: "przeciętna", def: "standard dobry" }]);
  });

  it("legacy features without definitions → empty skala_ocen (honest silence)", () => {
    const m = modelWith([{ name: "lokalizacja", weight: 1, rating: "lepsza" }]);
    expect(m.skala_ocen).toEqual([]);
  });

  it("weight-0 features are excluded from cechy, opis_* and skala_ocen (defensive shield)", () => {
    const m = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "opis" } },
      {
        name: "rodzaj zabudowy budynku",
        weight: 0,
        rating: "przecietna",
        definitions: { lepsza: "nie powinno się drukować" },
      },
    ]);
    expect(m.cechy.map((c) => c.nazwa)).toEqual(["lokalizacja"]);
    expect(m.opis_przedmiot).toHaveLength(1);
    expect(m.opis_cmin).toHaveLength(1);
    expect(m.opis_cmax).toHaveLength(1);
    expect(m.skala_ocen.map((r) => r.cecha)).toEqual(["lokalizacja"]);
  });

  it("a feature whose definitions are all empty strings contributes no skala_ocen row", () => {
    const m = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "  " } },
    ]);
    expect(m.skala_ocen).toEqual([]);
  });
});
```

Run: `pnpm --filter web exec vitest run tests/document-model-skala.test.ts` → FAIL (`skala_ocen` undefined).

- [ ] **Step 2: Implement** in `apps/web/src/domain/document-model.ts`:

(a) add next to `RATING_TEXT`:

```ts
/** Document label per rating level — the internal enum stays diacritic-free. */
const LEVEL_LABEL: Record<FeatureRating, string> = {
  lepsza: "lepsza",
  przecietna: "przeciętna",
  gorsza: "gorsza",
};

/** Document order of rating levels in the §12.1 scale block. */
const LEVEL_ORDER: FeatureRating[] = ["lepsza", "przecietna", "gorsza"];
```

(b) add to `DocumentModel` (after `opis_przedmiot`):

```ts
/** §12.1 rating-scale definitions — one row per active feature; only non-empty levels print. */
skala_ocen: Array<{ cecha: string; poziomy: Array<{ poziom: string; def: string }> }>;
```

(c) in `buildDocumentModel`, before the `return`, compute the active set:

```ts
// Weight-0 features stay out of the legal document entirely (workshop
// decision: "pancerz obronny" — a zero-weight row invites challenge).
const activeFeatures = inputs.features.filter((f) => f.weight > 0);
const activeUi = kcs.ui.filter((f) => f.weight > 0);
```

then replace `cechy: kcs.ui.map(…)` with `cechy: activeUi.map(…)` (body unchanged), replace the three `opis_*` mappings' `inputs.features` with `activeFeatures`, and add:

```ts
    skala_ocen: activeFeatures
      .map((f) => ({
        cecha: f.name,
        poziomy: LEVEL_ORDER.filter((level) => f.definitions?.[level]?.trim()).map((level) => ({
          poziom: LEVEL_LABEL[level],
          def: f.definitions![level]!.trim(),
        })),
      }))
      .filter((row) => row.poziomy.length > 0),
```

- [ ] **Step 3: Model tests GREEN; run the full suite** — `f12-document-sections.test.ts` must still pass (the template has no `{#skala_ocen}` yet; docxtemplater ignores unused model keys).

- [ ] **Step 4: Commit LOCALLY — do NOT push** (pushes together with Task 8, Slice-5 T7+T8 convention):

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git add apps/web/src/domain/document-model.ts apps/web/tests/document-model-skala.test.ts
git commit -m "feat: document model — skala_ocen rows + weight-0 feature filter"
```

---### Task 8: Template §12.1 parameterization + F-12 extension (pushes Task 7 + 8)

**Files:**

- Modify (wiki repo, stays UNCOMMITTED there): `/Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna/build_template.py`
- Regenerate: `apps/web/templates/operat-szablon.docx`, `apps/web/src/domain/operat-sections.ts` (builder output — headings expected unchanged)
- Modify: `apps/web/tests/f12-template-integrity.test.ts`, `apps/web/tests/f12-document-sections.test.ts`

**Interfaces:**

- Consumes: `DocumentModel.skala_ocen` (Task 7).
- Produces: template tags `{#skala_ocen}{cecha}`, `{#poziomy}{poziom} – {def}{/poziomy}`, `{/skala_ocen}`; the ADR-006 short weights sentence as a template literal; F-12 guards all of it.

- [ ] **Step 1: RED — extend F-12 integrity first.** In `apps/web/tests/f12-template-integrity.test.ts`:

append to `FORBIDDEN_LITERALS` (the Kościelna scale texts must never return):

```ts
  // Task 8 (Slice 7): §12.1 rating-scale definitions are parameterized — the
  // source operat's hardcoded scale texts must never ship in the template.
  "poniżej 65 m2",
  "4 piętro i powyżej",
  "prawo do wyłącznego korzystania z miejsca postojowego",
```

append to `REQUIRED_PLACEHOLDERS`:

```ts
  // Task 8 (Slice 7): §12.1 rating-scale loop.
  "{#skala_ocen}",
  "{/skala_ocen}",
  "{#poziomy}",
  "{/poziomy}",
  "{cecha}",
  "{poziom}",
  "{def}",
```

add after the placeholders test:

```ts
// ADR-006 (AC-8): the honest weights-methodology sentence must be present —
// the r² claim was removed in Slice 4; this is its truthful replacement.
it("contains the honest weights-methodology sentence (ADR-006 short variant)", () => {
  expect(templateText()).toContain(
    "Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego",
  );
});
```

Run: `pnpm --filter web exec vitest run tests/f12-template-integrity.test.ts` → FAIL (template not regenerated yet). This is the expected RED.

- [ ] **Step 2: Extend the wiki-repo builder.** **The §12.1 rating-scale block is a 5×2 TABLE** (advisor finding #2 — verified on the current template): column 1 = feature name, column 2 = one paragraph per level; rows = Standard/Piętro/Powierzchnia/Dodatkowe/Lokalizacja. Do NOT treat it as body paragraphs. Transform the table exactly like `parameterize_tabela3` collapses Tabela 3 (row-spanning loop: opener in the first cell, closer at the end of the last cell), with the nested `{#poziomy}` loop as **standalone paragraphs inside the cell** — an INLINE `{#poziomy}…{/poziomy}` would render run-on text (the `dzial3_wpisy` lesson; see `loop_opis_lists`'s docstring).

In `build_template.py` (use the file's existing helpers — `table_by_first_cell`, `set_cell_text`, `para_text`, `insert_paras_after`, `check`; adapt to its idioms):

Add near the other stage data:

```python
PROZA_WAG = (
    "Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego oraz "
    "wiedzy i doświadczenia zawodowego rzeczoznawcy majątkowego, odzwierciedlając "
    "wpływ poszczególnych atrybutów na jednostkowe ceny transakcyjne "
    "nieruchomości podobnych."
)
```

Add the stage function:

```python
def parameterize_skala_ocen(doc, body):
    """§12.1: the rating-scale block is a 5x2 TABLE (col 1 = feature name,
    col 2 = one paragraph per level, hardcoded Kościelna texts). Collapse it
    into a {#skala_ocen} row loop with a nested MULTI-PARAGRAPH {#poziomy}
    loop (inline nesting would render run-on text — dzial3_wpisy lesson),
    then insert the honest weights sentence (ADR-006 short variant) after the
    §12.1 feature-selection paragraph (NOT after the 'Źródło' caption — five
    identical captions exist, that anchor is ambiguous, and its style would
    leak into the prose via insert_paras_after's deepcopy)."""
    tbl = table_by_first_cell(doc, "Standard wykończenia", "skala ocen table")
    check(len(tbl.rows) == 5, f"skala ocen table: {len(tbl.rows)} rows (expected 5)")
    row0 = tbl.rows[0]
    set_cell_text(row0.cells[0], "{#skala_ocen}{cecha}")
    cell = row0.cells[1]
    for p in list(cell.paragraphs):
        p._p.getparent().remove(p._p)
    for text in ("{#poziomy}", "{poziom} – {def}", "{/poziomy}", "{/skala_ocen}"):
        cell.add_paragraph(text)
    deleted = 0
    for row in list(tbl.rows)[1:]:
        row._tr.getparent().remove(row._tr)
        deleted += 1
    check(deleted == 4, f"skala ocen table: {deleted} extra feature rows deleted (expected 4)")
    paras = [p for p in body if p.tag.endswith("}p")]
    anchors = [
        p for p in paras
        if para_text(p).strip().startswith(
            "Na podstawie analizy transakcji lokali o funkcji mieszkalnej")
    ]
    check(len(anchors) == 1, f"skala ocen: {len(anchors)} feature-selection anchor(s) (expected 1)")
    insert_paras_after(body, anchors[0], [PROZA_WAG], "weights prose (ADR-006 short variant)")
```

Call it from `main()` (after the existing §12-area stages, before verify/save), extend `PLACEHOLDERS` with the 7 new tags, `TEST_FORBIDDEN` with the same 3 literals as the app test, and add to `verify()`:

```python
    check("Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego" in text,
          "weights prose present (ADR-006)")
```

- [ ] **Step 3: Regenerate the template.** Run the builder per the spike README (interpreter noted there — `python3 build_template.py` or the spike venv) inside `tools/spike/2026-07-15-template-koscielna/`. Its verify stage must print all-green checks. Confirm it wrote `apps/web/templates/operat-szablon.docx` + regenerated `apps/web/src/domain/operat-sections.ts` (headings diff expected EMPTY — `git diff` on that file should be empty or whitespace-identical; §12.1 heading text is unchanged).

- [ ] **Step 4: Extend the render-completeness test.** In `apps/web/tests/f12-document-sections.test.ts`, give `goldenInputs` features keys + synthetic definitions (deliberately NOT the Kościelna texts):

```ts
    features: [
      {
        name: "standard wykończenia",
        weight: 0.4,
        rating: "przecietna" as const,
        key: "standard-wykonczenia",
        definitions: {
          lepsza: "wykończenie materiałami wyższej klasy",
          przecietna: "wykończenie w dobrym stanie",
        },
      },
      {
        name: "położenie na piętrze",
        weight: 0.3,
        rating: "lepsza" as const,
        key: "polozenie-na-pietrze",
        definitions: {
          lepsza: "czwarte piętro i powyżej",
          przecietna: "piętra pośrednie",
          gorsza: "parter",
        },
      },
      {
        name: "lokalizacja",
        weight: 0.3,
        rating: "gorsza" as const,
        key: "lokalizacja",
        definitions: { lepsza: "bliskość punktów usługowych" },
      },
    ],
```

and add asserts in the main render test:

```ts
// Slice 7: §12.1 prints THIS valuation's scale definitions + honest weights prose.
expect(text).toContain("lepsza – czwarte piętro i powyżej");
expect(text).toContain("przeciętna – piętra pośrednie");
expect(text).toContain("Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego");
expect(text).not.toContain("poniżej 65 m2");
// Anti-run-on (dzial3_wpisy lesson): an INLINE {#poziomy} loop would glue
// consecutive levels together — the nested loop must render one paragraph
// per level (advisor finding #2).
expect(text).not.toMatch(/powyżejprzeciętna|pośredniegorsza/);
```

If the file has a legacy-variant render test (inputs without definitions), assert it still renders with no unresolved tags (existing assertion covers it — the loop renders empty).

- [ ] **Step 5: All F-12 legs GREEN**

Run: `pnpm --filter web exec vitest run tests/f12-template-integrity.test.ts tests/f12-document-sections.test.ts tests/document-model-skala.test.ts`
Expected: PASS.

- [ ] **Step 6: Full gates; commit app repo; push BOTH commits (T7+T8); CI.** Wiki-repo `build_template.py` stays uncommitted (verify with `git -C /Users/michalczekala/Development/wyceny status` — modified, not staged).

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git add apps/web/templates/operat-szablon.docx apps/web/src/domain/operat-sections.ts apps/web/tests/f12-template-integrity.test.ts apps/web/tests/f12-document-sections.test.ts
git commit -m "feat: operat 12.1 — parameterized rating-scale loop + honest weights prose (f-12)"
git push   # publishes Task 7 + Task 8
gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'  # then: gh run watch <id> --exit-status
```

---

## Out of plan scope (carry-forward candidates for the ledger)

- Auto-ratings of comparable transactions (FR-FEAT-05, §11 table) — NEXT candidate (UI wizard slice).
- Extrapolation beyond the scale (NI 6.4) — LATER (roadmap).
- 2/4-level scale editor; admin settings screen (FR-10/E9); dom/działka bags — LATER.
- Soft warning when a used rating has no definition (spec: świadome cięcie) — backlog.
- Median-prefill race window (advisor finding #7, consciously accepted): the powierzchnia
  definitions are written by a post-render effect; a submit in the same tick could send
  stale texts, making the server classify an untouched preset as `rzeczoznawca/confirmed`
  (a MISSING to_verify blocker, not a false one). Narrow window, human typing can't hit it;
  revisit if e2e/QA ever observes it.
- RTL coverage for the detail-page FeaturesCard — consistent with the existing SubjectCard/KwCard RTL gap (backlog, priority raised in Slice 5).
- e2e smoke leaves drafts unapproved, so the new preset blocker does not affect it; a dedicated e2e approving through "Potwierdź cechy i wagi" is deferred to the wizard slice.

## Post-plan verification (S4/S5 hooks)

- CI green on main with F-6 + extended F-12 after Task 8.
- Deploy (S5): web only (`vercel deploy --prod` from monorepo root); NO worker deploy, NO migration, NO new secrets.
- Prod QA per spec DoD: (1) modified bag E2E → DOCX; (2) pure defaults → blocker → confirm → DOCX with median threshold; (3) golden Kościelna regression 1 044 400 zł; (4) legacy valuations render unchanged.
