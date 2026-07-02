# Design: Silnik KCS (pure) — wpięcie sprawdzonego spike'a

**Data:** 2026-07-02 · **Status:** zatwierdzony (brainstorm 2026-07-01/02) ·
**Roadmap:** wiki `wiki/roadmap.md` 🟢 NOW · **Poprzedza:** mini-slice dev-infra foundations
(`2026-07-02-dev-infra-foundations-design.md`)

## TLDR

Zastępujemy stub (`stubWr = Math.round(area)*10000`, `create-valuation.ts:42`) prawdziwym
silnikiem KCS (podejście porównawcze, korygowanie ceny średniej) jako **pure domain module**
w `apps/web/src/domain/kcs.ts`. Golden test F-1 asertuje **dokładnie 1 044 400 zł** dla
operatu referencyjnego Kościelna — osiągalne dzięki **konwencji zaokrągleń operatu**
(zweryfikowane empirycznie 2026-07-01). UI: sekcje Próba + Cechy w istniejącym formularzu
(styl makiety, bez steppera), rozbicie obliczeń na stronie szczegółów.

## Algorytm (ze spike'a `wiki: tools/spike/2026-05-14-kcs/spike.py:138-156`, 5/5 operatów, błąd ≤0,16%)

Wejścia: próba cen jednostkowych [zł/m²], powierzchnia [m²], cechy {nazwa → (waga, ocena)}.

1. `cmin, cmax, csr` = min / max / średnia arytmetyczna próby
2. `vmin = cmin/csr`, `vmax = cmax/csr`
3. Udział cechy: `lepsza → waga·vmax`, `gorsza → waga·vmin`, `przecietna → waga·1.0`; `sumUi = Σ Ui`
4. Cena jednostkowa: `unitValue = csr · sumUi`
5. `wr = unitValue · area`, zaokrąglone do pełnych 100 zł

### Konwencja zaokrągleń operatu (reguła domenowa — część spec silnika)

Operat (artefakt prawny) zaokrągla wartości pośrednie tak, jak je drukuje, i **liczy dalej na
zaokrąglonych**. Silnik odwzorowuje dokument, nie czystą arytmetykę:

| Wielkość | Zaokrąglenie |
|---|---|
| `csr` (cena średnia) | grosze (2 miejsca) |
| `vmin`, `vmax` | 3 miejsca |
| `sumUi` (ΣUi) | 3 miejsca |
| `unitValue` (zł/m²) | grosze (2 miejsca) |
| `wr` | pełne 100 zł |

Tryb: **half-up** (kupieckie; JS `Math.round` dla wartości dodatnich — nie Pythonowe
banker's rounding). Dowód empiryczny (2026-07-01, dane Kościelnej ze spike'a):

| Wariant | ΣUi | zł/m² | WR |
|---|---|---|---|
| pełna precyzja (spike) | 1,11050 | 14 573,80 | 1 043 900 (−0,05% od PDF) |
| **konwencja operatu** | **1,111** | **14 580,32** | **1 044 400 — exact match z PDF** |

> Pułapka: PDF drukuje Vmin 0,920, silnik da 0,919 (12 061,94 / 13 123,60 = 0,9191) — **F-1
> celowo nie asertuje vmin/vmax**; rozbieżność nie wpływa na WR (ΣUi po zaokrągleniu do 3 miejsc
> identyczne). Nie „naprawiać" silnika pod 0,920.

## Architektura

- **`apps/web/src/domain/kcs.ts`** — pure TS, zero I/O, zero importów adapterów (F-10 pilnuje
  depcruise). Typy:
  - `Comparable { date?: string; area?: number; pricePerM2: number }` — tylko `pricePerM2` zasila silnik; reszta = metadane do wyświetlania
  - `FeatureRating = 'gorsza' | 'przecietna' | 'lepsza'`
  - `Feature { name: string; weight: number; rating: FeatureRating }` (waga jako ułamek, Σ = 1.0;
    UI operuje w %, konwersja %→ułamek następuje w warstwie akcji przed wywołaniem silnika)
  - `KcsInput { comparables: Comparable[]; area: number; features: Feature[] }`
  - `KcsResult { csr, cmin, cmax, vmin, vmax, ui: {name, weight, rating, value}[], sumUi, unitValue, wrUnrounded, wr }` — pełne rozbicie ("zero czarnej skrzynki", jak krok 5 makiety)
- **Fixture** `apps/web/tests/fixtures/koscielna.json` — snapshot wejść wyekstrahowany ze
  spike'a (12 transakcji, 5 cech: standard 0.40 lepsza / piętro 0.30 lepsza / powierzchnia 0.10
  gorsza / dodatkowe 0.10 lepsza / lokalizacja 0.10 lepsza, pow. 71,63 m²) + oczekiwane wyniki
  pośrednie. Bez PII (daty, metraże, ceny — F-9 czyste).
