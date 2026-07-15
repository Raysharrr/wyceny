# Document Generator (Slice 4, DOCX→PDF, F-12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From an **approved** valuation, generate a complete operat szacunkowy (≥19 KSWN sections) as DOCX + PDF from Aneta's real template, with professional-secrecy masking enforced by a new F-12 fitness function in CI.

**Architecture:** Pure domain function `buildDocumentModel` (computeKcs + masking + formatting) → docxtemplater render in web (adapter, pure JS — the proven spike path) → new worker endpoint `/convert-to-pdf` (LibreOffice headless in the Railway container) → both files stored in Postgres (`document.content_bytes`) behind the unchanged `PortStorage`. Generation happens synchronously inside the approve action; invariant: **approved ⇔ operat exists**.

**Tech Stack:** Next.js 16.2.9 (App Router, Server Actions), docxtemplater ^3.69.0 + pizzip ^3.2.0 + angular-expressions ^1.5.5, Drizzle 0.45.2 (customType bytea), FastAPI + LibreOffice (soffice) + fonts-crosextra-carlito, vitest + pytest + Playwright.

**Spec:** `docs/superpowers/specs/2026-07-15-document-generator-design.md`. Spike (template feasibility, PASS): wiki repo `~/Development/wyceny/tools/spike/2026-07-15-template-koscielna/` (RAPORT.md there is required reading for Tasks 1-2).

## Global Constraints

