# Slice 11a — UI wizard: 7 kroków (FR-13 rdzeń) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7-krokowy wizard (Przedmiot → Oględziny → Próba → Cechy → Kalkulacja → Opisy → Operat) z miękkim gatingiem `maxReached` wyliczanym z danych szkicu; szkic powstaje po kroku 1 (`wr = NULL` do zatwierdzenia kalkulacji); mutacje draftu per krok w tx z audytem; stary formularz usunięty po flipie flagi.

**Architecture:** Spec `docs/superpowers/specs/2026-07-22-wizard-ui-fr13-design.md`. Wizard = warstwa UX nad istniejącym modelem: silnik KCS i `approvalGate` (F-4) NIETYKANE. Migracja 0010 (`stub_wr` DROP NOT NULL) — jedyny DDL. Routing `?step=N` na `/valuations/[id]` (switch w page.tsx); `/valuations/new` = krok 1 (createDraft → redirect `?step=2`). Nowe mutacje draftu (`saveSubject`/`saveSample`/`saveFeatures`/`confirmCalculation` + `set_date` w `InspectionOp`) — wzorzec `updateInspection` (FOR UPDATE + audyt w tx). Zapis kroku 3/4 **nulluje `wr`** (inwalidacja — stara kwota nie przeżyje zmiany danych). Całość za flagą `NEXT_PUBLIC_WIZARD` (server-side check, CI jej nie ustawia) — flip + kasacja starego formularza w Tasku 12.

**Tech Stack:** Next 16 (App Router, RSC + server actions, searchParams), react-hook-form + zod (schematy per krok przez `.pick()` z `valuationFormObject`), Drizzle/Postgres (drizzle-kit generate), shadcn (Badge/Button/Card/Input/Field/Table — **zero nowych komponentów shadcn**; stepper = Linki + Tailwind wg makiety), vitest + RTL, Playwright.

## Global Constraints

- **F-1 NIETYKALNE:** golden 1 044 400 zł; `computeKcs` bez zmian semantycznych (wolno go tylko WYWOŁYWAĆ z nowych miejsc). Golden test w CI pilnuje.
- **F-4 NIETYKALNE:** `approvalGate` I typ `InputsProvenance` — ZERO zmian w `provenance.ts` (advisor 2026-07-23: optionalizacja `weights`/`ratings` łamie strict typecheck w page.tsx:451, valuation.ts:169 i testach). Częściowy snapshot (bez cech) powstaje przez pojedynczy, skomentowany cast `as InputsProvenance` przy tworzeniu — runtime-partial, type-full; gate czyta `entry?.status ?? "none"` (default-deny), więc braki blokują poprawnie.
- **F-7:** każda mutacja draftu w tx z DOKŁADNIE jednym wpisem audytu; `AUDIT_ACTIONS` rozszerzone o DOKŁADNIE cztery akcje: `subject_updated`, `sample_updated`, `features_updated`, `calculation_confirmed` (kolumna `action` to `text` bez CHECK — zero DDL na audit_log).
- **F-9:** fixture'y syntetyczne; adres tylko „ul. Testowa 1, Poznań" / golden-case; KW tylko `PO1P/1/6`-style; zero 11-cyfrowych ciągów, zero realnych dokumentów.
- **F-12:** szablon DOCX NIETYKANY. Worker NIETYKANY.
- Kod/commity ANGIELSKIE (conventional, lowercase, ≤100 znaków, bez atrybucji); UI POLSKI (pełne diakrytyki).
- Per task: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push (PLAIN `git push`; jeśli hook guard zablokuje — NIE obchodź, zostaw commit lokalnie i zaraportuj kontrolerowi) → `gh run list --branch main --limit 3 --json databaseId,headSha` → `gh run watch <id> --exit-status` (run z TWOIM sha). Prettier pre-commit: `pnpm exec prettier --write <pliki>`.
- RTL: pragma `// @vitest-environment jsdom` + `afterEach(cleanup)`; testy web BEZ `clearMocks` — `mock.calls` akumulują się: używaj `.findLast()`. Automocki `_deps`: `storage.get` resolwuje `undefined` — guard `Buffer.isBuffer`.
- CodeGraph przed grepem (`codegraph explore`). Framework API (Next searchParams/server actions, zod v4 `.pick()`) przez context7 w razie wątpliwości — NIE z pamięci.
- **UI z makiety, nie z głowy** (`references/ui-planning.md`): mapowanie ekranów makiety (`raw/interactive-mockup/Wyceny - v2 - full code/` w wiki-repo, router `app.jsx:81-88`): krok 1 = `Screen1` (screens-1.jsx), krok 2 = `ScreenOgledziny` (screen-ogledziny.jsx), krok 3 = `Screen2` (screen2.jsx), krok 4 = `Screen3` (screen3.jsx), krok 5 = `Screen4`, krok 6 = `Screen5` (screens-4-5.jsx), krok 7 = `Screen6` (screen6.jsx), Stepper/FootNav = `shared.jsx:146-208`. Pomijamy teksty edukacyjne makiety (FR-13, rozstrzygnięcie 7 specu); klikalna makieta: `raw/interactive-mockup/Wyceny - Makieta MVP (standalone) - v3-r4-2026-06-30.html`.
- Flaga `NEXT_PUBLIC_WIZARD`: czytana WYŁĄCZNIE server-side (`process.env.NEXT_PUBLIC_WIZARD === "on"`); CI/e2e jej nie ustawia (stary formularz jeździ w smoke do Taska 12); prod Vercel jej nie ma (= off) do flipa. Kill-switch tymczasowy — znika w Tasku 12 razem ze starym kodem.

## File map (co powstaje / co się zmienia)

| Plik                                                       | Odpowiedzialność                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/drizzle/0010_wizard_wr_nullable.sql` (nowy)      | `ALTER TABLE valuation ALTER COLUMN stub_wr DROP NOT NULL`                                                                                |
| `apps/web/src/db/schema.ts`                                | `wr` bez `.notNull()`                                                                                                                     |
| `apps/web/src/ports/valuation.ts`                          | `wr: number \| null` (Valuation + NewValuationInput); nowe metody save*/confirmCalculation                                                |
| `apps/web/src/domain/valuation.ts`                         | `applySubjectUpdate`/`applySampleUpdate`/`applyFeaturesUpdate`/`applyCalculationConfirm`, `set_date` w `InspectionOp`, +4 `AUDIT_ACTIONS` |
| `apps/web/src/domain/wizard.ts` (nowy)                     | `WIZARD_STEPS`, `maxReachedStep`, `resolveStep`, `calculationReady` — czyste funkcje                                                      |
| `apps/web/src/domain/document-model.ts`                    | `documentFieldBlockers` + blocker `wr == null`                                                                                            |
| `apps/web/src/lib/assign-provenance.ts`                    | split: `assignSubjectProvenance`/`assignSampleProvenance`/`assignFeaturesProvenance` + rekompozycja `assignProvenance`                    |
| `apps/web/src/adapters/valuation-drizzle.ts`               | 4 nowe metody tx+audyt (wzorzec `updateInspection`); `updateInspection` zapisuje też `inspectionDate`                                     |
| `apps/web/src/app/actions/wizard.ts` (nowy)                | server actions: `createDraft`, `saveSubjectAction`, `saveSampleAction`, `saveFeaturesAction`, `confirmCalculationAction`                  |
| `apps/web/src/app/actions/inspection.ts`                   | `saveInspectionDate` (op `set_date`)                                                                                                      |
| `apps/web/src/app/valuations/new/subject-form.tsx` (nowy)  | krok 1 (create+edit) — header fields + SubjectSection + KwSection + orkiestracja fetch/KW                                                 |
| `apps/web/src/app/valuations/new/page.tsx`                 | switch: flaga on → SubjectForm; off → NewValuationForm                                                                                    |
| `apps/web/src/app/valuations/[id]/cards.tsx` (nowy)        | KcsBreakdown, badge'y, SubjectCard, KwCard, FeaturesCard, ComparablesProvenance — wyjęte z page.tsx                                       |
| `apps/web/src/app/valuations/[id]/stepper.tsx` (nowy)      | pasek 7 kroków (Linki `?step=N`, disabled poza maxReached) — wg `shared.jsx` Stepper                                                      |
| `apps/web/src/app/valuations/[id]/steps/step-*.tsx` (nowe) | komponenty kroków 2–7                                                                                                                     |
| `apps/web/src/app/valuations/[id]/page.tsx`                | branch: draft+flaga+owner → wizard switch; inaczej płaski widok (z cards)                                                                 |
| `apps/web/src/app/valuations/page.tsx`                     | lista: `wr == null` → „—"                                                                                                                 |
| `apps/web/e2e/smoke.spec.ts`                               | Task 12: migracja na flow wizarda                                                                                                         |
| USUNIĘTE w Tasku 12                                        | `new-valuation-form.tsx`, `actions/create-valuation.ts` + jego test, flaga (`valuation-form-schema.ts` NIETYKANY — importują go sekcje)   |

Fakty zbadane 2026-07-23 (nie odkrywaj ponownie): `audit_log.action` = `text NOT NULL` bez CHECK (0009); testy repo używają realnego Postgresa + `migrate(db, { migrationsFolder: "./drizzle" })` w `beforeAll` (wzorzec `tests/audit-log.test.ts`); `approvalGate` czyta provenance przez `entry?.status ?? "none"` (optional-safe); approve/sign liczą `computeKcs(inputs).wr` — kolumny `wr` używają TYLKO lista (L132) i detal (L597); `assignProvenance` jest jedynym ACL statusów (ADR-010). Advisor 2026-07-23: `approve-valuation.ts:54-61` JUŻ uruchamia `approvalGate` + `documentFieldBlockers` PRZED `computeKcs` (L68) — nowy blocker `wr` działa tam automatycznie, NIE dubluj guarda; `computeKcs` RZUCA na `comparables.length === 0` (`kcs.ts:105-107`); `subject-section.tsx:38` i `kw-section.tsx:22` typują `control: Control<FormInput, unknown, FormOutput>` na PEŁNYM `valuationFormSchema` (RHF `Control` jest inwariantny — podzbiór NIE jest przypisywalny); triggery 0009 (`valuation_write_once`) odpalają tylko na `OLD.status='signed'` — zero kolizji z mutacjami draftu; `rtl-map-preview.test.tsx` renderuje `SubjectSection` bezpośrednio (import typów ze schematu) — NIE wymaga migracji.

---

### Task 1: Migracja 0010 — `wr` nullable przez cały stack

**Files:**

- Modify: `apps/web/src/db/schema.ts:49` (drop `.notNull()`)
- Create: `apps/web/drizzle/0010_wizard_wr_nullable.sql` (via drizzle-kit)
- Modify: `apps/web/src/ports/valuation.ts:18,39` (`wr: number | null`)
- Modify: `apps/web/src/domain/document-model.ts:240` (`documentFieldBlockers` + typ `DocumentFields`)
- Modify: `apps/web/src/app/valuations/page.tsx:132`, `apps/web/src/app/valuations/[id]/page.tsx:595-599`
- Test: `apps/web/tests/wizard-wr-nullable.test.ts` (nowy)

**Interfaces:**

- Produces: `Valuation.wr: number | null`, `NewValuationInput.wr: number | null`; `documentFieldBlockers` zwraca blocker `{ path: "wr", label: "Wartość rynkowa — kalkulacja niezatwierdzona (krok 5. Kalkulacja)." }` gdy `wr == null`.
- Consumes: nic nowego.

- [ ] **Step 1: Failing test**

```ts
// apps/web/tests/wizard-wr-nullable.test.ts
import { describe, expect, it } from "vitest";
import { documentFieldBlockers } from "../src/domain/document-model";

