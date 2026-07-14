# Spec — Slice 3: Prowenancja `Sourced<T>` E2E + brama gatingu (F-4)

> Data: 2026-07-14 · Status: zatwierdzony przez usera (brainstorm S1, checkpoint a)
> Item roadmapy: wiki `wiki/roadmap.md` 🟢 NOW (promowany 2026-07-14) · `Must-Legal` (pre-mortem #1, AC-3)
> ADR-y wiążące: ADR-010 (Sourced<T> jako ściśle ograniczony Shared Kernel, status nadawany na ACL web-side),
> ADR-012 (gating jako synchroniczny process manager — inwariant agregatu, nie UI)

## 1. Outcome i Definition of Done

Każda wartość wejściowa operatu niesie zapisaną prowenancję (`source` + `status`), a operat przechodzi
cykl **szkic → zatwierdzony**, przy czym zatwierdzenie blokuje brama F-4 (inwariant agregatu, nie UI),
dopóki: cokolwiek jest `to_verify`/`none` **lub** próba ma <12 transakcji.

**DoD:**

- prowenancja E2E: formularz → ACL (web) → snapshot `inputs` → odczyt na stronie detalu,
- brama F-4 w CI (testy jednostkowe bramy + integracyjny na akcji zatwierdzenia, bez sieci),
- przepływ szkic → potwierdź próbę → zatwierdź działa na prodzie, zweryfikowany na żywo,
- F-5 rozszerzone o roundtrip prowenancji przez prawdziwego Postgresa,
- stare operaty z prod czytają się bez zmian (back-compat).

## 2. Model cyklu życia wyceny

- **Zapis z formularza = szkic** (`status: 'draft'`). Zapisuje się od ≥3 transakcji jak dziś;
  amber ostrzeżenie `<12` zostaje, copy rozszerzone o konsekwencję („zatwierdzenie będzie wymagało 12").
- **Na szkicu dozwolone są dokładnie dwie mutacje**: (a) potwierdzenie prowenancji (bulk),
  (b) zatwierdzenie. **Ogólna edycja szkicu — poza zakresem slice'a.**
- **Zatwierdzenie** (`status: 'approved'` + `approved_at`) — tylko właściciel, tylko gdy brama
  przepuszcza; po zatwierdzeniu operat zamrożony na poziomie akcji (twarda niezmienność DB-level
  przyjdzie ze slice'em F-7).
- **Migracja DB** (pierwsza DDL od Slice 0): kolumny `status` (`'draft' | 'approved'`) + `approved_at`
  (timestamptz, null). **Istniejące wiersze z prod backfill na `'approved'`** — powstały jako kompletne
  zapisy w starym modelu; brama ich nie dotyczy. Nowe inserty ustawiają status jawnie (`'draft'`).

## 3. Prowenancja — nadawanie i zapis

### Nadawanie (ACL web-side, ADR-010)

Status nadawany **wyłącznie serwerowo na granicy ACL**, z ignorowaniem claimów klienta:

| Wartość                                           | source         | status przy zapisie szkicu |
| ------------------------------------------------- | -------------- | -------------------------- |
| wiersz próby z fetchu RCN (`source: "rcn"`)       | `rcn`          | **zawsze** `to_verify`     |
| wiersz próby wpisany ręcznie (`source: "manual"`) | `rzeczoznawca` | `confirmed`                |
| adres, powierzchnia, wagi, oceny (ręczne)         | `rzeczoznawca` | `confirmed`                |
| geokod (`sampleMeta.lat/lon`)                     | `geokoder`     | `to_verify`                |

Worker i jego JSON **nietknięte** (F-11, ADR-009) — worker fizycznie nie może ogłosić `confirmed`.

### Zapis (snapshot `inputs`, wariant „dopisz obok")

- `status` inline na wierszach `comparables[]` (obok istniejących `source`/`transactionId`),
- zwarta mapa `provenance` dla skalarów: `{ address, area, weights, ratings, geocode }` →
  `{ source, status }`,
- pola **opcjonalne w zod** → stare dokumenty z prod parsują się bez zmian (brak prowenancji = legacy).

### Zaostrzenie kernela (`packages/shared` — zmiana za review-gate z ADR-010)

- `source`: `string` → zamknięty enum z ADR-010:
  `geokoder | ewidencja | mpzp | odpis_kw | akt | rcn | ogledziny | rzeczoznawca`,
- usunięcie cichego defaultu `status = "confirmed"` z helpera `sourced()` — jawny status obowiązkowy
  (literalnie zasada „brak cichych defaultów"),
- `isBlocking()` bez zmian.
- Istniejące pole `source: "rcn" | "manual"` na wierszach próby zostaje jako **tag danych**
  (back-compat); domena mapuje `manual` → `rzeczoznawca`.

## 4. Brama F-4 — czysta domena

Nowy moduł domenowy (pure, zero I/O, za F-10):

- `toSourcedInputs(inputs)` — składa ze snapshotu pełne `Sourced<T>` per wartość (kernel first-class,
  `isBlocking()` robi robotę),
- `approvalGate(inputs)` → `{ ok: true }` | `{ ok: false, blockers: Blocker[] }` — blocker per każda
  wartość `to_verify`/`none` (ścieżka + polska etykieta) + blocker licznika transakcji `<12`.

**Testy F-4 (wchodzą do CI tym slice'em, bez sieci):**

- jednostkowe na bramie: blokuje na `to_verify` / `none` / `<12 tx`; przepuszcza komplet
  `confirmed` + `≥12`,
- integracyjny na akcji zatwierdzenia: **serwer liczy bramę ze snapshotu w DB, nie ufa klientowi** —
  próba obejścia przez bezpośrednie wywołanie API odbija się.

## 5. Server actions + UI

### Akcje (obie: właściciel + tylko szkic)

- `confirm-sample` (nowa): flipuje `to_verify` → `confirmed` dla wierszy RCN + geokodu
  (jedyna dozwolona mutacja treści szkicu),
- `approve-valuation` (nowa): re-run bramy serwerowo na snapshotcie; ustawia `approved` + `approved_at`.

### UI (copy po polsku, pełne diakrytyki)

- **Strona detalu**: badge statusu operatu (Szkic / Zatwierdzony), badge prowenancji per wiersz próby
  („RCN — do weryfikacji" amber / „potwierdzone"), przycisk **„Potwierdź próbę z RCN"**, przycisk
  **„Zatwierdź operat"** — nieaktywny z widoczną listą blockerów, aktywny gdy brama przepuszcza;
  po zatwierdzeniu data zatwierdzenia i zamrożony widok. Stare operaty bez prowenancji renderują się
  jak dotąd (bez badge'y, status `Zatwierdzony` z backfillu).
- **Formularz**: przycisk → „Zapisz szkic", rozszerzone copy amber. **`smoke.spec` aktualizowany
  w tym samym tasku co zmiana formularza** (reguła ze Slice 2).
- **Lista wycen**: kolumna/badge statusu.

## 6. Testy, CI, deploy

- TDD per task (RED→GREEN), świeży implementer + niezależny reviewer per task, commit+push per task,
  ledger `.superpowers/sdd/progress.md`, briefy `srcd-task-N-*.md`.
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` →
  commit → push → `gh run watch --exit-status`.
- F-5 rozszerzone: roundtrip prowenancji (status inline + mapa skalarów) przez prawdziwego Postgresa.
- Smoke e2e (offline, bez sieci): ścieżka zablokowana (3 ręczne tx → zatwierdzenie odbite z widoczną
  listą blockerów) + ścieżka pełna (12 ręcznych tx → szkic → zatwierdź → Zatwierdzony).
- Framework API (Next/RHF/zod/Drizzle): weryfikacja przez context7/skille vercel, nie z pamięci.
- Deploy: tylko web (Vercel, z korzenia monorepo) + **migracja DDL na prod Postgres — human-gated
  w S5** (pierwsza migracja na żywej bazie). Worker bez zmian. Sprawdzenie RLS przy nowych UPDATE'ach
  (F-8) — polityki muszą pozwalać właścicielowi na UPDATE szkicu, niczego więcej.

## 7. Poza zakresem (jawnie)

- ogólna edycja szkicu (tylko potwierdź + zatwierdź),
- pełny workflow 7 kroków (ADR-012) — teraz jeden krok zatwierdzenia,
- niezmienność DB-level / audit_log / podpis (slice F-7),
- per-wiersz potwierdzanie próby,
- zmiany workera,
- telemetria „% pól as proposed".

## 8. Log decyzji brainstormu (2026-07-14, checkpoint a)

1. **„Zatwierdzenie"** = szkic zapisuje się zawsze + nowy krok „Zatwierdź operat" z bramą F-4
   (wybrano „oba: szkic + gate" zamiast bramy na istniejącym zapisie).
2. **Zasięg prowenancji** = wszystkie wartości wejściowe; ręczne dostają `rzeczoznawca`/`confirmed`
   automatycznie na ACL; tylko dane z RCN/geokodera wchodzą jako `to_verify`.
3. **UX potwierdzania** = strona detalu, bulk confirm („Potwierdź próbę z RCN"); potwierdzenie to
   jedyna mutacja treści szkicu; bez ogólnej edycji szkicu.
4. **Twardy próg ≥12** = tylko przy zatwierdzeniu (część inwariantu bramy); szkic od ≥3 + amber.
5. **Kształt snapshotu** = „dopisz obok" (status inline na wierszach + mapa `provenance` skalarów);
   bez przebudowy dokumentu; stare wiersze parsują się bez zmian.

## 9. Referencje

- ADR-y: `wiki/decisions/ADR-010-sourced-provenance-shared-kernel.md`,
  `wiki/decisions/ADR-012-gating-synchronous-process-manager.md` (wiki repo)
- Kernel: `packages/shared/src/sourced.ts`
- Pliki dotykane (web): `apps/web/src/lib/valuation-form-schema.ts`,
  `apps/web/src/app/valuations/new/new-valuation-form.tsx`,
  `apps/web/src/app/valuations/[id]/page.tsx`, `apps/web/src/app/actions/create-valuation.ts`,
  `apps/web/src/app/actions/get-sample-proposal.ts`, `apps/web/src/domain/` (nowy moduł bramy),
  `apps/web/src/ports/valuation.ts`, `apps/web/src/adapters/valuation-drizzle.ts`, migracja Drizzle
- Ledger: `.superpowers/sdd/progress.md` (konwencje Slice 0–2)
- Handoff: `docs/superpowers/HANDOFF-slice3-sourced-gating.md`