- Code + commits: English. Conventional commits, commitlint header ≤100 chars, lefthook runs prettier on commit.
- UI copy + operat content: Polish, full diacritics.
- No network calls in tests/CI (mock `fetch`; LibreOffice runs locally in CI).
- Per-task verification (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` from repo root. Worker: `cd apps/worker && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
- F-10: `src/domain/` and `packages/shared` import NO adapters/db/framework code. New domain files must stay pure.
- **F-9 trap:** the CI PII scan greps ALL tracked text files for 11-digit runs and KW-shaped strings (`[A-Z]{2}[0-9][A-Z]/[0-9]{8}/[0-9]`). NEVER put a realistically-formatted KW number or an 11-digit number in any code, test, fixture, or doc. Use e.g. `"KW-TEST-1"` as test KW values.
- zod pinned 4.4.3 (pnpm override). Node 22, Python 3.12.
- Framework APIs verified via context7, not memory (already done for: Drizzle bytea → use `customType`; Next `maxDuration` → page-level export covers Server Actions).
- `wr` TS field maps to physical column `stub_wr` (rename deferred) — do not "fix" this.

## Placeholder Contract (single source of truth)

Template placeholders ↔ `DocumentModel` fields. Tasks 1-2 put these tags in the template; Task 3 builds exactly this object; Task 4's tests assert the rendered output. Number formats: `formatPln` = 2dp, comma decimal, NBSP (` `) thousands separator (e.g. `1 044 400,00`); `formatNumber(v, dp)` same grouping.

| Placeholder                                                              | Model field                          | Example value                                                      |
| ------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------ |
| `{adres}`                                                                | `adres`                              | `ul. Kościelna 33, Poznań`                                         |
| `{powierzchnia}`                                                         | `powierzchnia`                       | `71,63`                                                            |
| `{cel}`                                                                  | `cel`                                | `dla potrzeb sprzedaży`                                            |
| `{nr_kw}`                                                                | `nr_kw`                              | (user-entered KW string)                                           |
| `{klient}`                                                               | `klient`                             | `p. Jan Kowalski`                                                  |
| `{data_ogledzin}`                                                        | `data_ogledzin`                      | `01.04.2026` (any literal `r.` stays in template, outside the tag) |
| `{data_sporzadzenia}`                                                    | `data_sporzadzenia`                  | `15.07.2026`                                                       |
| `{wr}`                                                                   | `wr`                                 | `1 044 400,00`                                                     |
| `{wr_slownie}`                                                           | `wr_slownie`                         | `jeden milion … złotych zero groszy`                               |
| `{wr_dokladna}`                                                          | `wr_dokladna`                        | `1 044 388,32`                                                     |
| `{cena_min}` `{cena_max}` `{cena_sr}`                                    | `cena_min/max/sr`                    | `12 061,94`                                                        |
| `{polozenie_sr}`                                                         | `polozenie_sr`                       | `0,380`                                                            |
| `{vmin}` `{vmax}`                                                        | `vmin/vmax`                          | `0,920` / `1,132`                                                  |
| `{suma_ui}`                                                              | `suma_ui`                            | `1,111`                                                            |
| `{cena_1m2}`                                                             | `cena_1m2`                           | `14 580,32`                                                        |
| `{#transakcje}{data_msc}{miasto}{ulica}{pow}{cena_jedn}{/transakcje}`    | `transakcje: TransactionRow[]`       | month `2024-07`, city, `—`, `63,27`, `14 698,91`                   |
| `{#cechy}{nazwa}{waga_pct}{ui_min}{ui_sr}{ui_max}{ui_przedmiot}{/cechy}` | `cechy: FeatureRow[]`                | `standard wykończenia`, `40`, `0,368`, `0,400`, `0,453`, `0,453`   |
| `{#opis_cmin}{.}{/opis_cmin}` (same for `opis_cmax`, `opis_przedmiot`)   | `opis_cmin/cmax/przedmiot: string[]` | `standard wykończenia – wartość najniższa cechy,`                  |
| `{#kredyt}…{/kredyt}`                                                    | `kredyt: boolean`                    | credit clause paragraphs                                           |

---

### Task 1: Production template v1 — scrub + core placeholders + integrity test

The spike produced `template.docx` (wiki repo `tools/spike/2026-07-15-template-koscielna/`) with placeholders for: nr_kw, wr, wr_slownie, powierzchnia, klient, cel, data_sporzadzenia, data_ogledzin, the `{#transakcje}` row loop and the `{#kredyt}` block. This task turns it into the committed production artifact: add `{adres}`, remove ALL remaining Kościelna-specific content (PII, photos, r² sentence, property prose), and lock it with an integrity test. Read the spike's `RAPORT.md` + `convert.py` first — reuse its run-level/collapse replacement machinery and positional anchoring (global find-replace is forbidden; the same literal plays different roles).

**Files:**

- Create: `apps/web/templates/operat-szablon.docx` (binary artifact, committed)
- Create: `apps/web/src/domain/operat-sections.ts` (generated heading list)
- Create: `apps/web/tests/f12-template-integrity.test.ts`
- Create (wiki repo, NOT committed by this task): `~/Development/wyceny/tools/spike/2026-07-15-template-koscielna/build_template.py` (extends `convert.py`)

**Interfaces:**

- Produces: `OPERAT_SECTIONS: readonly string[]` (≥19 numbered section headings, exact strings as they appear in the template) — consumed by Task 4's section-completeness test.
- Produces: the template artifact consumed by Task 4's renderer.

- [ ] **Step 1: Write the failing integrity test**

`apps/web/tests/f12-template-integrity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { OPERAT_SECTIONS } from "../src/domain/operat-sections";

/**
 * F-12 (template leg): the committed production template must be scrubbed —
 * no PII from the source operat (PESEL, owner names, KW number), no
 * Kościelna-specific literals (they would leak into every generated operat),
 * no r² claim (the engine does not compute r²), and every placeholder from
 * the contract present. The .docx is a ZIP (binary to git grep), so F-9's
 * repo scan can NOT see inside it — this test is the enforcement.
 */
const TEMPLATE = path.join(process.cwd(), "templates", "operat-szablon.docx");

function templateXml(): string {
  const zip = new PizZip(fs.readFileSync(TEMPLATE));
  return Object.keys(zip.files)
    .filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f))
    .map((f) => zip.files[f].asText())
    .join("\n");
}

/** Visible text only — strips XML tags so placeholder checks match what docxtemplater parses. */
function templateText(): string {
  return templateXml().replace(/<[^>]+>/g, "");
}

const FORBIDDEN_LITERALS = [
  "Kościeln", // any case form of the source street/property
  "Rajewsk", // source clients' surname
  "7163/468337", // source building share
  "26.03.2026",
  "01.04.2026",
  "korelacji", // the r² methodology sentence must be gone
];

const REQUIRED_PLACEHOLDERS = [
  "{adres}",
  "{powierzchnia}",
  "{cel}",
  "{nr_kw}",
  "{klient}",
  "{data_ogledzin}",
  "{data_sporzadzenia}",
  "{wr}",
  "{wr_slownie}",
  "{#transakcje}",
  "{/transakcje}",
  "{#kredyt}",
  "{/kredyt}",
];

describe("F-12: template integrity (operat-szablon.docx)", () => {
  it("contains no PESEL-like or KW-shaped strings anywhere in the XML", () => {
    const xml = templateXml();
    expect(xml).not.toMatch(/\d{11}/);
    expect(xml).not.toMatch(/[A-Z]{2}\d[A-Z]\s*\/\s*\d{8}\s*\/\s*\d/);
  });

  it("contains no source-operat literals", () => {
    const text = templateText();
    for (const lit of FORBIDDEN_LITERALS) {
      expect(text, `forbidden literal "${lit}" still in template`).not.toContain(lit);
    }
  });

  it("contains every contract placeholder", () => {
    const text = templateText();
    for (const ph of REQUIRED_PLACEHOLDERS) {
      expect(text, `missing placeholder ${ph}`).toContain(ph);
    }
  });

  it("has at least 19 canonical section headings, all present in the template", () => {
    expect(OPERAT_SECTIONS.length).toBeGreaterThanOrEqual(19);
    const text = templateText();
    for (const heading of OPERAT_SECTIONS) {
      expect(text, `missing section heading "${heading}"`).toContain(heading);
    }
  });
});
```

- [ ] **Step 2: Add pizzip dev usage + placeholder domain file, run test to verify it fails**

Add dependencies in `apps/web` (pizzip is needed by tests now, docxtemplater/angular-expressions land in Task 4 — install all three at once to avoid a second lockfile churn):

Run: `pnpm --filter web add docxtemplater@^3.69.0 pizzip@^3.2.0 angular-expressions@^1.5.5`

Create a stub `apps/web/src/domain/operat-sections.ts`:

```ts
/**
 * Canonical operat section headings (F-12: ≥19 sections, no gaps).
 * GENERATED from the production template by
 * tools/spike/2026-07-15-template-koscielna/build_template.py (wiki repo) —
 * regenerate when the template changes; do not hand-edit strings.
 */
export const OPERAT_SECTIONS: readonly string[] = [];
```

Run: `pnpm --filter web test -- f12-template-integrity`
Expected: FAIL (template file missing / sections empty).

- [ ] **Step 3: Build the production template (wiki repo pipeline)**

Work in `~/Development/wyceny/tools/spike/2026-07-15-template-koscielna/`. Create `build_template.py` importing the replacement helpers from `convert.py` (run-level replace, paragraph-collapse, anchored replacement). Input: the spike's `template.docx` (already has the core placeholders). Transformations, in order:

1. **`{adres}`**: anchored run-level replacement of the source address literals (title page "przy ul. …" line and every other occurrence of the full address). Sweep for both forms ("ul. Kościelnej 33" i "ul. Kościelna 33").
2. **PII / eKW reduction**: locate the eKW dump tables (the merged-cell tables containing owner data). Delete those tables entirely; insert in their place one paragraph: `Oznaczenie księgi wieczystej: {nr_kw}. Pełna treść odpisu KW pozostaje w dokumentacji źródłowej rzeczoznawcy.` (Deleting `<w:tbl>` elements via lxml; keep surrounding section headings.)
3. **r²**: delete the whole sentence mentioning "współczynniki korelacji"/"[r2]" from the methodology paragraph (section 12.2 area). Keep the rest of the paragraph.
4. **Images**: remove all property-specific images (photos, map cutouts) — delete `<w:drawing>` elements EXCEPT the office logo and the stamp/signature graphic on the title page (identify by position: title-page header/footer stays; body images go). Where a removed image leaves an empty "Zdjęcia"/"mapa" section, insert stub text: `Dokumentacja fotograficzna i kartograficzna zostanie uzupełniona po oględzinach.`
5. **Property-specific prose**: sweep `word/document.xml` text for every remaining source-specific literal — checklist: `Kościeln`, `Rajewsk`, `7163/468337`, `lokalowej nr 36`, `71,6300`, `71,63`, source dates, source prices not inside the transactions table (Tabela 2/4 values stay for now — Task 2 parameterizes them). Replace property-description prose paragraphs (section 1 apartment description, 8.1 location detail, 8.3 technical condition, 11 market analysis) with neutral template text, e.g. 8.3: `Stan techniczny lokalu przyjęto na podstawie oświadczenia zamawiającego oraz przeglądu dostępnej dokumentacji. Szczegółowy opis zostanie uzupełniony po oględzinach.` Keep generic Poznań/legal boilerplate untouched.
6. **Heading extraction**: print every paragraph whose text matches `^\d+(\.\d+)*\.?\s+\S` (numbered headings). Verify count ≥19; paste the exact strings into `apps/web/src/domain/operat-sections.ts`.
7. Save as `operat-szablon.docx`; copy to `apps/web/templates/operat-szablon.docx`.

Sanity-render after building: `node render.js` against the new template with the spike's `data.json` extended by `adres` — must produce no `undefined` and no leftover tags (reuse `check.py`).

- [ ] **Step 4: Fill `operat-sections.ts` with the extracted headings, run test to verify it passes**

Run: `pnpm --filter web test -- f12-template-integrity`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Full verification + commit**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: green (other suites untouched).

```bash
git add apps/web/templates/operat-szablon.docx apps/web/src/domain/operat-sections.ts apps/web/tests/f12-template-integrity.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat: production operat template v1 with F-12 integrity test"
```

---

### Task 2: Production template v2 — KCS tables + description loops

Parameterize the calculation tables (Tabela 2, 3, 4) and the section-12.2 description lists in `operat-szablon.docx`, per the Placeholder Contract. Same pipeline (`build_template.py` in the wiki repo), same integrity test extended.

**Files:**

- Modify: `apps/web/templates/operat-szablon.docx` (rebuilt artifact)
- Modify: `apps/web/tests/f12-template-integrity.test.ts`
- Modify (wiki repo): `build_template.py`

**Interfaces:**

- Produces: template with the FULL placeholder contract — Task 4 renders it with the complete `DocumentModel`.

- [ ] **Step 1: Extend the integrity test (failing)**

In `f12-template-integrity.test.ts` extend `REQUIRED_PLACEHOLDERS`:

```ts
const REQUIRED_PLACEHOLDERS = [
  "{adres}",
  "{powierzchnia}",
  "{cel}",
  "{nr_kw}",
  "{klient}",
  "{data_ogledzin}",
  "{data_sporzadzenia}",
  "{wr}",
  "{wr_slownie}",
  "{wr_dokladna}",
  "{cena_min}",
  "{cena_max}",
  "{cena_sr}",
  "{polozenie_sr}",
  "{vmin}",
  "{vmax}",
  "{suma_ui}",
  "{cena_1m2}",
  "{#transakcje}",
  "{/transakcje}",
  "{#cechy}",
  "{/cechy}",
  "{#opis_cmin}",
  "{#opis_cmax}",
  "{#opis_przedmiot}",
  "{#kredyt}",
  "{/kredyt}",
];
```

And extend `FORBIDDEN_LITERALS` with the now-parameterized source values:

```ts
  "12 061,94",
  "14 852,90",
  "13 123,60",
  "14 580,32",
  "1 044 388,32",
  "1 044 400,00",
```

(Write them with a normal space here; add a comment and normalize NBSP→space in `templateText()` before matching: `.replace(/ /g, " ")`.)

Run: `pnpm --filter web test -- f12-template-integrity`
Expected: FAIL (new placeholders missing).

- [ ] **Step 2: Extend `build_template.py`**

1. **Tabela 2** (Ceny jednostkowe): anchored replacement of the six value cells → `{cena_min}`, `{cena_max}`, `{cena_sr}`, `{polozenie_sr}`, `{vmin}`, `{vmax}` (anchor = the label cell text in the same row, e.g. "Cena minimalna").
2. **Tabela 3** (współczynniki korygujące): convert the five feature rows into ONE template row with `{#cechy}` at the start of the first cell and `{/cechy}` at the end of the last cell: cells `{nazwa}`, `{waga_pct}%`, `{ui_min}`, `{ui_sr}`, `{ui_max}`, `{ui_przedmiot}`; delete the other four data rows; SUMA row values → `100`, `{vmin}`, `1,000`, `{vmax}`, `{suma_ui}` (anchored by "SUMA").
3. **Tabela 4** (Określenie wartości rynkowej): anchored per-row → `{cena_sr}`, `{suma_ui}`, `{cena_1m2}`, `{powierzchnia}`, `{wr_dokladna}`, and the final bold cell keeps `{wr}` + `{wr_slownie}` (already placeholdered in the spike).
4. **12.2 descriptions**: the three bullet lists after "Opis lokalu o jednostkowej cenie najwyższej/najniższej/będącego przedmiotem wyceny" — replace each list's bullet paragraphs with one looped paragraph: `{#opis_cmax}{.}{/opis_cmax}` etc. (keep the bullet paragraph style of the first bullet). Also replace the source street sentence above each list (`Lokal mieszkalny położony jest przy ul. Kościelnej w Poznaniu.` → `Lokal mieszkalny położony jest w analizowanym obszarze rynku.`).
5. **Row height**: set an explicit `trHeight` on the `{#transakcje}` template row (copy the height of the original data rows) — spike finding: looped rows render slightly taller in LibreOffice and shift page breaks.
6. Rebuild, sanity-render with extended `data.json` (add `cechy`, `opis_*`, KCS scalar values), re-run heading extraction — if headings changed, refresh `operat-sections.ts`.

- [ ] **Step 3: Run integrity test to verify it passes**

Run: `pnpm --filter web test -- f12-template-integrity`
Expected: PASS.

- [ ] **Step 4: Full verification + commit**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/web/templates/operat-szablon.docx apps/web/tests/f12-template-integrity.test.ts apps/web/src/domain/operat-sections.ts
git commit -m "feat: template v2 - KCS tables and description loops parameterized"
```

---

### Task 3: Domain — document model, masking, formatting (F-12 masking leg)

**Files:**

- Create: `apps/web/src/domain/document-model.ts`
- Test: `apps/web/tests/f12-document-masking.test.ts`

**Interfaces:**

- Consumes: `KcsInput`, `KcsResult`, `computeKcs` from `@/domain/kcs`; `Blocker` from `@/domain/provenance`.
- Produces (for Tasks 4, 8, 9):
  - `type OperatPurpose = "sprzedaz" | "zabezpieczenie_kredytu" | "informacyjny"`
  - `type DocumentModel` (exact shape below)
  - `buildDocumentModel(input: BuildDocumentInput): DocumentModel`
  - `documentFieldBlockers(v: DocumentFields): Blocker[]`
  - `formatPln(value: number): string`, `formatNumber(value: number, dp: number): string`
  - `PURPOSE_LABEL: Record<OperatPurpose, string>` (Polish UI labels for the select)

- [ ] **Step 1: Write the failing tests**

`apps/web/tests/f12-document-masking.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import {
  buildDocumentModel,
  documentFieldBlockers,
  formatNumber,
  formatPln,
} from "../src/domain/document-model";

const NBSP = " ";

/** Synthetic inputs with FULL transaction dates and RCN ids — masking must strip both. */
function syntheticInputs(): KcsInput {
  return {
    area: 54.3,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 12_000 + i * 100,
      date: `2025-03-1${i % 10}`, // full date — must never reach the model
      area: 50 + i,
      source: "rcn" as const,
      transactionId: `rcn-tx-${i}`, // must never reach the model
      status: "confirmed" as const,
    })),
    features: [
      { name: "standard wykończenia", weight: 0.6, rating: "lepsza" as const },
      { name: "lokalizacja", weight: 0.4, rating: "gorsza" as const },
    ],
    sampleMeta: null,
    provenance: null,
  };
}