const base = {
  purpose: "sprzedaz" as const,
  kwNumber: "PO1P/1/6",
  client: "p. Test",
  inspectionDate: "2026-07-01",
};

describe("documentFieldBlockers — wr (Slice 11a)", () => {
  it("blocks approval when wr is null (calculation not confirmed)", () => {
    const blockers = documentFieldBlockers({ ...base, wr: null });
    expect(blockers.some((b) => b.path === "wr")).toBe(true);
  });
  it("no wr blocker when wr is set", () => {
    const blockers = documentFieldBlockers({ ...base, wr: 1_044_400 });
    expect(blockers.some((b) => b.path === "wr")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/wizard-wr-nullable.test.ts`
Expected: FAIL (typ `DocumentFields` nie ma `wr` / brak blockera).

- [ ] **Step 3: Schema + typy + blocker**

W `apps/web/src/db/schema.ts:49`: `wr: doublePrecision("stub_wr"),` (bez `.notNull()`; zostaw komentarz ponytail o rename). W `ports/valuation.ts`: `wr: number | null` w OBU typach. W `document-model.ts`: dodaj `wr: number | null` do `DocumentFields` (to Pick/inline typ — otwórz i rozszerz) i do `documentFieldBlockers`:

```ts
if (v.wr == null)
  blockers.push({
    path: "wr",
    label: "Wartość rynkowa — kalkulacja niezatwierdzona (krok 5. Kalkulacja).",
  });
```

UWAGA: `buildDocumentModel` czyta `kcs.wr` (nie kolumnę) — nie dotykaj. `domain/valuation.ts` `newValuation`/`newVersionOf` przechodzą przez typ bez zmian kodu. Istniejące testy budujące obiekty dla `documentFieldBlockers` dostaną wymagane pole `wr` — uzupełnij fixture'y wartością liczbową (typecheck wskaże miejsca).

- [ ] **Step 4: Wygeneruj migrację**

Run (repo root): `pnpm --filter web exec drizzle-kit generate --name wizard_wr_nullable`
Expected: `apps/web/drizzle/0010_wizard_wr_nullable.sql` z DOKŁADNIE `ALTER TABLE "valuation" ALTER COLUMN "stub_wr" DROP NOT NULL;` — nic więcej. Jeśli drizzle-kit dorzuci szum — przytnij ręcznie TYLKO plik `.sql` (precedens 0003/0009 hand-edit); `meta/_journal.json` i snapshot zostawione tak, jak wygenerował drizzle-kit (`migrate()` odpala `.sql` wg journala — advisor MINOR-2).

- [ ] **Step 5: Rendering „—" + weryfikacja kolejności w approve**

Lista `valuations/page.tsx:132`: `{v.wr == null ? "—" : currencyFormatter.format(v.wr)}`. Detal `[id]/page.tsx:595-599` (karta podsumowania): analogicznie z zachowaniem `data-testid="wr-value"`. W `actions/approve-valuation.ts` NIC nie dodawaj — L54-61 JUŻ uruchamia `approvalGate` + `documentFieldBlockers` PRZED `computeKcs` (L68), więc nowy blocker `wr` blokuje częściowy szkic z polskim komunikatem automatycznie (advisor MINOR-1). Tylko ZWERYFIKUJ tę kolejność po swoich zmianach (otwórz plik, potwierdź, że `documentFieldBlockers` z nowym polem `wr` jest wołane przed każdym `computeKcs`).

- [ ] **Step 6: Testy + pełny gate lokalny**

Run: `pnpm --filter web exec vitest run tests/wizard-wr-nullable.test.ts` → PASS. Potem pełne: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → GREEN (testy repo przejdą migrację 0010 przez `migrate()` w beforeAll).

- [ ] **Step 7: Commit + push + CI**

```bash
git add -A && git commit -m "feat: migration 0010 - nullable wr for wizard partial drafts + wr approval blocker"
git push
```

Potem `gh run watch` na swoim sha → GREEN.

- [ ] **Step 8: ⛔ DDL na prodzie (wymaga GO usera — zgłoś kontrolerowi, NIE wykonuj sam jako subagent)**

Po zielonym CI kontroler pyta usera o GO i wykonuje:

```bash
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -c "ALTER TABLE valuation ALTER COLUMN stub_wr DROP NOT NULL;"'
```

Zastosowane WCZEŚNIE świadomie: DROP NOT NULL jest bezpieczny dla starego kodu, a Vercel auto-deployuje main — flip (Task 12) nie może wyprzedzić DDL.

---

### Task 2: Scoped provenance — split `assignProvenance`

**Files:**

- Modify: `apps/web/src/lib/assign-provenance.ts` (JEDYNY modyfikowany plik src — `provenance.ts` NIETYKANY, advisor BLOCKER-1)
- Test: `apps/web/tests/assign-provenance.test.ts` (istniejący MUSI zostać zielony bez zmian asercji) + nowe casy w tym pliku

**Interfaces:**

- Produces (z `@/lib/assign-provenance`):
  - `assignSubjectProvenance(values: Pick<ValuationFormValues, "area" | "subject" | "subjectMeta" | "kw" | "kwMeta">): Pick<InputsProvenance, "address" | "area"> & Partial<Pick<InputsProvenance, "ewidencja" | "mpzp" | "kw">>`
  - `assignSampleProvenance(values: Pick<ValuationFormValues, "comparables" | "sampleMeta">): { comparables: Comparable[]; geocode?: InputsProvenance["geocode"] }`
  - `assignFeaturesProvenance(features: ValuationFormValues["features"], comparableAreas: Array<number | undefined>): Pick<InputsProvenance, "weights" | "ratings" | "featureDefs">`
  - `assignProvenance(...)` — sygnatura i ZACHOWANIE bez zmian (rekompozycja trzech powyższych).

- [ ] **Step 1: Failing testy dla scoped helperów** (dopisz do `assign-provenance.test.ts`; wzoruj fixture'y na istniejących w tym pliku)

```ts
describe("scoped provenance (Slice 11a)", () => {
  it("assignSubjectProvenance: no subject/kw → only address+area confirmed", () => {
    const p = assignSubjectProvenance({
      area: 54.3,
      subject: undefined,
      subjectMeta: undefined,
      kw: undefined,
      kwMeta: undefined,
    });
    expect(p).toEqual({
      address: { source: "rzeczoznawca", status: "confirmed" },
      area: { source: "rzeczoznawca", status: "confirmed" },
    });
  });
  it("assignSampleProvenance: rcn rows to_verify, manual confirmed, geocode only with sampleMeta", () => {
    const r = assignSampleProvenance({
      comparables: [
        { pricePerM2: 12000, source: "rcn", transactionId: "t1" },
        { pricePerM2: 13000 },
      ],
      sampleMeta: undefined,
    });
    expect(r.comparables[0]!.status).toBe("to_verify");
    expect(r.comparables[1]!.status).toBe("confirmed");
    expect(r.geocode).toBeUndefined();
  });
  it("assignFeaturesProvenance: preset weights → to_verify", () => {
    const p = assignFeaturesProvenance(DEFAULT_FEATURES, []);
    expect(p.weights).toEqual({ source: "preset", status: "to_verify" });
    expect(p.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter web exec vitest run tests/assign-provenance.test.ts` → FAIL (brak eksportów).

- [ ] **Step 3: Implementacja splitu** (całość `assign-provenance.ts` po refaktorze; zachowaj istniejący JSDoc ACL):

```ts
export function assignSubjectProvenance(
  values: Pick<ValuationFormValues, "area" | "subject" | "subjectMeta" | "kw" | "kwMeta">,
): Pick<InputsProvenance, "address" | "area"> &
  Partial<Pick<InputsProvenance, "ewidencja" | "mpzp" | "kw">> {
  const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
  const areaFromDocument =
    values.kw != null &&
    values.kw.powUzytkowaKw != null &&
    Number(values.area) === values.kw.powUzytkowaKw;
  return {
    address: confirmed,
    area: areaFromDocument ? { source: values.kw!.source, status: "to_verify" } : confirmed,
    ...(values.subject
      ? {
          ewidencja: values.subjectMeta
            ? ({ source: "ewidencja", status: "to_verify" } as const)
            : confirmed,
          mpzp: values.subjectMeta ? ({ source: "mpzp", status: "to_verify" } as const) : confirmed,
        }
      : {}),
    ...(values.kw ? { kw: { source: values.kw.source, status: "to_verify" } as const } : {}),
  };
}

export function assignSampleProvenance(
  values: Pick<ValuationFormValues, "comparables" | "sampleMeta">,
): { comparables: Comparable[]; geocode?: InputsProvenance["geocode"] } {
  const comparables: Comparable[] = values.comparables.map((c) => ({
    ...c,
    source: c.source ?? "manual",
    status: c.source === "rcn" ? "to_verify" : "confirmed",
  }));
  return {
    comparables,
    ...(values.sampleMeta ? { geocode: { source: "geokoder", status: "to_verify" } as const } : {}),
  };
}

export function assignFeaturesProvenance(
  features: ValuationFormValues["features"],
  comparableAreas: Array<number | undefined>,
): Pick<InputsProvenance, "weights" | "ratings" | "featureDefs"> {
  const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
  const median = medianAreaM2(comparableAreas);
  return {
    weights: matchesPresetWeights(features)
      ? ({ source: "preset", status: "to_verify" } as const)
      : confirmed,
    ratings: confirmed,
    featureDefs: matchesPresetDefinitions(features, median)
      ? ({ source: "preset", status: "to_verify" } as const)
      : confirmed,
  };
}

export function assignProvenance(
  values: Pick<
    ValuationFormValues,
    "comparables" | "features" | "sampleMeta" | "subject" | "subjectMeta" | "kw" | "kwMeta" | "area"
  >,
): { comparables: Comparable[]; provenance: InputsProvenance } {
  const { comparables, geocode } = assignSampleProvenance(values);
  return {
    comparables,
    provenance: {
      ...assignSubjectProvenance(values),
      ...assignFeaturesProvenance(
        values.features,
        values.comparables.map((c) => c.area),
      ),
      ...(geocode ? { geocode } : {}),
    },
  };
}
```

`provenance.ts` NIETYKANY (advisor BLOCKER-1: optionalizacja `weights`/`ratings` wywala strict typecheck w `[id]/page.tsx:451-452`, `domain/valuation.ts:169` i testach `assign-provenance.test.ts:195` / `valuation-lifecycle.test.ts:213,369`). Typ `InputsProvenance` zostaje pełny; częściowy snapshot kroku 1 powstaje w Tasku 5 przez skomentowany cast `as InputsProvenance` — runtime-partial jest bezpieczny, bo gate czyta `entry?.status ?? "none"` (default-deny), a jedyne miejsca czytające `provenance.weights` bez guardu (`ComparablesProvenance`, `confirmFeaturesProvenance`) są osiągalne wyłącznie przy ustawionym `wr` / widocznym przycisku confirm (bramkowanie z Taska 7).

- [ ] **Step 4: GREEN** — cały plik testów (stare casy = regresja rekompozycji): `pnpm --filter web exec vitest run tests/assign-provenance.test.ts` → PASS. Pełny gate → GREEN.

- [ ] **Step 5: Commit + push + CI**

```bash
git commit -am "refactor: split assignProvenance into per-step scoped helpers"
```

---

### Task 3: Domena — operacje kroków + `wizard.ts`

**Files:**

- Modify: `apps/web/src/domain/valuation.ts`
- Create: `apps/web/src/domain/wizard.ts`
- Test: `apps/web/tests/wizard-domain.test.ts` (nowy)

**Interfaces:**

- Produces (z `@/domain/valuation`):
  - `type SubjectUpdate = { address: string; area: number; purpose: NonNullable<Valuation["purpose"]>; kwNumber: string | null; client: string; subject: KcsInput["subject"]; subjectMeta: KcsInput["subjectMeta"]; kw: KcsInput["kw"]; kwMeta: KcsInput["kwMeta"]; provenance: ReturnType<typeof assignSubjectProvenance> }` — ale domena NIE importuje z lib: zadeklaruj `provenance: Partial<InputsProvenance> & Pick<InputsProvenance, "address" | "area">`.
  - `applySubjectUpdate(v: Valuation, u: SubjectUpdate): Valuation`
  - `type SampleUpdate = { comparables: Comparable[]; sampleMeta: KcsInput["sampleMeta"]; geocode?: InputsProvenance["geocode"] }`; `applySampleUpdate(v, u): Valuation`
  - `type FeaturesUpdate = { features: KcsInput["features"]; provenance: Pick<InputsProvenance, "weights" | "ratings" | "featureDefs"> }`; `applyFeaturesUpdate(v, u): Valuation`
  - `applyCalculationConfirm(v: Valuation): Valuation` + `class CalculationNotReadyError extends Error`
  - `InspectionOp` += `{ kind: "set_date"; date: string }` (obsłużony w `applyInspectionOp` — ustawia KOLUMNĘ `inspectionDate`)
  - `AUDIT_ACTIONS` += `"subject_updated" | "sample_updated" | "features_updated" | "calculation_confirmed"`
- Produces (z `@/domain/wizard`): `WIZARD_STEPS` (7 wpisów `{ n, label }` — etykiety DOKŁADNIE: Przedmiot, Oględziny, Próba, Cechy, Kalkulacja, Opisy, Operat), `maxReachedStep(v: Pick<Valuation, "status" | "wr" | "inputs">): number`, `resolveStep(param: string | undefined, max: number): number`, `calculationReady(inputs: KcsInput | null): boolean`.

- [ ] **Step 1: Failing testy** (`tests/wizard-domain.test.ts`; zbuduj `draft` fixture jak w `tests/inspection-domain.test.ts` — draft z pełnym `inputs`; częściowy wariant: `comparables: []`, `features: []`):

```ts
// kluczowe casy (napisz wszystkie):
// applySampleUpdate: podmienia comparables+sampleMeta, NULLUJE wr, usuwa stary geocode gdy brak nowego, zachowuje resztę provenance
// applyFeaturesUpdate: podmienia features, NULLUJE wr, merguje weights/ratings/featureDefs, nie dotyka geocode/ewidencja
// applySubjectUpdate: podmienia kolumny address/area/purpose/kwNumber/client + inputs.subject/kw/area, NULLUJE wr,
//   usuwa stare klucze ewidencja/mpzp/kw z provenance gdy fragment ich nie niesie (subject odpięty), zachowuje geocode/weights
// applyCalculationConfirm: ustawia wr = computeKcs(inputs).wr; rzuca CalculationNotReadyError przy comparables.length < 3 lub features.length === 0
// każdy apply*: rzuca na status != in_progress (assertDraft) i na brak inputs
// applyInspectionOp set_date: ustawia v.inspectionDate ("" → null)
// maxReachedStep: partial draft → 3; z comparables → 4; z features → 5; wr != null → 7; status approved → 7
// resolveStep: undefined → max; "2" przy max 5 → 2; "9"/"x"/"0" przy max 5 → 5
// calculationReady: null → false; <3 comparables → false; 3 comparables + 1 feature → true
```

- [ ] **Step 2: RED** — `pnpm --filter web exec vitest run tests/wizard-domain.test.ts`.

- [ ] **Step 3: Implementacja w `domain/valuation.ts`** (siostrzana rodzina `applyInspectionOp` — te same idiomy assertDraft/throw-on-missing-inputs):

```ts
export type SubjectUpdate = {
  address: string;
  area: number;
  purpose: NonNullable<Valuation["purpose"]>;
  kwNumber: string | null;
  client: string;
  subject: KcsInput["subject"];
  subjectMeta: KcsInput["subjectMeta"];
  kw: KcsInput["kw"];
  kwMeta: KcsInput["kwMeta"];
  provenance: Partial<InputsProvenance> & Pick<InputsProvenance, "address" | "area">;
};

/** Step-1 edit (Slice 11a): replaces the subject/kw slice of the draft and
 * NULLs wr — changed engine inputs must never keep a stale confirmed amount. */
export function applySubjectUpdate(v: Valuation, u: SubjectUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  // Group keys owned by this step are REPLACED, not merged — a detached
  // subject must not leave stale ewidencja/mpzp/kw provenance behind.
  const { ewidencja: _e, mpzp: _m, kw: _k, ...rest } = v.inputs.provenance ?? {};
  const provenance = { ...rest, ...u.provenance } as InputsProvenance;
  return {
    ...v,
    address: u.address,
    area: u.area,
    purpose: u.purpose,
    kwNumber: u.kwNumber,
    client: u.client,
    wr: null,
    inputs: {
      ...v.inputs,
      area: u.area,
      subject: u.subject ?? null,
      subjectMeta: u.subjectMeta ?? null,
      kw: u.kw ?? null,
      kwMeta: u.kwMeta ?? null,
      provenance,
    },
  };
}

export type SampleUpdate = {
  comparables: Comparable[];
  sampleMeta: KcsInput["sampleMeta"];
  geocode?: InputsProvenance["geocode"];
};

export function applySampleUpdate(v: Valuation, u: SampleUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  const { geocode: _g, ...rest } = v.inputs.provenance ?? {};
  const provenance = { ...rest, ...(u.geocode ? { geocode: u.geocode } : {}) } as InputsProvenance;
  return {
    ...v,
    wr: null,
    inputs: { ...v.inputs, comparables: u.comparables, sampleMeta: u.sampleMeta, provenance },
  };
}

export type FeaturesUpdate = {
  features: KcsInput["features"];
  provenance: Pick<InputsProvenance, "weights" | "ratings" | "featureDefs">;
};

export function applyFeaturesUpdate(v: Valuation, u: FeaturesUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  const provenance = { ...v.inputs.provenance, ...u.provenance } as InputsProvenance;
  return { ...v, wr: null, inputs: { ...v.inputs, features: u.features, provenance } };
}

export class CalculationNotReadyError extends Error {
  constructor() {
    super("Calculation needs at least 3 comparables and 1 feature");
    this.name = "CalculationNotReadyError";
  }
}

/** Step-5 confirm: the ONLY place the wizard writes wr. Same engine call the
 * legacy create action used (F-1: computeKcs itself untouched). */
export function applyCalculationConfirm(v: Valuation): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to confirm`);
  if (v.inputs.comparables.length < 3 || v.inputs.features.length === 0) {
    throw new CalculationNotReadyError();
  }
  return { ...v, wr: computeKcs(v.inputs).wr };
}
```

Import `computeKcs` z `./kcs` (domain→domain, depcruise OK). `InspectionOp` += `{ kind: "set_date"; date: string }`; w `applyInspectionOp` gałąź:

```ts
} else if (op.kind === "set_date") {
  return { ...v, inspectionDate: op.date || null };
}
```

(przed gałęzią `set_note`; `set_date` nie dotyka `inputs`). `AUDIT_ACTIONS`: wstaw cztery nowe wpisy po `"created"`. Nowy plik `domain/wizard.ts`:

```ts
import type { KcsInput } from "./kcs";
import type { Valuation } from "../ports/valuation";

/** Wizard steps — labels are UI copy (Polish), mirror of mockup shared.jsx STEPS. */
export const WIZARD_STEPS = [
  { n: 1, label: "Przedmiot" },
  { n: 2, label: "Oględziny" },
  { n: 3, label: "Próba" },
  { n: 4, label: "Cechy" },
  { n: 5, label: "Kalkulacja" },
  { n: 6, label: "Opisy" },
  { n: 7, label: "Operat" },
] as const;

/**
 * Soft gating (spec decision 1): the furthest reachable step is DERIVED from
 * what the draft already holds — no separate progress state to migrate or
 * desync. Steps 2 (photos) and 6 (placeholder) are optional pass-throughs.
 */
export function maxReachedStep(v: Pick<Valuation, "status" | "wr" | "inputs">): number {
  if (v.status !== "in_progress" || v.wr != null) return 7;
  if ((v.inputs?.features?.length ?? 0) > 0) return 5;
  if ((v.inputs?.comparables?.length ?? 0) > 0) return 4;
  return 3;
}

export function resolveStep(param: string | undefined, max: number): number {
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) return max;
  return Math.min(n, max);
}

export function calculationReady(inputs: KcsInput | null): boolean {
  return inputs != null && inputs.comparables.length >= 3 && inputs.features.length > 0;
}
```

- [ ] **Step 4: GREEN** + pełny gate (istniejące `inspection-domain.test.ts`, `f7-immutability.test.ts` muszą zostać zielone).

- [ ] **Step 5: Commit + push + CI**

```bash
git commit -am "feat: draft step mutations, calculation confirm and wizard progress domain"
```

---

### Task 4: Repo + adapter — 4 nowe mutacje tx+audyt

**Files:**

- Modify: `apps/web/src/ports/valuation.ts` (4 metody)
- Modify: `apps/web/src/adapters/valuation-drizzle.ts`
- Test: `apps/web/tests/wizard-repo.test.ts` (nowy) + dopisz casy audytu do `apps/web/tests/audit-log.test.ts`

**Interfaces:**

- Produces (na `PortValuation`, kontrakt null/throw jak `updateInspection`):
  - `saveSubject(id: string, user: SessionUser, u: SubjectUpdate): Promise<Valuation | null>`
  - `saveSample(id: string, user: SessionUser, u: SampleUpdate): Promise<Valuation | null>`
  - `saveFeatures(id: string, user: SessionUser, u: FeaturesUpdate): Promise<Valuation | null>`
  - `confirmCalculation(id: string, user: SessionUser): Promise<Valuation | null>` (rzuca `CalculationNotReadyError`)
- Consumes: `applySubjectUpdate`/`applySampleUpdate`/`applyFeaturesUpdate`/`applyCalculationConfirm` z Taska 3.

- [ ] **Step 1: Failing testy** (`tests/wizard-repo.test.ts` — bootstrap 1:1 z `tests/audit-log.test.ts`: realny db, `migrate()`, seed usera). Casy:

```ts
// create z wr: null + inputs częściowy (comparables/features []) → wraca wr null
// saveSample: podmienia próbę, wr null; potem confirmCalculation → wr liczbą > 0
// saveSample PO confirmCalculation → wr znów null (inwalidacja)
// saveFeatures: preset → provenance.weights to_verify (fragment przekazany z testu)
// saveSubject: zmienia kolumny address/area i inputs.area
// confirmCalculation na partial (comparables []) → rejects CalculationNotReadyError
// owner isolation: inny user → null, zero zmian
// draft-only: po approve (użyj approvableInput fixture + repo.approve) każda z 4 metod → throw/null jak updateInspection
// audit: po każdej mutacji DOKŁADNIE jeden wiersz z akcją subject_updated/sample_updated/features_updated/calculation_confirmed
```

Fixture `partialInputs` zbuduj na wzór `tests/fixtures/valuation-inputs.ts` (otwórz go; dodaj tam eksport `partialDraftInputs` z `comparables: []`, `features: []`, `sampleMeta: null`, provenance tylko address+area confirmed).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementacja adaptera** — skopiuj kształt `updateInspection` (`valuation-drizzle.ts:211-250`: tx → `SELECT ... FOR UPDATE` → owner check → apply* → `UPDATE ... WHERE status='in_progress'` → `insertAudit` → `toValuation`). Cztery metody różnią się TYLKO: wywołaniem apply*, kolumnami w `.set(...)` i wpisem audytu:

| Metoda             | `.set({...})`                                                                  | insertAudit                                              |
| ------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| saveSubject        | `inputs, address, area, purpose, kwNumber, client, wr: null` (kolumna TS `wr`) | `subject_updated`, meta `{ kwAttached: u.kw != null }`   |
| saveSample         | `inputs, wr: null`                                                             | `sample_updated`, meta `{ count: u.comparables.length }` |
| saveFeatures       | `inputs, wr: null`                                                             | `features_updated`, meta `{ count: u.features.length }`  |
| confirmCalculation | `wr: updated.wr`                                                               | `calculation_confirmed`, meta `{ wr: updated.wr }`       |

Dodatkowo w ISTNIEJĄCYM `updateInspection` rozszerz `.set({ inputs: updated.inputs })` → `.set({ inputs: updated.inputs, inspectionDate: updated.inspectionDate })` (op `set_date` zapisuje kolumnę; meta op: `"date_updated"` w mapowaniu meta — rozszerz ternary).

- [ ] **Step 4: GREEN** (oba pliki testów + całe repo-testy). Pełny gate.

- [ ] **Step 5: Commit + push + CI**

```bash
git commit -am "feat: wizard draft mutations in valuation repo with per-step audit rows"
```

---

### Task 5: Server actions wizarda

**Files:**

- Create: `apps/web/src/app/actions/wizard.ts`
- Modify: `apps/web/src/app/actions/inspection.ts` (+`saveInspectionDate`)
- Test: `apps/web/tests/wizard-actions.test.ts` (nowy; wzorzec mocków `_deps` z `tests/inspection-actions.test.ts`)

**Interfaces:**

- Produces (`"use server"`, z `@/app/actions/wizard`):
  - `createDraft(input: Step1Input): Promise<{ error: string } | never>` — sukces = `redirect(`/valuations/${id}?step=2`)` (rzuca)
  - `saveSubjectAction(valuationId: string, input: Step1Input): Promise<{ error: string } | { ok: true }>`
  - `saveSampleAction(valuationId: string, input: SampleStepInput): Promise<{ error: string } | { ok: true }>`
  - `saveFeaturesAction(valuationId: string, input: FeaturesStepInput): Promise<{ error: string } | { ok: true }>`
  - `confirmCalculationAction(valuationId: string): Promise<{ error: string } | { ok: true }>`
  - eksporty typów: `Step1Input = z.input<typeof step1Schema>`, `step1Schema` (dla RHF resolvera w Tasku 6), `sampleStepSchema`, `featuresStepSchema`
- Produces (z `@/app/actions/inspection`): `saveInspectionDate(valuationId: string, date: string): Promise<{ error: string } | undefined>`
- Consumes: repo z Taska 4, scoped provenance z Taska 2, `normalizeKw` (`@/domain/kw-snapshot`), `isEmptySubject` (`@/lib/subject-form`), `normalizeDefinitions` (ten sam import co w `create-valuation.ts` — sprawdź źródło i skopiuj), wzorzec walidacji/komunikatów z `create-valuation.ts:91-131`.

- [ ] **Step 1: Failing testy** — casy:

```ts
// createDraft: poprawny payload krok-1 → repository.create dostaje wr: null,
//   inputs z comparables: [] i features: [], provenance bez weights/ratings; redirect rzuca
// createDraft: nieprawidłowy payload (brak client) → { error } po polsku
// createDraft: kwNumber wymagany bez kw extract (superRefine) → { error }
// saveSubjectAction: woła repo.saveSubject z znormalizowanym kw (normalizeKw) i fragmentem provenance
// saveSampleAction: % nie dotyczy próby — comparables przechodzą wprost po assignSampleProvenance
// saveFeaturesAction: weightPct/100 → weight; definicje przez normalizeDefinitions;
//   fragment provenance liczony z DOTYCHCZASOWYCH comparables (repo.get → areas)
// confirmCalculationAction: CalculationNotReadyError → { error: "Uzupełnij próbę (krok 3) i cechy (krok 4)." }
// saveInspectionDate: zła data ("2026-13-99", "abc") → { error }; dobra → updateInspection z op set_date
// każda akcja: brak sesji → redirect("/login"); repo null → { error } "Nie znaleziono wyceny..."
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementacja.** Schematy na górze `wizard.ts`:

```ts
import { valuationFormObject } from "@/lib/valuation-form-schema";

const step1Object = valuationFormObject.pick({
  address: true,
  area: true,
  subject: true,
  subjectMeta: true,
  kw: true,
  kwMeta: true,
  purpose: true,
  kwNumber: true,
  client: true,
});
export const step1Schema = step1Object.superRefine((values, ctx) => {
  if (!values.kw && !values.kwNumber) {
    ctx.addIssue({ code: "custom", path: ["kwNumber"], message: "Podaj numer księgi wieczystej." });
  }
});
export const sampleStepSchema = valuationFormObject.pick({ comparables: true, sampleMeta: true });
export const featuresStepSchema = valuationFormObject.pick({ features: true });
```

(`.pick()` na `valuationFormObject`, NIE na refined — zod v4 rzuca na refined, komentarz w `valuation-form-schema.ts:119-126`.) `createDraft` = kopia przepływu `create-valuation.ts` BEZ comparables/features/computeKcs:

```ts
const parsed = step1Schema.safeParse(input);
// ...obsługa błędów 1:1 jak create-valuation.ts:99-110 (invalid_type → polski fallback)
const normalizedKw = parsed.data.kw ? normalizeKw(parsed.data.kw) : parsed.data.kw;
const subjectTouched = !isEmptySubject(parsed.data.subject);
const effSubject = subjectTouched ? parsed.data.subject : undefined;
const effSubjectMeta = subjectTouched ? parsed.data.subjectMeta : undefined;
const provenance = assignSubjectProvenance({
  area: parsed.data.area,
  subject: effSubject,
  subjectMeta: effSubjectMeta,
  kw: parsed.data.kw,
  kwMeta: parsed.data.kwMeta,
});
const inputs: KcsInput = {
  area: parsed.data.area,
  comparables: [],
  features: [],
  sampleMeta: null,
  subject: effSubject ?? null,
  subjectMeta: effSubjectMeta ?? null,
  kw: normalizedKw ?? null,
  kwMeta: parsed.data.kwMeta ?? null,
  // Runtime-partial, type-full (advisor BLOCKER-1): weights/ratings arrive at
  // step 4; approvalGate default-denies missing entries, and every unguarded
  // provenance.weights read is reachable only once wr is set (Task 7 gating).
  provenance: provenance as InputsProvenance,
};
const created = await valuationRepository.create({
  address: parsed.data.address,
  area: parsed.data.area,
  wr: null,
  inputs,
  amountInWords: null,
  docUrl: null,
  purpose: parsed.data.purpose,
  kwNumber:
    parsed.data.kwNumber?.trim() || normalizedKw?.kwLokalu || normalizedKw?.kwGruntu || null,
  client: parsed.data.client,
  inspectionDate: null,
  ownerId: session.user.id,
});
redirect(`/valuations/${created.id}?step=2`);
```

`saveSubjectAction`: ta sama walidacja/normalizacja → `repo.saveSubject(valuationId, session.user, { address, area, purpose, kwNumber: ..., client, subject: effSubject ?? null, subjectMeta: effSubjectMeta ?? null, kw: normalizedKw ?? null, kwMeta: ..., provenance })` → `revalidatePath(`/valuations/${valuationId}`)` → `{ ok: true }`. `saveSampleAction`: `assignSampleProvenance(parsed.data)` → `repo.saveSample(id, user, { comparables, sampleMeta: parsed.data.sampleMeta ?? null, geocode })`. `saveFeaturesAction`: `const current = await valuationRepository.get(valuationId, session.user); if (!current) return { error: ... };` → `assignFeaturesProvenance(parsed.data.features, (current.inputs?.comparables ?? []).map(c => c.area))` → mapowanie features jak `create-valuation.ts:154-160` (`weightPct / 100`, `normalizeDefinitions`) → `repo.saveFeatures`. (Nota ponytail w kodzie: `// ponytail: median read outside the row lock — a concurrent sample edit skews only the preset-detection heuristic, not data.`) `confirmCalculationAction`: try/catch `CalculationNotReadyError`. `saveInspectionDate` w `inspection.ts`: walidacja `/^\d{4}-\d{2}-\d{2}$/.test(date) || date === ""`→`updateInspection(..., { kind: "set_date", date })`→`revalidatePath`(kształt błędów jak`saveInspectionNote`).

- [ ] **Step 4: GREEN** + pełny gate.

- [ ] **Step 5: Commit + push + CI**

```bash
git commit -am "feat: wizard server actions - create draft and per-step saves"
```

---

### Task 6: SubjectForm (krok 1) + `/valuations/new` za flagą

**Mockup:** krok 1 = `Screen1` (`screens-1.jsx:66`) — pola przedmiotu + KW; sidebar „Skąd te dane" = **11b, NIE buduj**. FootNav: primary „Dane się zgadzają — dalej". Pomiń teksty edukacyjne (FR-13).

**Files:**

- Create: `apps/web/src/app/valuations/new/subject-form.tsx` (`"use client"`)
- Modify: `apps/web/src/app/valuations/new/page.tsx` (switch na flagę)
- Test: `apps/web/tests/rtl-subject-form.test.tsx` (nowy); MIGRACJA `tests/rtl-kw-section.test.tsx` i `tests/rtl-map-preview-race.test.tsx` na render `<SubjectForm />` (mock `@/app/actions/wizard` zamiast `create-valuation`)

**Interfaces:**

- Produces: `SubjectForm({ valuationId, defaults }: { valuationId?: string; defaults?: Partial<FormInput> })` — bez `valuationId` = create (submit → `createDraft`); z = edit (submit → `saveSubjectAction` → `router.push(`/valuations/${valuationId}?step=2`)`).
- Consumes: `step1Schema`, `createDraft`, `saveSubjectAction` (Task 5); `SubjectSection`/`KwSection` (istniejące, props bez zmian); orkiestracja SKOPIOWANA z `new-valuation-form.tsx` (stary formularz ZAMROŻONY — nie dotykaj go; kopia żyje do Taska 12, potem oryginał znika).
- **TYPOWANIE (advisor BLOCKER-3):** `SubjectSection`/`KwSection` wymagają `control: Control<FormInput, unknown, FormOutput>` na PEŁNYM `valuationFormSchema` (`subject-section.tsx:38`, `kw-section.tsx:22`), a RHF `Control` jest inwariantny — `Control<podzbiór>` NIE przejdzie. Dlatego `SubjectForm` typuje `useForm` na PEŁNYCH `FormInput`/`FormOutput` (jak stary formularz), a WALIDUJE tylko krok 1 resolverem `step1Schema` przez skomentowany cast (Step 3). Pola spoza kroku 1 nigdy nie są rejestrowane; server action i tak re-waliduje `step1Schema` autorytatywnie.

- [ ] **Step 1: Failing test** (`rtl-subject-form.test.tsx` — mocki jak w `rtl-kw-section.test.tsx`, ale mockuj `@/app/actions/wizard`):

```tsx
// create mode: wypełnij address/area/purpose/kwNumber/client → submit „Dane się zgadzają — dalej"
//   → createDraftMock dostaje payload BEZ comparables/features/inspectionDate
// edit mode (valuationId + defaults): submit → saveSubjectActionMock(valuationId, payload); router.push("?step=2" na /valuations/{id})
// walidacja: pusty client → komunikat „Podaj zamawiającego wycenę.", akcja NIE wywołana
```

(mock `next/navigation`: `useRouter` → `{ push: pushMock }` — wzorzec znajdziesz przez `codegraph explore "useRouter mock in rtl tests"`; jeśli żaden test jeszcze nie mockuje routera, `vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }))`.)

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementacja `subject-form.tsx`.** Budowa = `new-valuation-form.tsx` okrojony do kroku 1. SKOPIUJ z niego (nie przenoś — plik źródłowy zostaje nietknięty):

- stałe i utile: `WORKER_URL` (L44), `toInputValue` (L85-87);
- stan i logika: `subjectFetch`/`mapPreview`/`kwSource`/`kwState`/`lastKwFile`/`kwSeq`/`areaSeededFromKw`/`lastFetchedAddress`/`fetchSeq` (L105-133), `fetchSubject` (L243-272), `onAddressBlur` (L274-281), `resetKwSection` (L319-341), `runKwExtraction` (L343-396), `onKwFileSelected` (L399-414), `areaMismatch` (L229-236), `kwValues`/`areaValue` watche (L182-183);
- JSX: header fields `address`/`area`/`purpose`/`client` (L427-505 — BEZ `inspectionDate` L506-516, przenosi się na krok 2), `<SubjectSection ...>` (L519-527), `<KwSection ...>` (L529-546).

Szkielet własny:

```tsx
import type { Resolver } from "react-hook-form";
import { valuationFormSchema } from "@/lib/valuation-form-schema";

// Typed on the FULL schema (SubjectSection/KwSection demand Control<FormInput,
// unknown, FormOutput> and RHF's Control is invariant — advisor BLOCKER-3),
// validated by the STEP-1 schema only. Fields outside step 1 are never
// registered here, and the server action re-validates with step1Schema, so
// the cast is contained to this one line.
type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;
const step1Resolver = zodResolver(step1Schema) as unknown as Resolver<
  FormInput,
  unknown,
  FormOutput
>;

export function SubjectForm({
  valuationId,
  defaults,
}: {
  valuationId?: string;
  defaults?: Partial<FormInput>;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ...skopiowany stan orkiestracji...
  const {
    control,
    handleSubmit,
    setValue,
    resetField,
    getValues,
    trigger,
    formState: { isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: step1Resolver,
    defaultValues: {
      address: "",
      area: "",
      purpose: "" as never,
      kwNumber: "",
      client: "",
      subject: { ...EMPTY_SUBJECT },
      subjectMeta: undefined,
      ...defaults,
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    // `values` is typed FormOutput (full) but runtime-shaped by step1Schema
    // (zod strips unregistered keys); the action re-parses with step1Schema.
    const result = valuationId
      ? await saveSubjectAction(valuationId, values)
      : await createDraft(values); // redirect on success — never returns
    if (result && "error" in result) {
      setSubmitError(result.error);
      return;
    }
    if (valuationId) router.push(`/valuations/${valuationId}?step=2`);
  });
  // ...JSX: FieldGroup header fields + SubjectSection + KwSection + submitError +
  // <Button type="submit">Dane się zgadzają — dalej</Button>
}
```

Edit-mode init KW: gdy `defaults?.kw` obecne — `useState<KwSource>(defaults.kw.source)` i `kwState` startowo `{ status: "done", summary: ... }` (policz summary jak L385-393). Mapowanie defaults w wywołującym (Task 7 poda z inputs; tu wyeksportuj helper):

```tsx
export function step1DefaultsFromInputs(v: {
  address: string;
  area: number;
  purpose: string | null;
  kwNumber: string | null;
  client: string | null;
  inputs: KcsInput | null;
}): Partial<FormInput> {
  return {
    address: v.address,
    area: String(v.area),
    purpose: (v.purpose ?? "") as never,
    kwNumber: v.kwNumber ?? "",
    client: v.client ?? "",
    subject: v.inputs?.subject
      ? { ...EMPTY_SUBJECT, ...subjectSnapshotToForm(v.inputs.subject) }
      : { ...EMPTY_SUBJECT },
    subjectMeta: v.inputs?.subjectMeta ?? undefined,
    kw: v.inputs?.kw ?? undefined,
    kwMeta: v.inputs?.kwMeta ?? undefined,
  };
}
```

(`subjectSnapshotToForm` = mapowanie pól liczbowych na stringi — napisz obok, 10 linii: powEwidHa/kondygnacje/rokBudowy przez `String()` gdy != null.) `new/page.tsx`: otwórz, zostaw obecny layout; render:

```tsx
{
  process.env.NEXT_PUBLIC_WIZARD === "on" ? <SubjectForm /> : <NewValuationForm />;
}
```

- [ ] **Step 4: Migracja `rtl-kw-section` + `rtl-map-preview-race`** — w obu: zamień import/render `NewValuationForm` → `SubjectForm`, mock `create-valuation` → mock `wizard` (createDraft/saveSubjectAction), usuń z mocków akcje nieużywane przez SubjectForm (`get-sample-proposal`). Asercje KW/map logiki BEZ zmian (ta sama logika, skopiowana).

- [ ] **Step 5: GREEN** — trzy pliki RTL + pełny gate (stary formularz dalej buduje się i przechodzi `rtl-features-section`).

- [ ] **Step 6: Commit + push + CI**

```bash
git commit -am "feat: step-1 subject form and wizard-flagged new valuation page"
```

---

### Task 7: Szkielet wizarda na `[id]` + kroki 6/7 (+ cards.tsx)

**Mockup:** Stepper = `shared.jsx:146-177` (numer w kropce, ✓ dla done, disabled poza maxReached, etykiety pod spodem); krok 6 = `Screen5`, krok 7 = `Screen6`. Krok 6 w 11a = placeholder (FR-6 bez backendu — decyzja specu).

**Files:**

- Create: `apps/web/src/app/valuations/[id]/cards.tsx` — przenieś z `page.tsx`: `KcsBreakdown`, `ProvenanceBadge`, `GroupProvenanceBadge`, `SubjectCard`, `KwDzialField`, `KwCard`, `FeaturesCard`, `ComparablesProvenance`, formattery (`currencyFormatter`, `plnPerM2`, `RATING_LABEL`, `LEVEL_LABEL`, `AREA_SOURCE_LABEL`, `provenanceStatusText`) — eksportuj: KcsBreakdown, SubjectCard, KwCard, FeaturesCard, ComparablesProvenance, currencyFormatter
- Create: `apps/web/src/app/valuations/[id]/stepper.tsx` (RSC)
- Create: `apps/web/src/app/valuations/[id]/steps/step-descriptions.tsx` (RSC)
- Create: `apps/web/src/app/valuations/[id]/steps/step-operat.tsx` (RSC)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (branch + searchParams + import z cards)
- Test: `apps/web/tests/rtl-stepper.test.tsx` (nowy)

**Interfaces:**

- Produces: `Stepper({ current, maxReached, valuationId }: { current: number; maxReached: number; valuationId: string })`; `StepDescriptions({ valuationId, step })`; `StepOperat({ valuation }: { valuation: Valuation })`; `WizardNav({ valuationId, back, next, nextLabel }: { valuationId: string; back?: number; next?: number; nextLabel?: string })` (współdzielony footer z Linkami — umieść w `stepper.tsx`).
- Consumes: `WIZARD_STEPS`/`maxReachedStep`/`resolveStep` (Task 3); `cards.tsx`; istniejące `ValuationActions`, `documentFieldBlockers`, `approvalGate`.

- [ ] **Step 1: Failing test** (`rtl-stepper.test.tsx` — Stepper to sync RSC bez hooków, renderuje się w RTL wprost):

```tsx
// render(<Stepper current={3} maxReached={4} valuationId="v1" />)
// → kroki 1-4: <a href="/valuations/v1?step=N">; kroki 5-7: brak <a> (span/disabled, aria-disabled)
// → krok 3 ma aria-current="step"; etykiety: Przedmiot…Operat (pełne diakrytyki)
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Stepper + WizardNav** (Tailwind, wygląd wg makiety — kropka z numerem/✓, label; bez shadcn tabs):

```tsx
import Link from "next/link";
import { Check } from "lucide-react";
import { WIZARD_STEPS } from "@/domain/wizard";
import { cn } from "@/lib/utils";

export function Stepper({
  current,
  maxReached,
  valuationId,
}: {
  current: number;
  maxReached: number;
  valuationId: string;
}) {
  return (
    <nav aria-label="Kroki wyceny" className="flex flex-wrap gap-1">
      {WIZARD_STEPS.map((s) => {
        const state = s.n < current ? "done" : s.n === current ? "active" : "todo";
        const reachable = s.n <= maxReached;
        const inner = (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs tabular-nums",
                state === "active" && "border-primary bg-primary text-primary-foreground",
                state === "done" && "border-primary/40 text-primary",
                state === "todo" && "border-border text-muted-foreground",
              )}
            >
              {s.n < current ? <Check className="size-3.5" /> : s.n}
            </span>
            <span
              className={cn(
                "text-sm",
                state === "active" ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </span>
        );
        return reachable ? (
          <Link
            key={s.n}
            href={`/valuations/${valuationId}?step=${s.n}`}
            aria-current={s.n === current ? "step" : undefined}
            className="rounded-md px-2 py-1 hover:bg-muted"
          >
            {inner}
          </Link>
        ) : (
          <span
            key={s.n}
            aria-disabled="true"
            className="cursor-not-allowed rounded-md px-2 py-1 opacity-50"
          >
            {inner}
          </span>
        );
      })}
    </nav>
  );
}

export function WizardNav({
  valuationId,
  back,
  next,
  nextLabel,
}: {
  valuationId: string;
  back?: number;
  next?: number;
  nextLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border pt-4">
      {back ? (
        <Button asChild variant="ghost">
          <Link href={`/valuations/${valuationId}?step=${back}`}>Wstecz</Link>
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button asChild>
          <Link href={`/valuations/${valuationId}?step=${next}`}>{nextLabel ?? "Dalej"}</Link>
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}
```

- [ ] **Step 4: cards.tsx + restrukturyzacja page.tsx.** Przenieś komponenty kart (page.tsx L27-464) do `cards.tsx` (czysty move — zero zmian logiki; page importuje). Page: dodaj `searchParams`, branch:

```tsx
export default async function ValuationViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  // ...istniejące: session, UUID_RE, get, NotFound...
  const wizardOn = process.env.NEXT_PUBLIC_WIZARD === "on";
  if (wizardOn && valuation.status === "in_progress" && valuation.ownerId === session.user.id) {
    const max = maxReachedStep(valuation);
    const step = resolveStep((await searchParams).step, max);
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Link href="/valuations" className="hover:text-primary">
              Wyceny
            </Link>{" "}
            / Operat
          </p>
          <h1 className="text-2xl font-semibold text-foreground">{valuation.address}</h1>
        </div>
        <Stepper current={step} maxReached={max} valuationId={valuation.id} />
        {step === 1 ? (
          <SubjectForm valuationId={valuation.id} defaults={step1DefaultsFromInputs(valuation)} />
        ) : step === 2 ? (
          <StepPlaceholder
            title="Oględziny"
            valuationId={valuation.id}
            back={1}
            next={3}
          /> /* → Task 8 podmienia na finalne wywołanie zdefiniowane w swoim Interfaces */
        ) : step === 3 ? (
          <StepPlaceholder
            title="Próba"
            valuationId={valuation.id}
            back={2}
            next={4}
          /> /* → Task 9 jw. */
        ) : step === 4 ? (
          <StepPlaceholder
            title="Cechy"
            valuationId={valuation.id}
            back={3}
            next={5}
          /> /* → Task 10 jw. */
        ) : step === 5 ? (
          <StepPlaceholder
            title="Kalkulacja"
            valuationId={valuation.id}
            back={4}
            next={6}
          /> /* → Task 11 jw. */
        ) : step === 6 ? (
          <StepDescriptions valuationId={valuation.id} />
        ) : (
          <StepOperat valuation={valuation} />
        )}
      </div>
    );
  }
  // ...istniejący płaski widok (approved/signed/admin-cudzy-draft/flaga off) — importy z cards
  // + OBOWIĄZKOWA zmiana warunków renderu (advisor BLOCKER-2): admin oglądający CUDZY
  // częściowy szkic po flipie ląduje na płaskim widoku, a computeKcs RZUCA na pustych
  // comparables (kcs.ts:105-107) i ComparablesProvenance czyta provenance.weights.source
  // (L451) — SSR 500 niewidoczny dla jednouserowego smoke. Zamień:
  //   {valuation.inputs ? <KcsBreakdown .../> : null}          → {valuation.wr != null && valuation.inputs ? <KcsBreakdown .../> : null}
  //   {valuation.inputs ? <ComparablesProvenance .../> : null} → {valuation.wr != null && valuation.inputs ? <ComparablesProvenance .../> : null}
  // (pozostałe karty — Subject/Kw/Features — czytają dane defensywnie i zostają jak są)
}
```

Dla kroków 2-5 (jeszcze niezbudowanych) wstaw JEDEN wspólny tymczasowy `StepPlaceholder({ title, valuationId, back, next })` (Card „W budowie — Task N" + WizardNav) zdefiniowany inline w page.tsx — kolejne taski go wypierają. `StepDescriptions` (finalny — to CAŁY zakres kroku 6 w 11a):

```tsx
export function StepDescriptions({ valuationId }: { valuationId: string }) {
  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <h2 className="text-sm font-medium text-foreground">Opisy</h2>
          <p className="text-sm text-muted-foreground">
            Generator prozy sekcji opisowych (FR-6) — w przygotowaniu. Opisy operatu powstają na
            razie deterministycznie z szablonu przy zatwierdzeniu.
          </p>
        </CardContent>
      </Card>
      <WizardNav valuationId={valuationId} back={5} next={7} />
    </>
  );
}
```

`StepOperat`: przenieś TĘ CZĘŚĆ dzisiejszego page.tsx, która dotyczy draftu (podsumowanie L588-605 z „—" dla wr null, blockery+ValuationActions L624-652, flagi has*/gate — L510-545): props `{ valuation: Valuation }`, wylicz w środku. Bez PDF iframe (draft nie ma dokumentu; po approve status flip → płaski widok). Na dole `WizardNav back={6}` (bez next).

- [ ] **Step 5: GREEN** (rtl-stepper + istniejące rtl-valuation-actions-* + pełny gate; flaga off w testach ⇒ stare testy widzą płaski widok bez zmian).

- [ ] **Step 6: Commit + push + CI**

```bash
git commit -am "feat: wizard shell with stepper, step switch and operat/descriptions steps"
```

---

### Task 8: Krok 2 — Oględziny

**Mockup:** `ScreenOgledziny` (screen-ogledziny.jsx) — sekcje zdjęć + notatka (JUŻ istnieją w `InspectionSection`); dodatek 11a: pole „Data oględzin" (przeniesione z nagłówka starego formularza — decyzja specu).

**Files:**

- Create: `apps/web/src/app/valuations/[id]/steps/step-inspection.tsx` (`"use client"`)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (podmień placeholder)
- Test: `apps/web/tests/rtl-step-inspection.test.tsx` (nowy)

**Interfaces:**

- Produces: `StepInspection({ valuationId, inspection, inspectionDate }: { valuationId: string; inspection: InspectionSnapshot | null; inspectionDate: string | null })` (page przekazuje z valuation; w page-switchu wołaj `<StepInspection valuationId={valuation.id} inspection={valuation.inputs?.inspection ?? null} inspectionDate={valuation.inspectionDate} />`).
- Consumes: istniejący `InspectionSection` (props `{ valuationId, inspection }` — bez zmian), `saveInspectionDate` (Task 5), `WizardNav`.

- [ ] **Step 1: Failing test** — render StepInspection z mockiem `@/app/actions/inspection`; zmiana daty + blur → `saveInspectionDateMock("v1", "2026-07-01")`; błąd akcji → komunikat inline; `InspectionSection` renderuje się (mockuj jego akcje jak w `rtl-inspection-section.test.tsx`).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementacja:**

```tsx
"use client";
export function StepInspection({
  valuationId,
  inspection,
  inspectionDate,
}: {
  valuationId: string;
  inspection: InspectionSnapshot | null;
  inspectionDate: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Card>
        <CardContent className="flex max-w-xs flex-col gap-2 pt-6">
          <FieldLabel htmlFor="inspectionDate">Data oględzin</FieldLabel>
          <Input
            id="inspectionDate"
            type="date"
            defaultValue={inspectionDate ?? ""}
            onBlur={async (e) => {
              setError(null);
              const result = await saveInspectionDate(valuationId, e.target.value);
              if (result?.error) setError(result.error);
              else router.refresh();
            }}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <InspectionSection valuationId={valuationId} inspection={inspection} />
      <WizardNav valuationId={valuationId} back={1} next={3} />
    </>
  );
}
```

(`WizardNav` jest RSC-stylowym komponentem bez hooków — import do klienta jest legalny.) W page.tsx podmień placeholder kroku 2.

- [ ] **Step 4: GREEN** + pełny gate. **Step 5: Commit + push + CI**

```bash
git commit -am "feat: wizard step 2 - inspection with inspection date field"
```

---

### Task 9: Krok 3 — Próba

**Mockup:** `Screen2` (screen2.jsx) — tabela transakcji + statystyki + akcje; pomiń AutoBanner edukacyjny poza statusowym „AI pobrało N transakcji" (zostaje — feedback operacyjny, rozstrzygnięcie 7).

**Files:**

- Create: `apps/web/src/app/valuations/[id]/steps/step-sample.tsx` (`"use client"`)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (podmień placeholder; przekaż `valuation`)
- Test: `apps/web/tests/rtl-step-sample.test.tsx` (nowy)

**Interfaces:**

- Produces: `StepSample({ valuationId, address, area, comparables, sampleMeta }: { valuationId: string; address: string; area: number; comparables: Comparable[]; sampleMeta: KcsInput["sampleMeta"] })`.
- Consumes: `sampleStepSchema`/`saveSampleAction` (Task 5), `getSampleProposal` (istniejąca akcja), `REQUIRED_SAMPLE_SIZE`.

- [ ] **Step 1: Failing test** (`rtl-step-sample.test.tsx`; mocki: `@/app/actions/wizard`, `@/app/actions/get-sample-proposal`):

```tsx
// defaults: 12 comparables z inputs → tabela ma 12 wierszy z cenami
// „Pobierz próbę z RCN" → getSampleProposal({address, area}) → wiersze podmienione, sampleMeta ustawione
// submit „Zatwierdź próbę i dalej" → saveSampleActionMock("v1", { comparables: [...], sampleMeta }) i router.push("/valuations/v1?step=4")
// <3 wierszy (usuń do 2) → błąd zod „co najmniej 3", akcja NIE wywołana
// <12 wierszy → widoczny amber hint o 12 (kopiuj tekst z starego formularza)
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementacja.** SKOPIUJ z `new-valuation-form.tsx`: `emptyComparable` (L65-69), `formatStat`/`numberFormatter` (L71-78), `toInputValue` (L85-87), sekcję JSX próby (L548-699 w CAŁOŚCI — tabela Controllerów, przyciski, statystyki Cmin/Cmax/Cśr, amber hint) oraz `onFetchSample` (L283-312; `getValues()` na address/area zamień na propsy `address`/`area`). Własny `useForm`:

```tsx
const {
  control,
  handleSubmit,
  setValue,
  formState: { isSubmitting, errors },
} = useForm({
  resolver: zodResolver(sampleStepSchema),
  defaultValues: {
    comparables: comparables.length
      ? comparables.map((c) => ({
          date: c.date ?? "",
          area: c.area != null ? String(c.area) : undefined,
          pricePerM2: String(c.pricePerM2),
          source: c.source,
          transactionId: c.transactionId,
        }))
      : [{ ...emptyComparable }, { ...emptyComparable }, { ...emptyComparable }],
    sampleMeta: sampleMeta ?? undefined,
  },
});
const onSubmit = handleSubmit(async (values) => {
  setSubmitError(null);
  const result = await saveSampleAction(valuationId, values);
  if ("error" in result) {
    setSubmitError(result.error);
    return;
  }
  router.push(`/valuations/${valuationId}?step=4`);
});
```

Submit button: `Zatwierdź próbę i dalej`. Footer: `WizardNav` tylko z `back={2}` (Dalej = submit). W page-switchu: `<StepSample valuationId={valuation.id} address={valuation.address} area={valuation.area} comparables={valuation.inputs?.comparables ?? []} sampleMeta={valuation.inputs?.sampleMeta ?? null} />`.

- [ ] **Step 4: GREEN** + pełny gate. **Step 5: Commit + push + CI**

```bash
git commit -am "feat: wizard step 3 - comparable sample with rcn fetch and draft save"
```

---

### Task 10: Krok 4 — Cechy

**Mockup:** `Screen3` (screen3.jsx) — tabela cech/wag/ocen + pula + definicje skali.

**Files:**

- Create: `apps/web/src/app/valuations/[id]/steps/step-features.tsx` (`"use client"`)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (podmień placeholder)
- Test: MIGRACJA `apps/web/tests/rtl-features-section.test.tsx` → render `<StepFeatures ...>` (zamiast całego NewValuationForm)

**Interfaces:**

- Produces: `StepFeatures({ valuationId, features, comparableAreas }: { valuationId: string; features: KcsInput["features"]; comparableAreas: Array<number | undefined> })`.
- Consumes: `featuresStepSchema`/`saveFeaturesAction` (Task 5), `FEATURE_PRESETS`/`DEFAULT_FEATURES`/`medianAreaM2`/`powierzchniaDefinitions`.

- [ ] **Step 1: Migracja testu na RED** — w `rtl-features-section.test.tsx`: render `<StepFeatures valuationId="v1" features={[]} comparableAreas={[]} />`, mock `@/app/actions/wizard`; zachowaj WSZYSTKIE dotychczasowe asercje logiki cech (pula zamknięta, usuń/dodaj, suma wag, definicje, powierzchnia-median) — dopasuj tylko selektory submitu; dodaj: submit → `saveFeaturesActionMock("v1", { features: [...] })` + `router.push("/valuations/v1?step=5")`. RED (komponent nie istnieje).

- [ ] **Step 2: Implementacja.** SKOPIUJ z `new-valuation-form.tsx`: `RATING_OPTIONS` (L50-56), sekcję JSX cech (L701-868), logikę puli (L219-222), `weightSum`/`weightsBalanced` (L196-197), efekt mediany powierzchni (L203-215 — UPROSZCZENIE: comparables są tu ZAMROŻONE propsem, więc zamiast efektu policz `powierzchniaDefinitions(medianAreaM2(comparableAreas))` raz przy budowie defaultValues dla PUSTYCH definicji powierzchni; ref `powDefsEdited` niepotrzebny — usuń). Defaults z inputs (fractions→%):

```tsx
defaultValues: {
  features: features.length
    ? features.map((f) => ({
        key: f.key as LokalFeatureKey, name: f.name,
        weightPct: Math.round(f.weight * 10000) / 100, rating: f.rating,
        definitions: {
          lepsza: f.definitions?.lepsza ?? "", przecietna: f.definitions?.przecietna ?? "", gorsza: f.definitions?.gorsza ?? "",
        },
      }))
    : DEFAULT_FEATURES,
}
```

Submit `Zatwierdź cechy i dalej` → `saveFeaturesAction` → `router.push(?step=5)`. `WizardNav back={3}`. Page-switch: `<StepFeatures valuationId={valuation.id} features={valuation.inputs?.features ?? []} comparableAreas={(valuation.inputs?.comparables ?? []).map((c) => c.area)} />`.

- [ ] **Step 3: GREEN** + pełny gate. **Step 4: Commit + push + CI**

```bash
git commit -am "feat: wizard step 4 - features and weights with draft save"
```

---

### Task 11: Krok 5 — Kalkulacja

**Mockup:** `Screen4` (screens-4-5.jsx:24) — wynik WR + rozbicie; feedback operacyjny zostaje, edukacja out.

**Files:**

- Create: `apps/web/src/app/valuations/[id]/steps/step-calculation.tsx` (RSC) + `apps/web/src/app/valuations/[id]/steps/confirm-calculation-button.tsx` (`"use client"`)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (podmień ostatni placeholder)
- Test: `apps/web/tests/rtl-confirm-calculation.test.tsx` (nowy, mały)

**Interfaces:**

- Produces: `StepCalculation({ valuation }: { valuation: Valuation })`; `ConfirmCalculationButton({ valuationId, confirmed }: { valuationId: string; confirmed: boolean })`.
- Consumes: `calculationReady` (Task 3), `computeKcs`, `KcsBreakdown`/`ComparablesProvenance` (cards), `confirmCalculationAction` (Task 5), `WizardNav`.

- [ ] **Step 1: Failing test** — `ConfirmCalculationButton`: klik → `confirmCalculationActionMock("v1")` → `router.push("/valuations/v1?step=6")`; błąd akcji → komunikat; `confirmed=true` → button „Przelicz ponownie i dalej"? NIE — YAGNI: `confirmed=true` → button z etykietą „Dalej" działa tak samo (re-confirm jest idempotentny i tani). Test: obie etykiety.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implementacja:**

```tsx
// step-calculation.tsx (RSC)
export function StepCalculation({ valuation }: { valuation: Valuation }) {
  const inputs = valuation.inputs;
  if (!calculationReady(inputs)) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <h2 className="text-sm font-medium text-foreground">Kalkulacja niedostępna</h2>
            <p className="text-sm text-muted-foreground">
              Uzupełnij próbę porównawczą (krok 3. Próba) i cechy z wagami (krok 4. Cechy), aby
              wyliczyć wartość rynkową.
            </p>
          </CardContent>
        </Card>
        <WizardNav valuationId={valuation.id} back={4} />
      </>
    );
  }
  return (
    <>
      {valuation.wr == null ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Dane wejściowe zmieniły się od ostatniej kalkulacji — zatwierdź ponownie, aby zapisać
          kwotę.
        </p>
      ) : null}
      <KcsBreakdown inputs={inputs!} />
      <ComparablesProvenance inputs={inputs!} />
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button asChild variant="ghost">
          <Link href={`/valuations/${valuation.id}?step=4`}>Wstecz</Link>
        </Button>
        <ConfirmCalculationButton valuationId={valuation.id} confirmed={valuation.wr != null} />
      </div>
    </>
  );
}
```

```tsx
// confirm-calculation-button.tsx
"use client";
export function ConfirmCalculationButton({
  valuationId,
  confirmed,
}: {
  valuationId: string;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await confirmCalculationAction(valuationId);
            if ("error" in result) {
              setError(result.error);
              return;
            }
            router.push(`/valuations/${valuationId}?step=6`);
          })
        }
      >
        {pending ? "Zapisywanie…" : confirmed ? "Dalej" : "Zatwierdź kalkulację i dalej"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: GREEN** + pełny gate. **Step 5: Commit + push + CI**

```bash
git commit -am "feat: wizard step 5 - kcs preview and calculation confirm"
```

---

### Task 12: Flip — wizard domyślny, stary formularz OUT, smoke na nowym flow

**Files:**

- Modify: `apps/web/src/app/valuations/new/page.tsx`, `apps/web/src/app/valuations/[id]/page.tsx` (usuń flagę — wizard bezwarunkowy dla draft+owner)
- Delete: `apps/web/src/app/valuations/new/new-valuation-form.tsx`, `apps/web/src/app/actions/create-valuation.ts`, `apps/web/tests/create-valuation-action.test.ts`
- Modify: `apps/web/e2e/smoke.spec.ts` (pełna migracja na wizard)

`apps/web/src/lib/valuation-form-schema.ts` NIETYKANY (advisor IMPORTANT-4): `valuationFormSchema` importują jako wartość zachowywane `kw-section.tsx:8`, `subject-section.tsx:9`, `subject-form.tsx` (typowanie z Taska 6) oraz testy `valuation-form-schema.test.ts` i `rtl-map-preview.test.tsx` — kasacja łamie typecheck poza listą planu. Refined schemat zostaje jako współdzielony typ-anchor sekcji; koszt utrzymania ≈ zero.

**Interfaces:** brak nowych — czysty flip + kasacja.

- [ ] **Step 1: Migracja smoke.spec.ts** (nowa zawartość obu testów; `login` bez zmian):

```ts
async function createDraftStep1(page: import("@playwright/test").Page) {
  await page.goto("/valuations/new");
  await page.locator("#address").fill("ul. Testowa 1, Poznań");
  await page.locator("#area").fill("54.3");
  await page.locator("#purpose").selectOption("sprzedaz");
  await page.locator("#kwNumber").fill("KW-TEST-1");
  await page.locator("#client").fill("p. Test Testowy");
  await page.getByRole("button", { name: "Dane się zgadzają — dalej" }).click();
  await page.waitForURL(/\/valuations\/[0-9a-f-]{36}\?step=2/);
}

async function walkToOperat(page: import("@playwright/test").Page, prices: string[]) {
  // step 2: data oględzin + dalej
  await page.locator("#inspectionDate").fill("2026-07-01");
  await page.locator("#inspectionDate").blur();
  await page.getByRole("link", { name: "Dalej" }).click();
  await page.waitForURL(/step=3/);
  // step 3: transakcje ręczne
  for (let i = 3; i < prices.length; i++)
    await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  for (const [i, price] of prices.entries())
    await page.locator(`#comparable-price-${i}`).fill(price);
  await page.getByRole("button", { name: "Zatwierdź próbę i dalej" }).click();
  await page.waitForURL(/step=4/);
  // step 4: preset cech
  await page.getByRole("button", { name: "Zatwierdź cechy i dalej" }).click();
  await page.waitForURL(/step=5/);
  // step 5: kalkulacja
  await expect(page.getByText("Suma współczynników (ΣUi)")).toBeVisible();
  await page.getByRole("button", { name: "Zatwierdź kalkulację i dalej" }).click();
  await page.waitForURL(/step=6/);
  // step 6: placeholder
  await page.getByRole("link", { name: "Dalej" }).click();
  await page.waitForURL(/step=7/);
}

test("wizard draft, 3 transactions: blocked by F-4 on operat step", async ({ page }) => {
  await login(page);
  await createDraftStep1(page);
  await walkToOperat(page, ["12000", "13000", "14000"]);
  await expect(page.getByTestId("gate-blockers")).toContainText("co najmniej 12");
  await expect(page.getByTestId("approve-button")).toBeDisabled();
});

test("wizard full flow: 12 transactions → approve → Zatwierdzony + PDF", async ({ page }) => {
  await login(page);
  await createDraftStep1(page);
  await walkToOperat(
    page,
    Array.from({ length: 12 }, (_, i) => String(12_000 + i * 100)),
  );
  await page.getByTestId("confirm-features-button").click();
  await expect(page.getByTestId("confirm-features-button")).toHaveCount(0);
  await expect(page.getByTestId("approve-button")).toBeEnabled();
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony", {
    timeout: 30_000,
  });
  const iframe = page.locator('iframe[title="Operat szacunkowy (PDF)"]');
  await expect(iframe).toBeVisible();
  const pdfResponse = await page.request.get((await iframe.getAttribute("src"))!);
  expect(pdfResponse.status()).toBe(200);
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
});
```

UWAGA: approve po drodze do „Zatwierdzony" przenosi z wizarda na płaski widok (status flip) — asercje statusu/PDF działają na płaskim widoku jak dziś. `confirm-features-button` żyje w `ValuationActions` na kroku 7.

- [ ] **Step 2: Usuń flagę + martwy kod.** W obu page.tsx zamień warunek `wizardOn && ...` na `valuation.status === "in_progress" && isOwner` / bezwarunkowy `<SubjectForm />`. Usuń pliki z listy Delete (TYLKO te trzy — `valuation-form-schema.ts` zostaje w całości). `grep -rn "NEXT_PUBLIC_WIZARD\|NewValuationForm\|createValuation\b" apps/web/src apps/web/tests apps/web/e2e` → ZERO trafień.

- [ ] **Step 3: Lokalny pełny gate + e2e**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → GREEN; potem `pnpm --filter web exec playwright test` (webServer podnosi się lokalnie; DB dev z migracją 0010) → GREEN.

- [ ] **Step 4: Commit + push + CI**

```bash
git commit -am "feat: flip to wizard flow, drop legacy single-form create path"
```

CI e2e MUSI być green — to jest fitness gate flipa.

---

### Task 13: ⛔ Deploy + weryfikacja prod (S5 — kontroler + user, NIE subagent)

- [ ] **Step 1: Pre-check** — DDL z Taska 1 zastosowany (`railway run ... "\d valuation"` → `stub_wr` nullable); CI main green; user daje GO (checkpoint c).
- [ ] **Step 2: Deploy web** — push z Taska 12 auto-deployuje Vercel; zweryfikuj `vercel ls` / dashboard, że deployment z sha flipa jest READY na https://wyceny-mu.vercel.app. Zero nowych env/sekretów (flaga usunięta, nie ustawiana).
- [ ] **Step 3: Weryfikacja prod E2E LIVE** (chrome-devtools; demo-login zenon=rzeczoznawca; pamiętaj: syntetyczny fill nie stawia React state — natywny setter + event):
  - nowy szkic przez wizard: krok 1 (adres „ul. Testowa QA 11a, Poznań", area, cel, KW `PO1P/1/6`, klient) → „Dalej" → URL `?step=2`; lista pokazuje szkic z „—";
  - kroki 2→7 przechodzą (RCN fetch na 3 może być realny — użyj „Pobierz próbę z RCN" i zweryfikuj AutoBanner); krok 5 pokazuje WR; po zatwierdzeniu kalkulacji lista pokazuje kwotę; szkic zostaje jako QA-draft (odnotuj id w ledgerze);
  - **wyceny QA NIETKNIĘTE:** `5faecc25`/`f9af0aba`/`11e60dde` (signed) → płaski widok read-only bez Steppera; draft `3c813f0e` (v2, wr ustawione) → wizard otwiera się na kroku 7, zdjęcia widoczne na kroku 2, ŻADNYCH mutacji;
  - `railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -c "SELECT action, count(*) FROM audit_log GROUP BY action ORDER BY 1;"'` → nowe akcje pojawiają się dla QA-draftu.
- [ ] **Step 4: Wpis w ledgerze** `.superpowers/sdd/progress.md` (# SLICE 11A — deploy verified) → dalej S6 (wiki-PR).

---

## Deferred / świadomie poza planem

- Panel „Skąd te dane", per-pole badge, DiscrepancyField — **Slice 11b** (osobny plan po deployu 11a).
- Confirm-akcje (potwierdź próbę/przedmiot/KW/cechy) zostają ZBIORCZO na kroku 7 (`ValuationActions` bez zmian) — rozważenie przeniesienia per krok = 11b/backlog.
- Kasowanie porzuconych szkiców — backlog (spec „Poza zakresem").
- `rtl-map-preview.test.tsx` — ROZSTRZYGNIĘTE (advisor): renderuje `SubjectSection` bezpośrednio, migracja NIEpotrzebna.
