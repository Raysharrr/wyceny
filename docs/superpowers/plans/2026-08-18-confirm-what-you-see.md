# Potwierdzasz to, co widzisz — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Potwierdzanie prowenancji wraca na kroki (przy widocznych danych), unieważnianie działa punktowo, a krok 7 pokazuje prawdziwy operat przed wydaniem.

**Architecture:** Trzy mechanizmy, jedna zasada — unieważniamy dokładnie to, co się zmieniło, i pokazujemy dokładnie to, co każemy potwierdzić. (A) każda sekcja prozy niesie własny odcisk podzbioru faktów; (B) przycisk stopki kroku scala zapis + potwierdzenie + przejście, a edycja zdejmuje `confirmed` punktowo; (C) krok 7 renderuje operat tą samą ścieżką co wydanie, z mapami pobranymi i zamrożonymi przy pierwszym podglądzie.

**Tech Stack:** Next.js (App Router, Server Actions), TypeScript, Drizzle/Postgres, Vitest + Playwright, worker FastAPI/Python (LibreOffice do PDF).

**Spec:** `docs/superpowers/specs/2026-08-18-confirm-what-you-see-design.md`

## Global Constraints

- **F-1**: `computeKcs` nie może czytać `prose` ani niczego z tego planu. Golden `apps/web/tests/golden-wr.test.ts` zielony po każdym zadaniu.
- **F-9**: repo publiczne. Wszystkie dane w testach, komentarzach i docstringach fikcyjne (`ul. Klonowa`, `m. Nowogród`). Skaner odrzuca ciągi w kształcie numeru KW — używać `KW-TEST-1`.
- **F-10**: `domain/` i `ports/` bez importów z `adapters/` i `app/`; `domain/` nie czyta `process.env`. `pnpm depcruise` zielone.
- **F-11**: do workera nie wychodzi WR ani jednostkowa wartość wyniku.
- **F-12**: szablon operatu tylko przez `build_template.py` (wiki-repo); nigdy ręcznie.
- **Prompt nietykalny**: bloki `### DANE` w `apps/worker/app/prompts/prose/*.md` zostają bez zmian — walidacja empiryczna (18 generacji) dotyczy pełnego słownika faktów.
- **Język**: kod i komentarze po angielsku; każdy tekst widoczny dla użytkownika po polsku, z pełną diakrytyką.
- **Środowisko lokalne**: 9 plików testowych wymaga bazy — uruchamiać z `DATABASE_URL="postgres://postgres:postgres@localhost:5433/wyceny"`. Rozjazd portu w `apps/web/.env` jest zastany, **nie naprawiać**.
- **Commity**: po każdym zadaniu, `git push` robi kontroler.

---

# ETAP 1 — odcisk per sekcja (zadania 1–5)

Po tym etapie koszt regeneracji spada proporcjonalnie do zmiany, a brama przestaje unieważniać teksty, których nikt nie ruszał. Etap jest samodzielny: można się tu zatrzymać i wdrożyć.

### Task 1: Mapa zależności sekcji + strażnik zgodności z promptami

**Files:**

- Modify: `apps/web/src/domain/prose.ts`
- Test: `apps/web/tests/prose-section-facts.test.ts` (create)

**Interfaces:**

- Produces: `PROSE_SECTION_FACTS: Record<ProseSection, readonly (keyof ProseFacts)[]>`, `SECTIONS_USING_TRANSACTIONS: ReadonlySet<ProseSection>`

- [ ] **Step 1: Write the failing test**

````ts
// apps/web/tests/prose-section-facts.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROSE_SECTIONS } from "@/domain/prose-snapshot";
import { PROSE_SECTION_FACTS, SECTIONS_USING_TRANSACTIONS } from "@/domain/prose";

/**
 * The dependency map duplicates a contract that lives in the worker's prompt
 * files: what a section is SHOWN in its few-shot `### DANE` blocks is what it
 * may write from. A map that drifts from the prompts would mark a section
 * fresh after a fact it actually uses changed — a stale operat nobody flags.
 */
const PROMPTS = "../worker/app/prompts/prose";