function buildModel() {
  const inputs = syntheticInputs();
  return buildDocumentModel({
    address: "ul. Testowa 7, Poznań",
    area: 54.3,
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "p. Test Testowy",
    inspectionDate: "2026-07-01",
    approvedAt: new Date("2026-07-15T10:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "sto tysięcy złotych zero groszy",
  });
}

describe("F-12: professional-secrecy masking in the document model", () => {
  it("shows only YYYY-MM for comparable transaction dates", () => {
    const model = buildModel();
    for (const row of model.transakcje) {
      expect(row.data_msc).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("never leaks full dates, transactionIds or provenance internals anywhere in the model", () => {
    const json = JSON.stringify(buildModel());
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no full ISO date survives
    expect(json).not.toContain("rcn-tx-");
    expect(json).not.toContain("transactionId");
    expect(json).not.toContain("to_verify");
  });

  it("maps purpose to Polish document text and drives the credit conditional", () => {
    const model = buildModel();
    expect(model.cel).toBe("dla potrzeb sprzedaży");
    expect(model.kredyt).toBe(false);
    const inputs = syntheticInputs();
    const credit = buildDocumentModel({
      address: "x",
      area: 1,
      purpose: "zabezpieczenie_kredytu",
      kwNumber: "KW-TEST-1",
      client: "k",
      inspectionDate: "2026-07-01",
      approvedAt: new Date("2026-07-15T10:00:00Z"),
      inputs,
      kcs: computeKcs(inputs),
      amountInWords: "słownie",
    });
    expect(credit.kredyt).toBe(true);
  });

  it("formats dates as DD.MM.YYYY and amounts with NBSP grouping + comma decimals", () => {
    const model = buildModel();
    expect(model.data_ogledzin).toBe("01.07.2026");
    expect(model.data_sporzadzenia).toBe("15.07.2026");
    expect(formatPln(1044400)).toBe(`1${NBSP}044${NBSP}400,00`);
    expect(formatNumber(0.92, 3)).toBe("0,920");
    expect(formatNumber(12061.94, 2)).toBe(`12${NBSP}061,94`);
  });

  it("builds one cechy row per feature with Ui range values", () => {
    const model = buildModel();
    expect(model.cechy).toHaveLength(2);
    const [standard] = model.cechy;
    expect(standard.nazwa).toBe("standard wykończenia");
    expect(standard.waga_pct).toBe("60");
    // ui_sr is the bare weight, 3dp
    expect(standard.ui_sr).toBe("0,600");
  });

  it("builds 12.2 description bullets from ratings", () => {
    const model = buildModel();
    expect(model.opis_przedmiot).toEqual([
      "standard wykończenia – wartość najwyższa cechy,",
      "lokalizacja – wartość najniższa cechy,",
    ]);
    expect(model.opis_cmin).toHaveLength(2);
    expect(model.opis_cmin[0]).toContain("wartość najniższa");
    expect(model.opis_cmax[0]).toContain("wartość najwyższa");
  });
});

describe("documentFieldBlockers", () => {
  it("returns one Polish blocker per missing field, empty when complete", () => {
    expect(
      documentFieldBlockers({ purpose: null, kwNumber: null, client: null, inspectionDate: null }),
    ).toHaveLength(4);
    const blockers = documentFieldBlockers({
      purpose: "sprzedaz",
      kwNumber: null,
      client: "k",
      inspectionDate: "2026-07-01",
    });
    expect(blockers).toEqual([{ path: "kwNumber", label: "Numer księgi wieczystej — brak." }]);
    expect(
      documentFieldBlockers({
        purpose: "sprzedaz",
        kwNumber: "KW-TEST-1",
        client: "k",
        inspectionDate: "2026-07-01",
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- f12-document-masking`
Expected: FAIL — module `document-model` not found.

- [ ] **Step 3: Implement `apps/web/src/domain/document-model.ts`**

```ts
import type { KcsInput, KcsResult, FeatureRating } from "./kcs";
import type { Blocker } from "./provenance";

/**
 * Operat document model + professional-secrecy masking (F-12).
 *
 * Pure (F-10: zero I/O, zero adapter imports). Everything the DOCX template
 * needs, pre-formatted as Polish strings — the renderer does string
 * substitution only. Masking happens HERE, in one place: comparable rows
 * expose only month (YYYY-MM), no transactionId, no provenance internals
 * (wyrok SN II CSK 369/11; spec §6).
 */

export type OperatPurpose = "sprzedaz" | "zabezpieczenie_kredytu" | "informacyjny";

/** Document phrase per purpose ("Operat sporządzono {cel}"). */
export const PURPOSE_TEXT: Record<OperatPurpose, string> = {
  sprzedaz: "dla potrzeb sprzedaży",
  zabezpieczenie_kredytu: "dla potrzeb zabezpieczenia wierzytelności kredytodawcy",
  informacyjny: "dla celów informacyjnych",
};

/** Polish UI labels for the create-form select. */
export const PURPOSE_LABEL: Record<OperatPurpose, string> = {
  sprzedaz: "Sprzedaż",
  zabezpieczenie_kredytu: "Zabezpieczenie kredytu",
  informacyjny: "Informacyjny",
};

const RATING_TEXT: Record<FeatureRating, string> = {
  lepsza: "wartość najwyższa cechy",
  przecietna: "wartość pośrednia cechy",
  gorsza: "wartość najniższa cechy",
};

const NBSP = " ";

/** `1044400` → `"1 044 400,00"` (NBSP thousands separator — matches the source operat). */
export function formatPln(value: number): string {
  return formatNumber(value, 2);
}

export function formatNumber(value: number, dp: number): string {
  const [int, frac] = value.toFixed(dp).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return frac ? `${grouped},${frac}` : grouped;
}

/** ISO date (or full ISO datetime) → `DD.MM.YYYY`. */
export function formatDatePl(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

/** F-12 masking: full transaction date → month only; absent → em dash. */
function maskMonth(date: string | undefined): string {
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "—";
}

/** Best-effort city from the subject address ("ul. X 1, Poznań" → "Poznań"). */
function cityFromAddress(address: string): string {
  const afterComma = address.split(",").pop()?.trim();
  return afterComma && afterComma.length > 0 ? afterComma : "—";
}

export type TransactionRow = {
  data_msc: string;
  miasto: string;
  ulica: string;
  pow: string;
  cena_jedn: string;
};

export type FeatureRow = {
  nazwa: string;
  waga_pct: string;
  ui_min: string;
  ui_sr: string;
  ui_max: string;
  ui_przedmiot: string;
};

export type DocumentModel = {
  adres: string;
  powierzchnia: string;
  cel: string;
  nr_kw: string;
  klient: string;
  data_ogledzin: string;
  data_sporzadzenia: string;
  wr: string;
  wr_slownie: string;
  wr_dokladna: string;
  cena_min: string;
  cena_max: string;
  cena_sr: string;
  polozenie_sr: string;
  vmin: string;
  vmax: string;
  suma_ui: string;
  cena_1m2: string;
  kredyt: boolean;
  transakcje: TransactionRow[];
  cechy: FeatureRow[];
  opis_cmin: string[];
  opis_cmax: string[];
  opis_przedmiot: string[];
};

export type DocumentFields = {
  purpose: string | null;
  kwNumber: string | null;
  client: string | null;
  inspectionDate: string | null;
};

/** Approval blockers for document fields (spec §4) — Polish UI copy like the F-4 gate. */
export function documentFieldBlockers(v: DocumentFields): Blocker[] {
  const blockers: Blocker[] = [];
  if (!v.purpose) blockers.push({ path: "purpose", label: "Cel wyceny — brak." });
  if (!v.kwNumber) blockers.push({ path: "kwNumber", label: "Numer księgi wieczystej — brak." });
  if (!v.client) blockers.push({ path: "client", label: "Klient — brak." });
  if (!v.inspectionDate) blockers.push({ path: "inspectionDate", label: "Data oględzin — brak." });
  return blockers;
}

export type BuildDocumentInput = {
  address: string;
  area: number;
  purpose: OperatPurpose;
  kwNumber: string;
  client: string;
  /** ISO date from the form (YYYY-MM-DD). */
  inspectionDate: string;
  /** Deterministic input — the approve mutation's timestamp, never read here. */
  approvedAt: Date;
  inputs: KcsInput;
  kcs: KcsResult;
  amountInWords: string;
};

export function buildDocumentModel(input: BuildDocumentInput): DocumentModel {
  const { kcs, inputs } = input;
  const city = cityFromAddress(input.address);
  return {
    adres: input.address,
    powierzchnia: formatNumber(input.area, 2),
    cel: PURPOSE_TEXT[input.purpose],
    nr_kw: input.kwNumber,
    klient: input.client,
    data_ogledzin: formatDatePl(input.inspectionDate),
    data_sporzadzenia: formatDatePl(input.approvedAt.toISOString()),
    wr: formatPln(kcs.wr),
    wr_slownie: input.amountInWords,
    wr_dokladna: formatPln(kcs.wrUnrounded),
    cena_min: formatPln(kcs.cmin),
    cena_max: formatPln(kcs.cmax),
    cena_sr: formatPln(kcs.csr),
    // Guard: identical prices (cmax === cmin) would divide by zero.
    polozenie_sr:
      kcs.cmax === kcs.cmin
        ? "0,000"
        : formatNumber((kcs.csr - kcs.cmin) / (kcs.cmax - kcs.cmin), 3),
    vmin: formatNumber(kcs.vmin, 3),
    vmax: formatNumber(kcs.vmax, 3),
    suma_ui: formatNumber(kcs.sumUi, 3),
    cena_1m2: formatPln(kcs.unitValue),
    kredyt: input.purpose === "zabezpieczenie_kredytu",
    transakcje: inputs.comparables.map((c) => ({
      data_msc: maskMonth(c.date),
      miasto: city,
      // ponytail: RCN comparables carry no street today — masked column shows
      // a dash until a street-bearing source exists (masking then applies).
      ulica: "—",
      pow: c.area != null ? formatNumber(c.area, 2) : "—",
      cena_jedn: formatPln(c.pricePerM2),
    })),
    cechy: kcs.ui.map((f) => ({
      nazwa: f.name,
      waga_pct: formatNumber(f.weight * 100, 0),
      ui_min: formatNumber(f.weight * kcs.vmin, 3),
      ui_sr: formatNumber(f.weight, 3),
      ui_max: formatNumber(f.weight * kcs.vmax, 3),
      ui_przedmiot: formatNumber(f.value, 3),
    })),
    // ponytail: canonical KCS simplification — cmin lokal = all features at
    // worst, cmax = all at best; the subject follows its actual ratings.
    opis_cmin: inputs.features.map((f) => `${f.name} – wartość najniższa cechy,`),
    opis_cmax: inputs.features.map((f) => `${f.name} – wartość najwyższa cechy,`),
    opis_przedmiot: inputs.features.map((f) => `${f.name} – ${RATING_TEXT[f.rating]},`),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- f12-document-masking`
Expected: PASS.

- [ ] **Step 5: Full verification + commit**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/web/src/domain/document-model.ts apps/web/tests/f12-document-masking.test.ts
git commit -m "feat: document model with F-12 masking and formatting (pure domain)"
```

---

### Task 4: DOCX render adapter + F-12 section-completeness test

**Files:**

- Create: `apps/web/src/adapters/docx-render.ts`
- Test: `apps/web/tests/f12-document-sections.test.ts`
- Modify: `apps/web/next.config.ts` (file tracing for the template)

**Interfaces:**

- Consumes: `DocumentModel`, `buildDocumentModel` (Task 3); template + `OPERAT_SECTIONS` (Tasks 1-2).
- Produces: `renderOperatDocx(model: DocumentModel): Buffer` — consumed by Task 9's approve action.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/f12-document-sections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import { buildDocumentModel } from "../src/domain/document-model";
import { OPERAT_SECTIONS } from "../src/domain/operat-sections";
import { renderOperatDocx } from "../src/adapters/docx-render";

/**
 * F-12 (completeness leg): render the REAL production template with
 * synthetic golden data and assert ≥19 sections, no unresolved tags, no
 * "undefined", the amount-in-words present, and — anti-literal — nothing
 * from the source Kościelna operat leaks into someone else's document.
 * Pure JS render, no network, no LibreOffice needed here.
 */
function goldenInputs(): KcsInput {
  return {
    area: 48.2,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i * 50,
      date: `2025-0${(i % 9) + 1}-15`,
      area: 40 + i,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: [
      { name: "standard wykończenia", weight: 0.4, rating: "przecietna" as const },
      { name: "położenie na piętrze", weight: 0.3, rating: "lepsza" as const },
      { name: "lokalizacja", weight: 0.3, rating: "gorsza" as const },
    ],
    sampleMeta: null,
    provenance: null,
  };
}

function renderGolden(): string {
  const inputs = goldenInputs();
  const model = buildDocumentModel({
    address: "ul. Przykładowa 5, Poznań",
    area: 48.2,
    purpose: "informacyjny",
    kwNumber: "KW-TEST-9",
    client: "p. Anna Przykładowa",
    inspectionDate: "2026-06-30",
    approvedAt: new Date("2026-07-15T09:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
  });
  const docx = renderOperatDocx(model);
  const zip = new PizZip(docx);
  return zip.files["word/document.xml"]
    .asText()
    .replace(/<[^>]+>/g, "")
    .replace(/ /g, " ");
}

describe("F-12: rendered operat completeness (real template, golden data)", () => {
  const text = renderGolden();

  it("contains every canonical section heading (≥19)", () => {
    expect(OPERAT_SECTIONS.length).toBeGreaterThanOrEqual(19);
    for (const heading of OPERAT_SECTIONS) {
      expect(text, `missing section "${heading}"`).toContain(heading);
    }
  });

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("contains the injected amount-in-words and the masked month format", () => {
    expect(text).toContain("czterysta osiemdziesiąt tysięcy złotych");
    expect(text).toContain("2025-01");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // full dates never render
  });

  it("renders all 12 transaction rows", () => {
    expect(text).toContain("10 000,00");
    expect(text).toContain("10 550,00");
  });

  it("anti-literal: nothing from the source operat leaks into a synthetic operat", () => {
    for (const lit of ["Kościeln", "Rajewsk", "1 044 400", "PO1P"]) {
      expect(text, `source literal "${lit}" leaked`).not.toContain(lit);
    }
  });

  it("omits the credit clause for a non-credit purpose", () => {
    expect(text).not.toContain("kredytodawc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- f12-document-sections`
Expected: FAIL — `docx-render` module not found.

- [ ] **Step 3: Implement the adapter**

`apps/web/src/adapters/docx-render.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import type { DocumentModel } from "../domain/document-model";

/**
 * DOCX renderer — fills the production operat template with a masked
 * DocumentModel. Pure JS (docxtemplater), validated end-to-end by the
 * 2026-07-15 template spike. The expressions parser is LOAD-BEARING:
 * without it `{a.b}` renders the string "undefined" (operat-e2e spike bug).
 */
const TEMPLATE_PATH = path.join(process.cwd(), "templates", "operat-szablon.docx");

export function renderOperatDocx(model: DocumentModel): Buffer {
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
  });
  doc.render(model);
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}
```

In `apps/web/next.config.ts` add file tracing so the template ships with the serverless bundle (verify the existing config shape and merge):

```ts
outputFileTracingIncludes: {
  "/valuations/[id]": ["./templates/**"],
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- f12-document-sections`
Expected: PASS. If a tag fails to resolve, fix the TEMPLATE (Task 1/2 pipeline), not the test — the contract table is the arbiter.

- [ ] **Step 5: Full verification + commit**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/web/src/adapters/docx-render.ts apps/web/tests/f12-document-sections.test.ts apps/web/next.config.ts
git commit -m "feat: docxtemplater render adapter with F-12 section-completeness test"
```

---

### Task 5: Schema migration 0008 + binary storage + typed doc serving

**Files:**

- Modify: `apps/web/src/db/schema.ts`
- Create: `apps/web/drizzle/0008_document_generator.sql` (via `drizzle-kit generate`, then verified)
- Modify: `apps/web/src/ports/valuation.ts` (Valuation/NewValuationInput fields)
- Modify: `apps/web/src/domain/valuation.ts` (`newValuation` passthrough)
- Modify: `apps/web/src/adapters/valuation-drizzle.ts` (`toValuation`, `getByDocKey` OR-match)
- Modify: `apps/web/src/adapters/storage-pg.ts`
- Modify: `apps/web/src/app/api/docs/[key]/route.ts`
- Tests: `apps/web/tests/storage-pg.test.ts`, `apps/web/tests/docs-route.test.ts` (extend)

**Interfaces:**

- Produces: `Valuation` gains `purpose: string | null`, `kwNumber: string | null`, `client: string | null`, `inspectionDate: string | null`, `docxUrl: string | null`; `NewValuationInput` gains the same (all optional-nullable). `PortStorage` signatures UNCHANGED (`put(key, Buffer|string)`, `get(): Buffer`) — binary vs text chosen by `Buffer.isBuffer`; served Content-Type derived from key suffix (`.pdf` inline / `.docx` attachment / legacy text).

- [ ] **Step 1: Write the failing tests**

Extend `apps/web/tests/storage-pg.test.ts` (append inside the existing describe; reuse its `storage` instance):

```ts
it("stores and returns binary content byte-identical (bytea path)", async () => {
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x01]); // "%PDF-" + binary
  const url = await storage.put("binary-roundtrip.pdf", bytes);
  expect(url).toBe("/api/docs/binary-roundtrip.pdf");
  const back = await storage.get("binary-roundtrip.pdf");
  expect(Buffer.compare(back, bytes)).toBe(0);
});

it("overwrites text with binary on upsert (retry path)", async () => {
  await storage.put("upsert-key.pdf", "old text");
  const bytes = Buffer.from([1, 2, 3]);
  await storage.put("upsert-key.pdf", bytes);
  const back = await storage.get("upsert-key.pdf");
  expect(Buffer.compare(back, bytes)).toBe(0);
});
```

Extend `apps/web/tests/docs-route.test.ts` (new test in the describe; follows the existing owner-setup pattern):

```ts
it("serves .pdf inline as application/pdf and .docx as attachment", async () => {
  const pdfKey = "doc-route-2.pdf";
  const pdfBytes = Buffer.from("%PDF-1.7 fake");
  const pdfUrl = await storage.put(pdfKey, pdfBytes);
  const docxKey = "doc-route-2.docx";
  const docxUrl = await storage.put(docxKey, Buffer.from("PK-fake"));

  await repo.create({
    address: "ul. Docs-Route 2",
    area: 10,
    wr: 100000,
    inputs: null,
    amountInWords: null,
    docUrl: pdfUrl,
    docxUrl,
    ownerId: appraiserA.id,
  });

  getSessionMock.mockResolvedValue({ user: appraiserA });

  const pdfRes = await GET(new Request(`http://test${pdfUrl}`), paramsFor(pdfKey));
  expect(pdfRes.status).toBe(200);
  expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
  expect(pdfRes.headers.get("content-disposition")).toBe("inline");

  // the DOCX key authorizes via docxUrl (OR-match in getByDocKey)
  const docxRes = await GET(new Request(`http://test${docxUrl}`), paramsFor(docxKey));
  expect(docxRes.status).toBe(200);
  expect(docxRes.headers.get("content-type")).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  expect(docxRes.headers.get("content-disposition")).toContain("attachment");
});
```

Note: `repo.create` calls gain `docxUrl` — TypeScript will fail until the port is extended (that IS the red state).

Run: `pnpm --filter web test -- storage-pg docs-route`
Expected: FAIL (compile errors + missing columns).

- [ ] **Step 2: Schema + migration**

`apps/web/src/db/schema.ts` — add a bytea helper and columns:

```ts
import {
  customType,
  date,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** drizzle 0.45 has no native bytea — minimal customType (context7-verified pattern). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
```

`document` table: `content` becomes nullable, add binary column:

```ts
export const document = pgTable("document", {
  key: text("key").primaryKey(),
  // Text stubs (legacy) — exactly one of content/contentBytes is set per row.
  content: text("content"),
  contentBytes: bytea("content_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
```

`valuation` table — add after `docUrl`:

```ts
  docxUrl: text("docx_url"),
  // Slice 4 document fields — nullable for legacy rows; approval blocks when missing.
  purpose: text("purpose", { enum: ["sprzedaz", "zabezpieczenie_kredytu", "informacyjny"] }),
  kwNumber: text("kw_number"),
  client: text("client"),
  inspectionDate: date("inspection_date"),
```

Generate + verify migration:

Run: `cd apps/web && pnpm exec drizzle-kit generate --name document_generator`
Expected SQL (verify the generated file matches; adjust name to `0008_document_generator.sql`):

```sql
ALTER TABLE "document" ALTER COLUMN "content" DROP NOT NULL;
ALTER TABLE "document" ADD COLUMN "content_bytes" "bytea";
ALTER TABLE "valuation" ADD COLUMN "docx_url" text;
ALTER TABLE "valuation" ADD COLUMN "purpose" text;
ALTER TABLE "valuation" ADD COLUMN "kw_number" text;
ALTER TABLE "valuation" ADD COLUMN "client" text;
ALTER TABLE "valuation" ADD COLUMN "inspection_date" date;
```

- [ ] **Step 3: Ports + domain + adapter plumbing**

`apps/web/src/ports/valuation.ts` — extend both types:

```ts
export type Valuation = {
  // ...existing fields unchanged...
  docxUrl: string | null;
  purpose: "sprzedaz" | "zabezpieczenie_kredytu" | "informacyjny" | null;
  kwNumber: string | null;
  client: string | null;
  /** ISO date string (YYYY-MM-DD). */
  inspectionDate: string | null;
};

export type NewValuationInput = {
  // ...existing fields unchanged...
  docxUrl?: string | null;
  purpose?: Valuation["purpose"];
  kwNumber?: string | null;
  client?: string | null;
  inspectionDate?: string | null;
};
```

`apps/web/src/domain/valuation.ts` — `newValuation` passes them through:

```ts
    docxUrl: input.docxUrl ?? null,
    purpose: input.purpose ?? null,
    kwNumber: input.kwNumber ?? null,
    client: input.client ?? null,
    inspectionDate: input.inspectionDate ?? null,
```

`apps/web/src/adapters/valuation-drizzle.ts` — extend `toValuation` with the five fields (direct column mapping) and make `getByDocKey` match either URL:

```ts
import { eq, or } from "drizzle-orm";
// ...
const [row] = await tx
  .select()
  .from(schema.valuation)
  .where(or(eq(schema.valuation.docUrl, docUrl), eq(schema.valuation.docxUrl, docUrl)));
```

- [ ] **Step 4: Storage adapter binary path**

`apps/web/src/adapters/storage-pg.ts`:

```ts
    async put(key: string, data: Buffer | string): Promise<string> {
      const isBinary = Buffer.isBuffer(data);
      const values = {
        key,
        content: isBinary ? null : (data as string),
        contentBytes: isBinary ? (data as Buffer) : null,
      };
      await db
        .insert(schema.document)
        .values(values)
        .onConflictDoUpdate({
          target: schema.document.key,
          set: { content: values.content, contentBytes: values.contentBytes },
        });
      return `/api/docs/${encodeURIComponent(key)}`;
    },

    async get(key: string): Promise<Buffer> {
      const [row] = await db.select().from(schema.document).where(eq(schema.document.key, key));
      if (!row) {
        throw new Error(`Storage: key not found: ${key}`);
      }
      if (row.contentBytes) {
        return Buffer.from(row.contentBytes);
      }
      if (row.content == null) {
        throw new Error(`Storage: empty row for key: ${key}`);
      }
      return Buffer.from(row.content);
    },
```

- [ ] **Step 5: Route content types**

`apps/web/src/app/api/docs/[key]/route.ts` — replace the success response headers (401/404 keep `TEXT_HEADERS`):

```ts
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function successHeaders(key: string): Record<string, string> {
  if (key.endsWith(".pdf")) {
    return { "Content-Type": "application/pdf", "Content-Disposition": "inline" };
  }
  if (key.endsWith(".docx")) {
    return {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": 'attachment; filename="operat.docx"',
    };
  }
  return TEXT_HEADERS; // legacy text stubs
}
// in GET:
const data = await storage.get(key);
return new NextResponse(new Uint8Array(data), { status: 200, headers: successHeaders(key) });
```

- [ ] **Step 6: Run tests, full verification + commit**

Run: `pnpm --filter web test -- storage-pg docs-route`
Expected: PASS.
Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/web/src/db/schema.ts apps/web/drizzle apps/web/src/ports/valuation.ts apps/web/src/domain/valuation.ts apps/web/src/adapters/valuation-drizzle.ts apps/web/src/adapters/storage-pg.ts apps/web/src/app/api/docs/[key]/route.ts apps/web/tests/storage-pg.test.ts apps/web/tests/docs-route.test.ts
git commit -m "feat: migration 0008 - document fields, binary storage, typed doc serving"
```

---

### Task 6: Worker `/convert-to-pdf` + LibreOffice container + CI

**Files:**

- Modify: `apps/worker/app/main.py`
- Create: `apps/worker/app/convert.py`
- Test: `apps/worker/tests/test_convert_to_pdf.py`
- Create: `apps/worker/Dockerfile`
- Modify: `apps/worker/railway.json`, `apps/worker/pyproject.toml` (dev dep python-docx)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `POST /convert-to-pdf` — request body = raw DOCX bytes, response = `application/pdf` bytes; 400 empty body; 502 conversion failure (Polish detail). Consumed by Task 7's adapter.
- F-11 stays intact: the endpoint returns file bytes, never a WR field (same contract shape as `/amount-in-words`).

- [ ] **Step 1: Write the failing tests**

`apps/worker/tests/test_convert_to_pdf.py`:

```python
import io
import os
import shutil

import pytest
from docx import Document
from fastapi.testclient import TestClient

from app.convert import resolve_soffice
from app.main import app

client = TestClient(app)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _sample_docx() -> bytes:
    doc = Document()
    doc.add_paragraph("Zażółć gęślą jaźń — test polskich znaków.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# CI always has LibreOffice (asserted by a dedicated workflow step) — the skip
# is for local machines without soffice on PATH/SOFFICE only. Never skip in CI.
soffice_missing = resolve_soffice() is None and not os.environ.get("CI")


@pytest.mark.skipif(soffice_missing, reason="soffice not installed locally")
def test_convert_to_pdf_returns_pdf_bytes():
    r = client.post(
        "/convert-to-pdf", content=_sample_docx(), headers={"Content-Type": DOCX_MIME}
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"
    # F-11: binary file response, never a JSON payload with computed values
    assert not r.headers["content-type"].startswith("application/json")


def test_convert_to_pdf_empty_body_is_400():
    r = client.post("/convert-to-pdf", content=b"", headers={"Content-Type": DOCX_MIME})
    assert r.status_code == 400


def test_resolve_soffice_prefers_env(monkeypatch):
    monkeypatch.setenv("SOFFICE", "/nonexistent/soffice")
    assert resolve_soffice() is None or isinstance(resolve_soffice(), str)
    monkeypatch.delenv("SOFFICE")
    which = shutil.which("soffice")
    assert resolve_soffice() == which
```

Add dev dep: in `apps/worker/pyproject.toml` `[dependency-groups].dev` append `"python-docx>=1.2.0"`.

Run: `cd apps/worker && uv sync && uv run pytest -q tests/test_convert_to_pdf.py`
Expected: FAIL — `app.convert` missing.

- [ ] **Step 2: Implement `apps/worker/app/convert.py`**

```python
"""DOCX -> PDF conversion via LibreOffice headless (soffice).

Open Host Service adapter (ADR-009): the worker hosts the heavyweight
native dependency so the web app never needs it. F-11: this module takes
a document IN and returns file bytes OUT — it computes nothing and never
returns a market-value field.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def resolve_soffice() -> str | None:
    """SOFFICE env override first (macOS app-bundle path), then PATH."""
    env = os.environ.get("SOFFICE")
    if env:
        return env if Path(env).exists() else None
    return shutil.which("soffice")


class ConversionError(Exception):
    pass


def docx_to_pdf(docx: bytes, timeout_s: int = 120) -> bytes:
    soffice = resolve_soffice()
    if soffice is None:
        raise ConversionError("soffice not found (set SOFFICE or install LibreOffice)")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.docx"
        src.write_bytes(docx)
        try:
            subprocess.run(
                [
                    soffice,
                    "--headless",
                    # Isolated profile: parallel soffice runs otherwise fight
                    # over the shared user profile and silently fail.
                    f"-env:UserInstallation=file://{tmp}/lo-profile",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmp,
                    str(src),
                ],
                check=True,
                capture_output=True,
                timeout=timeout_s,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise ConversionError(f"soffice failed: {exc}") from exc
        pdf = Path(tmp) / "input.pdf"
        if not pdf.exists():
            raise ConversionError("soffice produced no PDF output")
        return pdf.read_bytes()
```

In `apps/worker/app/main.py` add:

```python
from fastapi import FastAPI, HTTPException, Request, Response

from app.convert import ConversionError, docx_to_pdf

@app.post("/convert-to-pdf")
async def convert_to_pdf(request: Request) -> Response:
    docx = await request.body()
    if not docx:
        raise HTTPException(status_code=400, detail="Puste żądanie — oczekiwano pliku DOCX.")
    try:
        pdf = docx_to_pdf(docx)
    except ConversionError as exc:
        raise HTTPException(
            status_code=502,
            detail="Konwersja DOCX do PDF nie powiodła się — spróbuj ponownie.",
        ) from exc
    return Response(content=pdf, media_type="application/pdf")
```

- [ ] **Step 3: Run worker tests**

Run: `cd apps/worker && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
Expected: PASS (locally, `SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice` if not on PATH).

- [ ] **Step 4: Dockerfile + Railway config**

`apps/worker/Dockerfile`:

```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# LibreOffice for DOCX->PDF + Carlito (metric-compatible Calibri substitute —
# without it the operat layout reflows badly).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer fonts-crosextra-carlito \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app ./app
ENV PATH="/app/.venv/bin:$PATH"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

`apps/worker/railway.json` — switch builder:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "multiRegionConfig": { "europe-west4-drams3a": { "numReplicas": 1 } },
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- [ ] **Step 5: CI — LibreOffice availability + step rename**

In `.github/workflows/ci.yml`, `ci` job, insert BEFORE "Worker tests":

```yaml
- name: Ensure LibreOffice + Carlito (F-12 conversion tests)
  run: |
    soffice --version || sudo apt-get update && sudo apt-get install -y libreoffice-writer
    fc-list | grep -qi carlito || sudo apt-get install -y fonts-crosextra-carlito
```

Rename the worker step (ledger backlog item):

```yaml
- name: Worker tests (F-5, F-11, F-12)
  working-directory: apps/worker
  run: uv run pytest -q
```

Add the same "Ensure LibreOffice + Carlito" step to the `e2e` job (before "Start worker") — the E2E approve path converts a real document.

- [ ] **Step 6: Verification + commit + push, watch CI**

Run: `cd apps/worker && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
Run (root): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/worker .github/workflows/ci.yml
git commit -m "feat: worker convert-to-pdf endpoint with LibreOffice container (F-12)"
git push && gh run watch --exit-status
```

---

### Task 7: Web port + adapter for PDF conversion

**Files:**

- Modify: `apps/web/src/ports/worker.ts`
- Modify: `apps/web/src/adapters/worker-http.ts`
- Test: `apps/web/tests/worker-contract.test.ts` (extend)

**Interfaces:**

- Produces: `PortWorker.convertToPdf(docx: Buffer): Promise<Buffer>` — consumed by Task 9.

- [ ] **Step 1: Write the failing test** (append to `worker-contract.test.ts`):

```ts
it("convertToPdf posts DOCX bytes and returns PDF bytes (F-11: files only)", async () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7 fake").buffer;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => pdfBytes,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  global.fetch = fetchMock;
  const w = httpWorker("http://worker.test");
  const pdf = await w.convertToPdf(Buffer.from("PK-fake-docx"));
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("http://worker.test/convert-to-pdf");
  expect(init.method).toBe("POST");
  expect(init.headers["Content-Type"]).toContain("officedocument");
});

it("convertToPdf rejects on non-2xx", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 502,
    statusText: "Bad Gateway",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  const w = httpWorker("http://worker.test");
  await expect(w.convertToPdf(Buffer.from("x"))).rejects.toThrow("502");
});
```

Run: `pnpm --filter web test -- worker-contract` — Expected: FAIL (no `convertToPdf`).

- [ ] **Step 2: Implement**

`apps/web/src/ports/worker.ts` — add to the interface:

```ts
  /**
   * Converts a rendered DOCX to PDF (LibreOffice runs worker-side, ADR-009).
   * Takes and returns file bytes only — never computed values (F-11).
   */
  convertToPdf(docx: Buffer): Promise<Buffer>;
```

`apps/web/src/adapters/worker-http.ts` — add to the returned object:

```ts
    async convertToPdf(docx: Buffer): Promise<Buffer> {
      const response = await fetch(`${baseUrl}/convert-to-pdf`, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        body: new Uint8Array(docx),
      });
      if (!response.ok) {
        throw new Error(
          `worker /convert-to-pdf responded ${response.status} ${response.statusText}`,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    },
```

- [ ] **Step 3: Run test, full verification + commit**

Run: `pnpm --filter web test -- worker-contract` — Expected: PASS.
Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/web/src/ports/worker.ts apps/web/src/adapters/worker-http.ts apps/web/tests/worker-contract.test.ts
git commit -m "feat: convertToPdf port and HTTP adapter"
```

---

### Task 8: Form fields + create action (stub removal)

**Files:**

- Modify: `apps/web/src/lib/valuation-form-schema.ts`
- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx`
- Modify: `apps/web/src/app/actions/create-valuation.ts`
- Tests: `apps/web/tests/valuation-form-schema.test.ts`, `apps/web/tests/create-valuation-action.test.ts` (extend/rewrite)

**Interfaces:**

- Consumes: `PURPOSE_LABEL` (Task 3), extended `NewValuationInput` (Task 5).
- Produces: form values include `purpose`, `kwNumber`, `client`, `inspectionDate` (all required); `createValuation` persists them and NO LONGER calls worker/storage (`amountInWords: null`, `docUrl: null`).

- [ ] **Step 1: Write the failing tests**

`valuation-form-schema.test.ts` — append:

```ts
it("requires the four document fields with Polish messages", () => {
  const base = {
    address: "ul. Testowa 1",
    area: 50,
    comparables: [{ pricePerM2: 10000 }, { pricePerM2: 11000 }, { pricePerM2: 12000 }],
    features: [{ name: "cecha", weightPct: 100, rating: "przecietna" }],
  };
  const missing = valuationFormSchema.safeParse(base);
  expect(missing.success).toBe(false);

  const full = valuationFormSchema.safeParse({
    ...base,
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "p. Jan Testowy",
    inspectionDate: "2026-07-01",
  });
  expect(full.success).toBe(true);
});

it("rejects an unknown purpose", () => {
  const parsed = valuationFormSchema.shape.purpose.safeParse("wynajem");
  expect(parsed.success).toBe(false);
});
```

`create-valuation-action.test.ts` — update: the existing test mocks worker/storage via `_deps`; change expectations to: (a) `worker.amountInWords` and `storage.put` are NOT called, (b) the created row carries the four new fields and `docUrl: null`, `amountInWords: null`. Follow the file's existing mock structure; add the four fields to the submitted form values (`purpose: "sprzedaz"`, `kwNumber: "KW-TEST-1"`, `client: "p. Jan Testowy"`, `inspectionDate: "2026-07-01"`).

Run: `pnpm --filter web test -- valuation-form-schema create-valuation-action`
Expected: FAIL.

- [ ] **Step 2: Schema + action**

`valuation-form-schema.ts` — add to `valuationFormSchema` object:

```ts
  purpose: z.enum(["sprzedaz", "zabezpieczenie_kredytu", "informacyjny"], {
    message: "Wybierz cel wyceny.",
  }),
  kwNumber: z.string().trim().min(1, "Podaj numer księgi wieczystej."),
  client: z.string().trim().min(1, "Podaj zamawiającego wycenę."),
  inspectionDate: z.string().min(1, "Podaj datę oględzin."),
```

`create-valuation.ts` — remove the stub block entirely (imports of `randomUUID`, `storage`, `worker` go away; keep `computeKcs`):

```ts
const { address, area, features, sampleMeta, purpose, kwNumber, client, inspectionDate } =
  parsed.data;
// ... assignProvenance/kcsInput/computeKcs unchanged ...

const created = await valuationRepository.create({
  address,
  area,
  wr,
  inputs: kcsInput,
  // Document artifacts are generated at APPROVAL (spec §3) — a draft has none.
  amountInWords: null,
  docUrl: null,
  docxUrl: null,
  purpose,
  kwNumber,
  client,
  inspectionDate,
  ownerId: session.user.id,
});
```

- [ ] **Step 3: Form fields**

In `new-valuation-form.tsx`: extend `defaultValues` with `purpose: "" as never, kwNumber: "", client: "", inspectionDate: ""` and add four field blocks next to the address/area fields, cloning the existing `Controller` + `Field` pattern (use the SAME select styling the feature-rating select uses; check it in-file first):

```tsx
<Controller
  control={control}
  name="purpose"
  render={({ field, fieldState }) => (
    <Field data-invalid={!!fieldState.error}>
      <FieldLabel htmlFor="purpose">Cel wyceny</FieldLabel>
      <select id="purpose" {...field} className={/* clone rating-select classes */}>
        <option value="">— wybierz —</option>
        <option value="sprzedaz">Sprzedaż</option>
        <option value="zabezpieczenie_kredytu">Zabezpieczenie kredytu</option>
        <option value="informacyjny">Informacyjny</option>
      </select>
      <FieldError errors={[fieldState.error]} />
    </Field>
  )}
/>
```

`kwNumber` and `client`: exact clones of the `address` block (Input + placeholders `np. PO1P/00012345/6` — NO, placeholder text must not be KW-shaped either, F-9 greps source; use `numer księgi wieczystej`). `inspectionDate`: same pattern with `<Input id="inspectionDate" type="date" {...field} />`.

- [ ] **Step 4: Run tests, full verification + commit**

Run: `pnpm --filter web test -- valuation-form-schema create-valuation-action`
Expected: PASS.
Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/web/src/lib/valuation-form-schema.ts apps/web/src/app/valuations/new/new-valuation-form.tsx apps/web/src/app/actions/create-valuation.ts apps/web/tests/valuation-form-schema.test.ts apps/web/tests/create-valuation-action.test.ts
git commit -m "feat: document form fields; stub generation removed from create"
```

---

### Task 9: Approve orchestration — generate, store, flip status + UI

**Files:**

- Modify: `apps/web/src/domain/valuation.ts` (blockers merge + docs in approve)
- Modify: `apps/web/src/ports/valuation.ts` (approve signature)
- Modify: `apps/web/src/adapters/valuation-drizzle.ts` (approve persists urls)
- Modify: `apps/web/src/app/actions/approve-valuation.ts` (orchestration)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (maxDuration, blockers merge, PDF iframe + DOCX button)
- Tests: `apps/web/tests/valuation-lifecycle.test.ts` (extend), `apps/web/tests/f4-approval-gate.test.ts` untouched

**Interfaces:**

- Consumes: `buildDocumentModel`, `documentFieldBlockers`, `renderOperatDocx`, `worker.convertToPdf`, `storage.put`.
- Produces: `approveValuation(v, now, docs?: { docUrl: string; docxUrl: string })` (domain); `PortValuation.approve(id, user, docs?)`; storage keys `operat-${id}.pdf` / `operat-${id}.docx`.

- [ ] **Step 1: Write the failing domain tests** (append to `valuation-lifecycle.test.ts`, following its existing fixtures):

```ts
it("approve blocks when document fields are missing (legacy draft)", async () => {
  // create a draft with valid inputs but purpose/kwNumber/client/inspectionDate = null
  // expect repo.approve to throw ApprovalBlockedError whose blockers include path "purpose"
});

it("approve persists docUrl + docxUrl when passed", async () => {
  // draft with complete fields + passing gate:
  const updated = await repo.approve(id, owner, {
    docUrl: "/api/docs/operat-x.pdf",
    docxUrl: "/api/docs/operat-x.docx",
  });
  expect(updated?.docUrl).toBe("/api/docs/operat-x.pdf");
  expect(updated?.docxUrl).toBe("/api/docs/operat-x.docx");
  expect(updated?.status).toBe("approved");
});
```

(Write them fully against the file's existing helper fixtures — the file already creates drafts with confirmed provenance; add `purpose: "sprzedaz", kwNumber: "KW-TEST-1", client: "k", inspectionDate: "2026-07-01"` to its create payloads where the gate should pass.)

Run: `pnpm --filter web test -- valuation-lifecycle`
Expected: FAIL (signature + blockers missing).

- [ ] **Step 2: Domain + port + adapter**

`domain/valuation.ts`:

```ts
import { documentFieldBlockers } from "./document-model";
// ...
export function approveValuation(
  v: Valuation,
  now: Date,
  docs?: { docUrl: string; docxUrl: string },
): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new ApprovalBlockedError([{ path: "inputs", label: "Brak danych wejściowych operatu." }]);
  }
  const gate = approvalGate(v.inputs);
  const blockers = [...(gate.ok ? [] : gate.blockers), ...documentFieldBlockers(v)];
  if (blockers.length > 0) {
    throw new ApprovalBlockedError(blockers);
  }
  return {
    ...v,
    status: "approved",
    approvedAt: now,
    ...(docs ? { docUrl: docs.docUrl, docxUrl: docs.docxUrl } : {}),
  };
}
```

`ports/valuation.ts`: `approve(id: string, user: SessionUser, docs?: { docUrl: string; docxUrl: string }): Promise<Valuation | null>;`

`adapters/valuation-drizzle.ts` approve: pass `docs` through to the domain call and persist:

```ts
const updated = approveValuation(valuation, new Date(), docs);
const [saved] = await db
  .update(schema.valuation)
  .set({
    status: updated.status,
    approvedAt: updated.approvedAt,
    docUrl: updated.docUrl,
    docxUrl: updated.docxUrl,
  })
  .where(eq(schema.valuation.id, id))
  .returning();
```

- [ ] **Step 3: Approve action orchestration**

`app/actions/approve-valuation.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository } from "@/app/valuations/_deps";
import { ApprovalBlockedError } from "@/domain/valuation";
import { approvalGate } from "@/domain/provenance";
import {
  buildDocumentModel,
  documentFieldBlockers,
  type OperatPurpose,
} from "@/domain/document-model";
import { computeKcs } from "@/domain/kcs";
import { renderOperatDocx } from "@/adapters/docx-render";

export type ApproveValuationResult = { error: string } | undefined;

/**
 * Approve = F-4 gate + document generation, synchronously (spec §3).
 * Invariant: approved ⇔ operat exists. Files are stored FIRST, the status
 * flip (which re-runs the gate atomically, ADR-012) happens LAST — a failed
 * flip leaves harmless orphan files that the retry overwrites (same keys).
 */
export async function approveValuation(id: string): Promise<ApproveValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const valuation = await valuationRepository.get(id, session.user);
  if (!valuation) {
    return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
  }

  // Fail fast with the first blocker before any expensive generation work.
  if (valuation.inputs) {
    const gate = approvalGate(valuation.inputs);
    const blockers = [...(gate.ok ? [] : gate.blockers), ...documentFieldBlockers(valuation)];
    if (blockers.length > 0) {
      return { error: `Zatwierdzenie zablokowane — ${blockers[0].label}` };
    }
  }

  try {
    if (!valuation.inputs) {
      return { error: "Zatwierdzenie zablokowane — brak danych wejściowych operatu." };
    }
    const kcs = computeKcs(valuation.inputs);
    const amountInWords = await worker.amountInWords(kcs.wr);
    const model = buildDocumentModel({
      address: valuation.address,
      area: valuation.area,
      purpose: valuation.purpose as OperatPurpose,
      kwNumber: valuation.kwNumber ?? "",
      client: valuation.client ?? "",
      inspectionDate: valuation.inspectionDate ?? "",
      approvedAt: new Date(),
      inputs: valuation.inputs,
      kcs,
      amountInWords,
    });
    const docx = renderOperatDocx(model);
    const pdf = await worker.convertToPdf(docx);
    const docxUrl = await storage.put(`operat-${id}.docx`, docx);
    const docUrl = await storage.put(`operat-${id}.pdf`, pdf);

    const updated = await valuationRepository.approve(id, session.user, { docUrl, docxUrl });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    if (error instanceof ApprovalBlockedError) {
      return {
        error: `Zatwierdzenie zablokowane — ${error.blockers[0]?.label ?? "operat zawiera niezweryfikowane wartości."}`,
      };
    }
    console.error("approveValuation failed", error);
    return {
      error:
        "Nie udało się wygenerować operatu — worker lub magazyn dokumentów są niedostępne. Spróbuj ponownie.",
    };
  }

  revalidatePath(`/valuations/${id}`);
  revalidatePath("/valuations");
}
```

- [ ] **Step 4: Detail page**

`app/valuations/[id]/page.tsx`:

1. Top of file: `export const maxDuration = 60;` (Server Actions on this page inherit it — context7-verified) plus import `documentFieldBlockers` from `@/domain/document-model`.
2. Blockers merge (replace the `gate` computation):

```tsx
const isDraft = valuation.status === "in_progress";
const gate = isDraft && valuation.inputs ? approvalGate(valuation.inputs) : null;
const fieldBlockers = isDraft ? documentFieldBlockers(valuation) : [];
const allBlockers = [...(gate && !gate.ok ? gate.blockers : []), ...fieldBlockers];
const gateOk = gate?.ok === true && fieldBlockers.length === 0;
```

Render `allBlockers` in the existing `gate-blockers` list (`{allBlockers.map(...)}`; show the block when `allBlockers.length > 0`); pass `gateOk={gateOk}` to `ValuationActions`. 3. Document section (replace the docUrl button block):

```tsx
{
  valuation.docUrl?.endsWith(".pdf") ? (
    <div className="flex flex-col gap-2">
      <iframe
        title="Operat szacunkowy (PDF)"
        src={valuation.docUrl}
        className="h-[80vh] w-full rounded-md border"
      />
      {valuation.docxUrl ? (
        <Button asChild variant="outline" className="w-fit">
          <a href={valuation.docxUrl}>Pobierz DOCX</a>
        </Button>
      ) : null}
    </div>
  ) : valuation.docUrl ? (
    <Button asChild variant="outline" className="w-fit">
      <a href={valuation.docUrl} target="_blank" rel="noreferrer">
        Otwórz dokument operatu
      </a>
    </Button>
  ) : null;
}
```

(Legacy approved rows keep their text-stub link; drafts have `docUrl === null` → nothing.)

- [ ] **Step 5: Run tests, full verification + commit + push, watch CI**

Run: `pnpm --filter web test -- valuation-lifecycle f4-approval-gate`
Expected: PASS.
Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`

```bash
git add apps/web/src/domain/valuation.ts apps/web/src/ports/valuation.ts apps/web/src/adapters/valuation-drizzle.ts apps/web/src/app/actions/approve-valuation.ts "apps/web/src/app/valuations/[id]/page.tsx"
git commit -m "feat: approve generates operat DOCX+PDF, stores and serves it (F-12 live)"
git push && gh run watch --exit-status
```

---

### Task 10: E2E smoke — full document path

**Files:**

- Modify: `apps/web/e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: everything — this is the whole-slice proof in CI (real Postgres, real worker with soffice, real render).

- [ ] **Step 1: Update `fillDraft` for the new required fields**

In `smoke.spec.ts`, after the `#area` fill:

```ts
await page.locator("#purpose").selectOption("sprzedaz");
await page.locator("#kwNumber").fill("KW-TEST-1");
await page.locator("#client").fill("p. Test Testowy");
await page.locator("#inspectionDate").fill("2026-07-01");
```

- [ ] **Step 2: Extend the approve test into the document assertion**

Replace the approve test's tail:

```ts
test("draft with 12 manual transactions: approve → Zatwierdzony + operat PDF/DOCX", async ({
  page,
}) => {
  await login(page);
  const prices = Array.from({ length: 12 }, (_, i) => String(12_000 + i * 100));
  await fillDraft(page, prices);

  await expect(page.getByTestId("valuation-status")).toHaveText("Szkic");
  await expect(page.getByTestId("approve-button")).toBeEnabled();
  await page.getByTestId("approve-button").click();

  await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony", {
    timeout: 30_000, // generation incl. LibreOffice conversion
  });

  const iframe = page.locator('iframe[title="Operat szacunkowy (PDF)"]');
  await expect(iframe).toBeVisible();
  const pdfUrl = await iframe.getAttribute("src");
  const pdfResponse = await page.request.get(pdfUrl!);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await expect(page.getByRole("link", { name: "Pobierz DOCX" })).toBeVisible();
});
```

- [ ] **Step 3: Run E2E locally**

Run (three terminals or background): worker `cd apps/worker && SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice uv run uvicorn app.main:app --port 8000`; then `cd apps/web && pnpm exec drizzle-kit migrate && pnpm seed && pnpm turbo build --filter=web --env-mode=loose && pnpm e2e`
Expected: both smoke tests PASS.

- [ ] **Step 4: Commit + push, watch full CI (ci + e2e jobs)**

```bash
git add apps/web/e2e/smoke.spec.ts
git commit -m "test: e2e covers approve-to-operat document path (F-12)"
git push && gh run watch --exit-status
```

---

## Deploy notes (S5 — human-gated, not an SDD task)

Order matters (migration BEFORE deploy; user confirms each step):

1. **Prod DB migration 0008** (additive, zero-downtime): `railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm exec drizzle-kit migrate'` (from `apps/web`; the secret never materializes — established pattern).
2. **Worker deploy** (now a Dockerfile build, ~5 min first time): `railway up ./apps/worker --path-as-root --service worker-v2`. Verify: `curl https://worker-v2-production.up.railway.app/health` + a manual `/convert-to-pdf` roundtrip with a small DOCX.
3. **Web deploy**: `vercel deploy --prod` from the monorepo root. Verify template shipped (approve a seeded draft — if the template file 404s, revisit `outputFileTracingIncludes`).
4. **Live E2E on Kościelna data** (checkpoint): create valuation (Kościelna address/area, purpose sprzedaż, KW number entered by user — NOT committed anywhere), RCN fetch, confirm, approve → PDF preview renders, DOCX downloads, transaction table shows months + no full dates. Check fonts (Carlito) and page flow in the PDF.
5. Legacy check: an old approved valuation still serves its text stub link.

## Self-review notes

- Spec §4 amountInWords: column stays, no longer written at create (Task 8) — matches "do wygaszenia przy następnej migracji reshape".
- Spec §6.4 słownie golden: already in worker pytest (unchanged); render test asserts injected words land (Task 4).
- Spec §5 scrubbing enforced twice: template integrity test (Tasks 1-2) + anti-literal render test (Task 4); F-9 cannot see inside the .docx ZIP — the vitest checks are the real gate (documented in test comment).
- Type consistency: `approve(id, user, docs?)` used in Tasks 9 (port, adapter, action); `renderOperatDocx(model): Buffer` in Tasks 4/9; `convertToPdf(docx: Buffer): Promise<Buffer>` in Tasks 7/9; `DocumentModel` field names = placeholder contract.