- **DB (migracja Drizzle):** rename `stub_wr` → `wr`; nowa kolumna `inputs jsonb NULL`
  (snapshot `KcsInput` per wycena) — każdy nowy operat odtwarzalny bez sieci (F-3 na poziomie
  aplikacji). `NULL` = wyceny z ery stuba (istniejące wiersze na prodzie — bez backfillu,
  strona szczegółów pokazuje rozbicie tylko gdy `inputs` obecne); nowe zapisy zawsze ustawiają
  `inputs` (wymuszone w akcji, nie w DB).
- **Server Action** `createValuation`: rozszerzony payload (adres, pow, próba[], cechy[]) →
  zod → `computeKcs()` → zapis `wr` + `inputs` → worker `amountInWords(wr)` (bez zmian; worker
  nadal nie zwraca WR — F-11 nietknięte).

## Walidacja (zod, komunikaty PL)

- próba: **≥ 3 transakcje**, każda `pricePerM2 > 0` (min/max/średnia degenerują się poniżej 3)
- powierzchnia: `> 0`
- cechy: wagi liczbowe `≥ 0`, **Σ wag = 100% ±0,1 p.p.**, ocena wymagana dla każdej cechy

## UI (sekcje w istniejącym formularzu — styl makiety v3-r4, bez steppera/AI/RCN)

- Sekcja **Próba porównawcza**: dynamiczne wiersze (data, pow. m², **cena zł/m²**), dodaj/usuń
  wiersz; podgląd na żywo Cmin/Cmax/Cśr (jak "Statystyki próby" z makiety, krok 3).
- Sekcja **Cechy i wagi**: 6 domyślnych cech z wagami makiety — Standard wykończenia 40%,
  Położenie na piętrze 30%, Lokalizacja 10%, Powierzchnia użytkowa 10%, Pomieszczenia
  przynależne 4%, Dodatkowe 6%; waga edytowalna (input %), ocena jako segmented buttons
  `gorsza / przeciętna / lepsza`; ostrzeżenie gdy Σ ≠ 100%.
- **Strona szczegółów**: rozbicie obliczeń T2/T3/T4 jak w makiecie (krok 5 "Kalkulacja") —
  przeliczone server-side z zapisanych `inputs` tą samą pure-funkcją (RSC, bez `"use client"`).
- Narzędzia: react-hook-form + zod (już w repo), `useFieldArray` dla wierszy próby, komponenty
  shadcn już zainstalowane. Implementer weryfikuje API przez `context7`/skille vercel.

> Uwaga scope: **domyślne cechy UI (6, wagi makiety) ≠ fixture Kościelnej (5 cech)** — fixture
> odtwarza operat referencyjny w testach; defaulty UI odtwarzają makietę. Silnik jest agnostyczny
> (przyjmuje dowolny worek cech) — bogaty UX cech (worki per typ, dodawanie, AI-oceny) to osobny
> slice NEXT wg roadmapy.

## Testy (fitness functions tego slice'a)

- **F-1 golden** (`golden-wr.test.ts`, zastępuje harness-placeholder): `computeKcs(koscielna.json)`
  → `wr === 1_044_400` **oraz** wartości pośrednie: `csr === 13_123.60`, `sumUi === 1.111`,
  `unitValue === 14_580.32`. Ścieżka słownie: mock fetch jak dziś (kontrakt workera pokrywa
  worker-contract.test + pytest); pytest workera dostaje case dla `1044400` (oczekiwane ~"milion
  czterdzieści cztery tysiące czterysta złotych zero groszy" — dokładny string potwierdza
  `num2words` przy implementacji, wzorzec formatu jak istniejące case'y).
- **F-2 determinizm**: dwukrotne wywołanie na tym samym wejściu → wyniki identyczne (deep equal);
  silnik z konstrukcji bez `Date`/`Math.random`/I/O.
- **F-3 reprodukowalność**: test czyta fixture z dysku (bez sieci) i odtwarza pełny `KcsResult`;
  integracyjnie: wycena zapisana w DB → odczyt `inputs` → recompute → zgodność z zapisanym `wr`.
- Aktualizacja testów dotkniętych rename (`valuation-repo`, `rls-isolation`, strony) + smoke E2E
  playwright rozszerzony o wpis próby/cech (jeśli foundations weszły wcześniej).

## Non-goals (osobne slice'y wg roadmapy)

- auto-fetch RCN/geokoder/EGiB (slice "Dane przedmiotu + próba", F-5 ≥12 tx)
- prowenancja `Sourced<T>` + gating (F-4), AI-propozycje ocen, worki cech per typ (F-6)
- podejście PP, trend czasowy cen, wagi liczone z analizy rynku
- stepper/wizard 7 kroków z makiety

## Definition of Done

- F-1 zielony w CI z realną asercją `1 044 400`; F-2/F-3 zielone.
- Formularz UI woła realny silnik zamiast stuba; kolumna `stub_wr` nie istnieje.
- Wdrożone na produkcję (Vercel + migracja na Railway PG) i **zweryfikowane E2E na żywo**:
  ręczny wpis danych Kościelnej → 1 044 400 zł + kwota słownie.
- Wiki (S6): log, timeline, strona tech, roadmap NOW→DONE + promocja kolejnego NEXT.