function factKeysFromPrompt(section: string): Set<string> {
  const raw = readFileSync(`${PROMPTS}/${section}.md`, "utf8");
  const keys = new Set<string>();
  for (const block of raw.matchAll(/### DANE\s*```json\s*([\s\S]*?)```/g)) {
    for (const key of Object.keys(JSON.parse(block[1]!) as Record<string, unknown>)) {
      keys.add(key);
    }
  }
  return keys;
}

describe("PROSE_SECTION_FACTS mirrors the prompts", () => {
  it("declares exactly the fact keys each section's few-shot shows it", () => {
    for (const section of PROSE_SECTIONS) {
      const fromPrompt = factKeysFromPrompt(section);
      // `dzielnica` appears in a few-shot example but the app never sends it
      // (no such field in the data model) — documented in the T5 report.
      fromPrompt.delete("dzielnica");
      expect(new Set(PROSE_SECTION_FACTS[section]), section).toEqual(fromPrompt);
    }
  });

  it("names the sections whose text depends on the sample's price trend", () => {
    // The worker injects `proba.trend_cen = price_trend(transakcje)` into the
    // shared facts, so these two must fingerprint the transactions as well.
    expect([...SECTIONS_USING_TRANSACTIONS].sort()).toEqual(["analiza_rynku", "uzasadnienie"]);
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/prose-section-facts.test.ts`
Expected: FAIL — `PROSE_SECTION_FACTS` nie istnieje.

- [ ] **Step 3: Add the map to `domain/prose.ts`** (po `ProseFacts`, przed `buildProseFacts`)

```ts
/**
 * What each section may write from — the subset of facts its few-shot shows
 * it. This is the basis of per-section staleness: a fact outside a section's
 * subset changing must NOT invalidate that section's text.
 *
 * Verified empirically before adoption (wiki-repo
 * `tools/spike/2026-08-18-odcisk-per-sekcja/`): across 3 runs x 6 sections,
 * no section used a fact outside its subset. The model receives the FULL
 * facts dict — the prompt is unchanged, only the fingerprint is scoped.
 *
 * `prose-section-facts.test.ts` pins this against the prompt files.
 */
export const PROSE_SECTION_FACTS: Record<ProseSection, readonly (keyof ProseFacts)[]> = {
  analiza_rynku: ["adres", "obreb", "pow_uzytkowa", "rynek", "proba"],
  opis_lokalu: ["pow_uzytkowa", "notatka_uklad"],
  otoczenie: ["notatka_otoczenie"],
  zagospodarowanie: [
    "nr_dzialki",
    "obreb",
    "pow_dzialki_m2",
    "uzytek",
    "budynek_rodzaj",
    "kondygnacje",
    "rok_budowy",
    "notatka_zagospodarowanie",
  ],
  standard: ["notatka_standard", "oceny_cech"],
  uzasadnienie: ["pozycja_wyniku", "proba"],
};

/**
 * Sections whose text reflects the sample's price trend. The trend is derived
 * by the worker FROM THE TRANSACTIONS, which travel outside `fakty`, so these
 * two sections must fingerprint the transactions too or a reordered-in-time
 * sample would leave a contradicted trend claim in the operat.
 */
export const SECTIONS_USING_TRANSACTIONS: ReadonlySet<ProseSection> = new Set([
  "analiza_rynku",
  "uzasadnienie",
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run tests/prose-section-facts.test.ts`
Expected: PASS (2 testy).

- [ ] **Step 5: Verify the guard bites**

Usuń tymczasowo `"rok_budowy"` z `zagospodarowanie`, uruchom test — MUSI być czerwony. Przywróć.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/domain/prose.ts apps/web/tests/prose-section-facts.test.ts
git commit -m "feat(web): per-section fact dependency map, pinned to the prompts"
```

---

### Task 2: Odcisk per sekcja w domenie

**Files:**

- Modify: `apps/web/src/domain/prose-hash.ts`
- Modify: `apps/web/src/domain/prose-snapshot.ts`
- Modify: `apps/web/src/domain/prose.ts` (`proseSnapshotOf`)
- Test: `apps/web/tests/prose-domain.test.ts` (extend), `apps/web/tests/prose-snapshot.test.ts` (extend)

**Interfaces:**

- Consumes: `PROSE_SECTION_FACTS`, `SECTIONS_USING_TRANSACTIONS` (Task 1)
- Produces: `currentSectionFactsHash(section, input): string`, `ProseSnapshot.factsHashes: Partial<Record<ProseSection, string>>`, `staleProseSections(snapshot, input): ProseSection[]`

- [ ] **Step 1: Write the failing test** (dopisz do `apps/web/tests/prose-domain.test.ts`)

```ts
describe("currentSectionFactsHash — scoped to what the section sees", () => {
  const base = { address: ADDRESS, inputs: INPUTS };

  it("a changed inspection note does NOT move the market-analysis fingerprint", () => {
    const edited = {
      address: ADDRESS,
      inputs: {
        ...INPUTS,
        inspection: { note: "Zupełnie inna notatka.", photos: INPUTS.inspection!.photos },
      },
    };
    expect(currentSectionFactsHash("analiza_rynku", edited)).toBe(
      currentSectionFactsHash("analiza_rynku", base),
    );
    expect(currentSectionFactsHash("otoczenie", edited)).not.toBe(
      currentSectionFactsHash("otoczenie", base),
    );
  });

  it("a changed feature rating moves ONLY standard and uzasadnienie", () => {
    const edited = {
      address: ADDRESS,
      inputs: {
        ...INPUTS,
        features: INPUTS.features.map((f, i) =>
          i === 0 ? { ...f, rating: "gorsza" as const } : f,
        ),
      },
    };
    const moved = PROSE_SECTIONS.filter(
      (s) => currentSectionFactsHash(s, edited) !== currentSectionFactsHash(s, base),
    );
    expect(moved.sort()).toEqual(["standard", "uzasadnienie"]);
  });

  it("changed EGiB data moves ONLY zagospodarowanie and analiza_rynku", () => {
    const edited = {
      address: ADDRESS,
      inputs: { ...INPUTS, subject: { ...INPUTS.subject!, obreb: "0099 Inny Obręb" } },
    };
    const moved = PROSE_SECTIONS.filter(
      (s) => currentSectionFactsHash(s, edited) !== currentSectionFactsHash(s, base),
    );
    expect(moved.sort()).toEqual(["analiza_rynku", "zagospodarowanie"]);
  });

  it("a changed comparable price moves ONLY the two sample-dependent sections", () => {
    const edited = {
      address: ADDRESS,
      inputs: {
        ...INPUTS,
        comparables: [{ ...COMPARABLES[0]!, pricePerM2: 9999 }, ...COMPARABLES.slice(1)],
      },
    };
    const moved = PROSE_SECTIONS.filter(
      (s) => currentSectionFactsHash(s, edited) !== currentSectionFactsHash(s, base),
    );
    expect(moved.sort()).toEqual(["analiza_rynku", "uzasadnienie"]);
  });

  it("reassigning which comparable carries which month moves the trend sections", () => {
    // Facts stay byte-identical; only the date-to-row mapping changes, which
    // flips the worker's deterministic trend.
    const swapped = [
      { ...COMPARABLES[0]!, date: COMPARABLES[1]!.date },
      { ...COMPARABLES[1]!, date: COMPARABLES[0]!.date },
      ...COMPARABLES.slice(2),
    ];
    const edited = { address: ADDRESS, inputs: { ...INPUTS, comparables: swapped } };
    expect(currentSectionFactsHash("analiza_rynku", edited)).not.toBe(
      currentSectionFactsHash("analiza_rynku", base),
    );
    expect(currentSectionFactsHash("otoczenie", edited)).toBe(
      currentSectionFactsHash("otoczenie", base),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/prose-domain.test.ts`
Expected: FAIL — `currentSectionFactsHash` nie istnieje.

- [ ] **Step 3: Implement in `domain/prose-hash.ts`** (zastąp `currentProseFactsHash`)

```ts
import {
  buildProseFacts,
  buildProseTransactions,
  PROSE_SECTION_FACTS,
  SECTIONS_USING_TRANSACTIONS,
  type ProseFacts,
  type ProseFactsInput,
} from "./prose";
import type { ProseSection } from "./prose-snapshot";

/**
 * Fingerprint of the facts ONE section was written from.
 *
 * Scoped on purpose: a global fingerprint marked all six sections stale when
 * any input moved, so a corrected transaction price threw away four confirmed
 * texts that could not have changed — and made the F-4 gate demand they be
 * read again. The subset comes from `PROSE_SECTION_FACTS`, which the prompt
 * files pin.
 */
export function currentSectionFactsHash(section: ProseSection, input: ProseFactsInput): string {
  const facts = buildProseFacts(input);
  const subset: Partial<ProseFacts> = {};
  for (const key of PROSE_SECTION_FACTS[section]) {
    if (facts[key] !== undefined) (subset as Record<string, unknown>)[key] = facts[key];
  }
  return sha256Canonical({
    facts: subset,
    // Sorted: the worker orders the sample chronologically before halving the
    // period, so row order is invisible to the model.
    transactions: SECTIONS_USING_TRANSACTIONS.has(section)
      ? [...buildProseTransactions(input.inputs.comparables)].sort((a, b) =>
          a.data === b.data ? a.cena_m2 - b.cena_m2 : a.data < b.data ? -1 : 1,
        )
      : [],
  });
}
```

- [ ] **Step 4: Change the snapshot shape in `domain/prose-snapshot.ts`**

Zamień pole `factsHash: string` na:

```ts
/**
 * Per-section fingerprint of the facts subset that section was written from
 * (or last accepted against). A section missing here reads as stale — that
 * is how snapshots written before this change migrate: one regeneration per
 * existing draft on the next visit to step 6.
 */
factsHashes: Partial<Record<ProseSection, string>>;
```

W `mergeProseProposal` zamień porównanie całej migawki na porównanie per sekcja:

```ts
const sections: ProseSnapshot["sections"] = {};
const rejected: ProseSnapshot["rejected"] = {};
const factsHashes: ProseSnapshot["factsHashes"] = {};
for (const section of PROSE_SECTIONS) {
  const kept = previous.sections[section];
  const incomingHash = incoming.factsHashes[section];
  if (isAppraisers(kept)) {
    // The appraiser's text survives regeneration — but if the facts BEHIND
    // THIS SECTION moved, it goes back to "to_verify": every character of it
    // predates the edit, and the fingerprint it would inherit says otherwise.
    const factsMoved = incomingHash !== undefined && incomingHash !== previous.factsHashes[section];
    sections[section] = factsMoved
      ? sourced(kept.value, kept.provenance.source, "to_verify")
      : kept;
    factsHashes[section] = incomingHash ?? previous.factsHashes[section];
    continue;
  }
  const fresh = incoming.sections[section];
  if (fresh) {
    sections[section] = fresh;
    factsHashes[section] = incomingHash;
  } else if (previous.factsHashes[section] !== undefined) {
    factsHashes[section] = previous.factsHashes[section];
  }
  const reason = incoming.rejected[section];
  if (reason && !fresh) rejected[section] = reason;
}
return {
  sections,
  rejected,
  factsHashes,
  model: incoming.model,
  generatedAt: incoming.generatedAt,
};
```

- [ ] **Step 5: Add `staleProseSections` to `domain/prose.ts`**

```ts
/**
 * Sections whose stored text no longer matches the facts behind them. Absent
 * fingerprint counts as stale (pre-change snapshots) — see `factsHashes`.
 */
export function staleProseSections(
  snapshot: Pick<ProseSnapshot, "sections" | "factsHashes"> | null | undefined,
  input: ProseFactsInput,
  currentHash: (section: ProseSection, input: ProseFactsInput) => string,
): ProseSection[] {
  if (!snapshot) return [];
  return PROSE_SECTIONS.filter((section) => {
    if (!snapshot.sections[section]) return false;
    return snapshot.factsHashes[section] !== currentHash(section, input);
  });
}
```

Uwaga F-10: `currentHash` wstrzykiwany, bo `prose-hash.ts` importuje `node:crypto`, a `prose.ts` musi zostać importowalny z komponentu klienckiego.

- [ ] **Step 6: Update `proseSnapshotOf` in `domain/prose.ts`**

`ProseProposalOutcome.factsHash: string` → `factsHashes: Partial<Record<ProseSection, string>>`; przypisz je w zwracanej migawce zamiast `factsHash`.

- [ ] **Step 7: Run the tests**

Run: `cd apps/web && DATABASE_URL="postgres://postgres:postgres@localhost:5433/wyceny" pnpm vitest run`
Expected: nowe testy PASS; zastane testy odwołujące się do `factsHash` czerwone — zaktualizuj je do `factsHashes` (to poprawny sygnał zmiany kontraktu, nie usterka).

- [ ] **Step 8: Verify the guard bites**

W `mergeProseProposal` ustaw `const factsMoved = false;` — test „a confirmed section goes back to to_verify" MUSI paść. Przywróć.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/domain apps/web/tests
git commit -m "feat(web): fingerprint prose per section, not per valuation"
```

---

### Task 3: Generowanie tylko nieaktualnych sekcji

**Files:**

- Modify: `apps/web/src/app/actions/propose-prose.ts`
- Modify: `apps/web/src/app/valuations/[id]/prose-step-props.ts`
- Test: `apps/web/tests/propose-prose.test.ts` (extend)

**Interfaces:**

- Consumes: `staleProseSections`, `currentSectionFactsHash` (Task 2)
- Produces: `proposeProse(id, opts?: { sections?: ProseSection[] })` — brak `opts` = sekcje nieaktualne albo nieistniejące

- [ ] **Step 1: Write the failing test**

```ts
it("regenerates only the sections whose facts moved", async () => {
  // draft with all six confirmed, then one comparable price edited
  const { fetchProposal } = setupWithStaleSample(); // helper w tym pliku
  await proposeProse(VALUATION_ID);
  expect(fetchProposal.mock.calls[0]![0].sections.sort()).toEqual([
    "analiza_rynku",
    "uzasadnienie",
  ]);
});
```

- [ ] **Step 2: Run it, expect FAIL** (dziś woła wszystkie sekcje z `selectProseSections`)

- [ ] **Step 3: Implement** — w `proposeProse` policz:

```ts
const generatable = selectProseSections(facts);
const stale = new Set(
  staleProseSections(valuation.inputs?.prose, factsInput, currentSectionFactsHash),
);
const sections = opts?.sections
  ? opts.sections.filter((s) => generatable.includes(s))
  : generatable.filter((s) => !valuation.inputs?.prose?.sections[s] || stale.has(s));
if (sections.length === 0) return { prose: valuation.inputs!.prose! };
```

- [ ] **Step 4: Run tests, expect PASS**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): generate only the sections whose facts moved"
```

---

### Task 4: Brama blokuje per sekcja

**Files:**

- Modify: `apps/web/src/domain/provenance.ts` (`GateInput.prose`, `GateOptions`)
- Modify: `apps/web/src/app/actions/approve-valuation.ts`
- Test: `apps/web/tests/f4-approval-gate.test.ts` (extend)

**Interfaces:**

- Consumes: `ProseSnapshot.factsHashes`
- Produces: `GateOptions.currentSectionHashes?: Partial<Record<ProseSection, string>>`

- [ ] **Step 1: Write the failing test**

```ts
it("blocks only the sections whose facts moved, and names them", () => {
  const gate = approvalGate(inputsWithConfirmedProse, {
    requireProse: true,
    currentSectionHashes: { ...hashes, analiza_rynku: "inny".repeat(16) },
  });
  expect(gate.ok).toBe(false);
  expect(gate.blockers.map((b) => b.path)).toEqual(["prose.analiza_rynku"]);
  expect(gate.blockers[0]!.label).toContain("Analiza i charakterystyka rynku");
  expect(gate.blockers[0]!.label).toContain("dane się zmieniły");
});
```

- [ ] **Step 2: Run it, expect FAIL**
- [ ] **Step 3: Implement** — zamień `GateOptions.currentFactsHash` na `currentSectionHashes`; bloker powstaje, gdy dla sekcji `snapshot.factsHashes[s] !== options.currentSectionHashes[s]`. Etykieta: `` `${PROSE_SECTION_LABEL[s]} — dane się zmieniły, przejrzyj ponownie.` ``
- [ ] **Step 4: Run tests, expect PASS**
- [ ] **Step 5: Verify the guard bites** — usuń porównanie hashy, test MUSI paść. Przywróć.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(web): the F-4 gate blocks the stale sections, not the snapshot"
```

---

### Task 5: Krok 6 — stan per sekcja i widoczny koszt

**Files:**

- Modify: `apps/web/src/app/valuations/[id]/steps/step-descriptions.tsx`
- Modify: `apps/web/src/app/valuations/[id]/prose-step-props.ts`
- Test: `apps/web/tests/rtl-step-descriptions.test.tsx` (extend)

**Interfaces:**

- Consumes: `staleProseSections`
- Produces: `StepDescriptionsProps.staleSections: ProseSection[]`, `StepDescriptionsProps.usage: { generations: number; grosze: number }`

- [ ] **Step 1: Write the failing test**

```ts
it("marks only the stale sections and offers to regenerate just those", () => {
  render(<StepDescriptions {...props} staleSections={["analiza_rynku"]} />);
  expect(screen.getByTestId("prose-stale-analiza_rynku")).toHaveTextContent("dane się zmieniły");
  expect(screen.queryByTestId("prose-stale-otoczenie")).toBeNull();
  expect(screen.getByRole("button", { name: /Wygeneruj ponownie 1 nieaktualną sekcję/ })).toBeEnabled();
});
```

- [ ] **Step 2: Run it, expect FAIL**
- [ ] **Step 2b: Add the audit read path — it does not exist yet**

`valuation-drizzle.ts` **zapisuje** wiersze `prose_generated`, ale `PortValuation` nie ma ani jednej metody, która czyta audyt. Bez niej licznika kosztu nie da się policzyć. Dodaj:

```ts
// ports/valuation.ts
/** Token usage recorded on this valuation's `prose_generated` audit rows. */
proseUsage(id: string, user: SessionUser): Promise<{
  generations: number;
  inputTokens: number;
  outputTokens: number;
}>;
```

Adapter sumuje `meta->>'inputTokens'` i `meta->>'outputTokens'` po wierszach `action = 'prose_generated'` dla tej wyceny, z tą samą kontrolą własności co `get`.

- [ ] **Step 3: Implement** — znacznik przy polu sekcji nieaktualnej; przycisk główny regeneruje **tylko nieaktualne** (`proposeProse(id)` bez opcji), a drugi, mniej wyeksponowany, „Wygeneruj wszystkie od nowa" woła `proposeProse(id, { sections: PROSE_SECTIONS })`.

Linia kosztu nad przyciskami. Przeliczenie tokenów na złotówki wymaga **dwóch** liczb, które starzeją się niezależnie od kodu — cennika modelu i kursu waluty — więc muszą stać w jednym miejscu, opisane datą i źródłem, a nie być rozsypane po komponencie:

```ts
/**
 * Token pricing for the cost line on step 6. Both numbers age on their own
 * schedule and neither is our data — hence one named constant carrying the
 * date it was taken and where from, instead of two anonymous literals in a
 * template string. Anything computed from it is prefixed "ok.".
 * Źródło: cennik Anthropic dla claude-sonnet-5, odczytany 2026-08-18;
 * kurs przyjęty 4,00 PLN/USD.
 */
const PROSE_PRICING_2026_08_18 = {
  usdPerInputToken: 3 / 1_000_000,
  usdPerOutputToken: 15 / 1_000_000,
  plnPerUsd: 4.0,
} as const;
```

Tekst linii: `Wygenerowano {generations} razy · {inputTokens + outputTokens} tokenów · koszt ok. {kwota} zł`. Liczba tokenów jest faktem zmierzonym i nie zestarzeje się nigdy; kwota jest szacunkiem i tak ma być nazwana.

- [ ] **Step 4: Run tests, expect PASS**
- [ ] **Step 5: Full gates**

```bash
cd apps/web && pnpm exec tsc --noEmit && DATABASE_URL="postgres://postgres:postgres@localhost:5433/wyceny" pnpm vitest run
cd ../.. && pnpm lint && pnpm depcruise && pnpm format:check && bash scripts/check-no-pii.sh
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(web): step 6 shows which sections went stale and what regeneration costs"
```

---

# ETAP 2 — potwierdzanie na krokach (zadania 6–8)

Po tym etapie potwierdzanie odbywa się przy widocznych danych, a krok 7 traci wszystkie przyciski potwierdzania.

### Task 6: Punktowe zdejmowanie potwierdzeń

**Files:**

- Modify: `apps/web/src/domain/valuation.ts` (`applySampleUpdate`, `applySubjectUpdate`, `applyFeaturesUpdate`)
- Test: `apps/web/tests/valuation-lifecycle.test.ts` (extend)

**Interfaces:**

- Produces: zachowanie — edycja zdejmuje `confirmed` wyłącznie z pozycji, które się zmieniły

- [ ] **Step 1: Write the failing test**

```ts
it("editing one comparable unconfirms that row and no other", () => {
  const confirmed = confirmSampleProvenance(draftWithTwelveConfirmed);
  const edited = applySampleUpdate(confirmed, {
    comparables: confirmed.inputs!.comparables.map((c, i) =>
      i === 6 ? { ...c, pricePerM2: 9999 } : c,
    ),
    sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    geocode: confirmed.inputs!.provenance?.geocode ?? null,
  });
  const statuses = edited.inputs!.comparables.map((c) => c.status);
  expect(statuses[6]).toBe("to_verify");
  expect(statuses.filter((s) => s === "confirmed")).toHaveLength(11);
});
```

- [ ] **Step 2: Run it, expect FAIL** (dziś zapis nie zdejmuje statusu wcale)
- [ ] **Step 3: Implement** — w `applySampleUpdate` dopasuj przychodzące transakcje do tych z migawki **po treści, nigdy po pozycji**:

```ts
/**
 * Identity of a comparable for the purpose of keeping its confirmation.
 * NOT the array index: deleting row 3 shifts every later row, and a
 * position-matched confirmation would then stay attached to a DIFFERENT
 * transaction than the one the appraiser verified — in a document with legal
 * effects, the worst failure this task could produce.
 */
function comparableKey(c: Comparable): string {
  return c.transactionId ?? `${c.date ?? ""}|${c.area ?? ""}|${c.pricePerM2}`;
}
```

Transakcja zachowuje `status` tylko wtedy, gdy w migawce istnieje wpis o **tym samym kluczu i wszystkich tych samych polach**; w każdym innym przypadku (zmiana, wstawienie, przesunięcie po usunięciu) → `status: "to_verify"`. Analogicznie `applySubjectUpdate` (grupa przedmiotu jako całość — to jedna migawka) i `applyFeaturesUpdate` (grupa cech).

- [ ] **Step 4: Run tests, expect PASS**
- [ ] **Step 4b: Write the delete/insert test**

```ts
it("deleting a row does not slide another row's confirmation onto it", () => {
  const confirmed = confirmSampleProvenance(draftWithTwelveConfirmed);
  const withoutThird = confirmed.inputs!.comparables.filter((_, i) => i !== 2);
  const edited = applySampleUpdate(confirmed, {
    comparables: withoutThird,
    sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    geocode: confirmed.inputs!.provenance?.geocode ?? null,
  });
  // The eleven survivors keep their own confirmations — matched by content,
  // so nothing shifted onto a neighbour.
  expect(edited.inputs!.comparables).toHaveLength(11);
  expect(edited.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
});
```

- [ ] **Step 5: Verify the guard bites** — zamień `comparableKey` na dopasowanie po indeksie; test z usunięciem wiersza MUSI paść. Przywróć.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(web): an edit unconfirms exactly what changed"
```

---

### Task 7: Kroki 1, 3 i 4 potwierdzają

**Files:**

- Modify: `apps/web/src/app/actions/wizard.ts` (`saveSubjectAction`, `saveSampleAction`, `saveFeaturesAction`)
- Modify: `apps/web/src/domain/valuation.ts` (`confirmSampleProvenance` — geokodowanie wychodzi)
- Test: `apps/web/tests/wizard-repo.test.ts`, `apps/web/tests/audit-log.test.ts` (extend)

**Interfaces:**

- Produces: akcje zapisu kroków wykonują zapis **i** potwierdzenie w jednej transakcji

- [ ] **Step 1: Write the failing test**

```ts
it("saving step 3 confirms the RCN sample in the same transaction", async () => {
  await saveSampleAction(id, sampleInput);
  const after = await repo.get(id, user);
  expect(after!.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
});

it("saving step 1 confirms the geocode — it belongs to the address, not the sample", async () => {
  await saveSubjectAction(id, subjectInput);
  const after = await repo.get(id, user);
  expect(after!.inputs!.provenance!.geocode!.status).toBe("confirmed");
});
```

- [ ] **Step 2: Run them, expect FAIL**
- [ ] **Step 3: Implement** — każda z trzech akcji po zapisie wykonuje odpowiadające potwierdzenie w tej samej transakcji repozytorium; `confirmSampleProvenance` przestaje dotykać `provenance.geocode`, a `confirmSubjectProvenance` zaczyna.
- [ ] **Step 4: Run tests (real Postgres), expect PASS**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): confirming happens on the step where the data is visible"
```

---

### Task 8: Krok 7 przestaje potwierdzać

**Files:**

- Modify: `apps/web/src/app/valuations/[id]/valuation-actions.tsx` (usuń cztery przyciski)
- Modify: `apps/web/src/app/valuations/[id]/steps/step-operat.tsx` (blokery z odnośnikami)
- Modify: `apps/web/e2e/smoke.spec.ts`
- Test: `apps/web/tests/rtl-step-operat.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it("offers no bulk confirmation, only a link to the step that holds the data", () => {
  render(<StepOperat {...propsWithSampleToVerify} />);
  expect(screen.queryByTestId("confirm-sample-button")).toBeNull();
  expect(screen.getByRole("link", { name: /przejdź do kroku 3/ })).toHaveAttribute(
    "href",
    expect.stringContaining("step=3"),
  );
});
```

- [ ] **Step 2: Run it, expect FAIL**
- [ ] **Step 3: Implement** — usuń `confirm-sample-button`, `confirm-subject-button`, `confirm-kw-button`, `confirm-features-button`; każdy bloker dostaje odnośnik do swojego kroku (mapa `path` → numer kroku).
- [ ] **Step 4: Update the smoke** — `smoke.spec.ts` klika dziś `confirm-features-button` na kroku 7; po zmianie potwierdzenie następuje na kroku 4, więc ten klik znika ze ścieżki.
- [ ] **Step 5: Run unit tests and the smoke**

```bash
cd apps/web && pnpm vitest run && pnpm build && pnpm e2e
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(web): step 7 reports state and links back; it no longer confirms"
```

---

# ETAP 3 — podgląd i wydanie (zadania 9–12)

### Task 9: Render podglądu i zamrożenie map

**Files:**

- Create: `apps/web/src/app/actions/preview-operat.ts`
- Modify: `apps/web/src/ports/valuation.ts`, `apps/web/src/adapters/valuation-drizzle.ts` (zapis zamrożonych map)
- Test: `apps/web/tests/preview-operat.test.ts` (create)

**Interfaces:**

- Produces: `previewOperat(id): Promise<{ url: string } | { error: string; mapsUnavailable?: boolean }>`

- [ ] **Step 1: Write the failing test**

```ts
it("fetches the maps once and freezes them on the valuation", async () => {
  await previewOperat(ID);
  await previewOperat(ID);
  expect(mapImages.fetchMaps).toHaveBeenCalledTimes(1);
});

it("a changed address unfreezes them — the map must show THIS parcel", async () => {
  // Maps are derived from the address: geokoder -> parcel -> bbox -> WMS.
  // Before this plan they were fetched at approval, so an address edit always
  // got fresh ones. Freezing them at preview introduces the failure this test
  // exists to prevent: previewing, correcting the address, then issuing a
  // signed operat carrying the PREVIOUS parcel's cadastral map and orthophoto.
  await previewOperat(ID);
  await saveSubjectAction(ID, { ...subjectInput, address: "ul. Brzozowa 8/21, Nowogród" });
  mapImages.fetchMaps.mockClear();
  await previewOperat(ID);
  expect(mapImages.fetchMaps).toHaveBeenCalledTimes(1);
});

it("never calls the language model", async () => {
  await previewOperat(ID);
  expect(proseProposal.fetchProposal).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them, expect FAIL**
- [ ] **Step 3: Implement**

Akcja renderuje `buildDocumentModel` → `renderOperatDocx` → `worker.convertToPdf`, zapisuje PDF do `storage` pod **stałym** kluczem `podglad-{id}.pdf` i zwraca URL. Mapy pobiera tylko wtedy, gdy przy wycenie nie ma ich zamrożonych **dla bieżącego adresu** (zamrożenie trzyma adres, z którego powstały — patrz test w kroku 1).

Trzy rzeczy do rozstrzygnięcia w kodzie, nie do przemilczenia:

1. **Dostęp.** `/api/docs/[key]` autoryzuje przez `getByDocKey`, które dopasowuje **wyłącznie** kolumny `docUrl`/`docxUrl` — klucz podglądu nie jest tam zarejestrowany, więc tą trasą byłby nieosiągalny. Dodaj osobną trasę `apps/web/src/app/api/podglad/[id]/route.ts`, autoryzującą przez `valuationRepository.get(id, session.user)` (własność wyceny) i strumieniującą blob ze `storage`. Nie rejestruj podglądu w `docUrl` — ta kolumna oznacza dokument **wydany**.
2. **Cykl życia.** Stały klucz `podglad-{id}.pdf` znaczy, że każdy kolejny render **nadpisuje** poprzedni: jedna wycena to jeden blob podglądu, bez narastania sierot przy każdej zmianie faktów.
3. **Sprzątanie po wydaniu.** Wydanie operatu usuwa blob podglądu — od tej chwili obowiązuje dokument wydany, a dwa pliki różniące się tylko datą to zaproszenie do pomyłki.

- [ ] **Step 4: Run tests, expect PASS**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): render the operat for preview and freeze its maps"
```

---

### Task 10: Krok 7 — trzy stany i czytnik

**Files:**

- Modify: `apps/web/src/app/valuations/[id]/steps/step-operat.tsx`
- Test: `apps/web/tests/rtl-step-operat.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it("with blockers: no automatic render, an explicit button instead", () => {
  render(<StepOperat {...propsWithBlockers} />);
  expect(previewOperat).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Pokaż podgląd mimo braków" })).toBeEnabled();
});

it("without blockers: renders by itself and embeds the reader without its chrome", async () => {
  render(<StepOperat {...propsReady} />);
  const frame = await screen.findByTitle("Podgląd operatu (PDF)");
  expect(frame).toHaveAttribute("src", expect.stringContaining("#toolbar=0&navpanes=0"));
});
```

- [ ] **Step 2: Run them, expect FAIL**
- [ ] **Step 3: Implement** — trzy stany z sekcji C specu; iframe pełnej szerokości, `className="h-[85vh] w-full"`, `src={url + "#toolbar=0&navpanes=0"}`.
- [ ] **Step 4: Run tests, expect PASS**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): step 7 shows the document it asks you to take responsibility for"
```

---

### Task 11: Zaślepki w podglądzie, cisza w wydanym operacie

**Files:**

- Modify: `apps/web/src/domain/document-model.ts` (`buildDocumentModel(input, opts?: { preview?: boolean })`)
- Modify: wiki-repo `tools/spike/2026-07-15-template-koscielna/build_template.py` (tag zaślepki)
- Test: `apps/web/tests/docx-render-prose.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it("preview marks a missing section; the issued operat stays silent about it", () => {
  const preview = docText(renderOperatDocx(buildDocumentModel(inputNoProse, { preview: true })));
  const issued = docText(renderOperatDocx(buildDocumentModel(inputNoProse)));
  expect(preview).toContain("Analiza i charakterystyka rynku — brak treści");
  expect(issued).not.toContain("brak treści");
});
```

- [ ] **Step 2: Run it, expect FAIL**
- [ ] **Step 3: Implement** — przy `preview: true` puste `proza_*` dostaje tekst zaślepki z nazwą sekcji i powodem, a odpowiadająca flaga `ma_proza_*` jest prawdziwa, żeby blok się wydrukował. Przy wydaniu bez zmian.
- [ ] **Step 4: Run tests, expect PASS**
- [ ] **Step 5: Commit** (dwa repozytoria, jeśli szablon wymagał zmiany)

---

### Task 12: „Zatwierdź i generuj operat" + Pomoc

**Files:**

- Modify: `apps/web/src/app/valuations/[id]/valuation-actions.tsx` (nazwa i semantyka przycisku)
- Modify: `apps/web/src/app/actions/approve-valuation.ts` (używa zamrożonych map, nie pobiera)
- Modify: `apps/web/src/content/pomoc/jak-korzystac/krok-7-operat.mdx`, `krok-1-przedmiot.mdx`, `krok-3-proba.mdx`, `krok-4-cechy.mdx`, `metodyka/zasady-zatwierdzania.mdx`
- Test: `apps/web/tests/approve-valuation-action.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
it("issuing after a preview does not go back to Geoportal", async () => {
  await previewOperat(ID);
  mapImages.fetchMaps.mockClear();
  await approveValuationAction(ID);
  expect(mapImages.fetchMaps).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it, expect FAIL**
- [ ] **Step 3: Implement** — approve czyta zamrożone mapy; przycisk nazywa się „Zatwierdź i generuj operat".
- [ ] **Step 4: Update Help** — krok 7 opisuje podgląd i trzy stany; kroki 1/3/4 opisują, że przycisk stopki potwierdza; `zasady-zatwierdzania` opisuje blokowanie per sekcja. Progi i nazwy importować z kodu, nie przepisywać.
- [ ] **Step 5: Full gates + smoke**

```bash
cd apps/web && pnpm exec tsc --noEmit && DATABASE_URL="postgres://postgres:postgres@localhost:5433/wyceny" pnpm vitest run && pnpm build && pnpm e2e
cd ../.. && pnpm lint && pnpm depcruise && pnpm format:check && bash scripts/check-no-pii.sh
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(web): issue the operat you just read"
```
