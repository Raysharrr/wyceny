# E2E (Playwright)

Trzy zestawy w CI plus dwa uruchamiane ręcznie — projekty w `playwright.config.ts`:

| Projekt                  | Plik                                                                                                                                                                                            | Konto                                                                            | Kiedy                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| `smoke`                  | `smoke.spec.ts`                                                                                                                                                                                 | aneta (admin, loguje się sam)                                                    | CI, każdy push          |
| `setup` → `spoldzielcze` | `auth.setup.ts` → `spoldzielcze.spec.ts`                                                                                                                                                        | zenon (rzeczoznawca, jedno logowanie per przebieg, `storageState` w `.e2e-tmp/`) | CI, każdy push          |
| `setup` → `gluszyna`     | `auth.setup.ts` → `gluszyna.spec.ts` (blok „Głuszyna”: treść KW, lokale o cenie skrajnej, odłączone progi)                                                                                      | zenon, ta sama sesja co wyżej                                                    | CI, każdy push          |
| `staging`                | `spoldzielcze.spec.ts`, tylko testy `@staging-safe` (import, formularz ręczny, dym własnościowy CL-16 — **bez** wyceny spółdzielczej, bo na stagingu proza jest ON i krok 6 kosztuje generację) | zenon na stagingu                                                                | **ręcznie**, nigdy w CI |

## Macierz pokrycia — blok „Głuszyna” (CHECKLISTA.md z 21.09)

Checklista: `docs/superpowers/review/2026-09-21-gluszyna/CHECKLISTA.md` w wiki-repo; numeracja `CL-n` to jej punkty 1–14.

| CL    | Czego dotyczy                                             | Bramka w CI                                                                                                                              |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CL-1  | krok 6 generuje komplet opisów                            | — proza jest OFF w CI (`NEXT_PUBLIC_PROSE=off`); pokrywa worker i testy akcji                                                            |
| CL-2  | komunikat o błędzie **konfiguracji** prozy                | — nieosiągalne: `proposeProse` woła workera z serwera, `page.route` tego nie widzi; pokrywa `test_prose_config_error_detail`             |
| CL-3  | karta „Lokale o cenie skrajnej”, przycisk nieaktywny      | `gluszyna.spec.ts` — „CL-3, CL-4, CL-5…”                                                                                                 |
| CL-4  | „Przyjmij” bierze podpowiedź z rejestru                   | `gluszyna.spec.ts` — „CL-3, CL-4, CL-5…”                                                                                                 |
| CL-5  | krok 7 bez B-18, §12.2 z ocenami, 0× „brak danych…”       | `gluszyna.spec.ts` — „CL-3, CL-4, CL-5…” (tekst PDF-a podglądu)                                                                          |
| CL-6  | mapowanie kolumny „P.P” w imporcie rejestru               | — fikstura `coop-registry.ts` nie ma kolumny P.P; pokrywa `coop-import.test.ts`                                                          |
| CL-7  | zmiana próby unieważnia oceny lokali skrajnych            | `gluszyna.spec.ts` — „CL-7 (negatywny)…”                                                                                                 |
| CL-8  | dwa sposoby na obu kartach, brak „Wpisz ręcznie”          | — pokrywa `rtl-kw-section.test.tsx`; w E2E widoczne pośrednio (CL-9, CL-12)                                                              |
| CL-9  | licznik działów, baner brakujących zakładek, przepisanie  | `gluszyna.spec.ts` — „CL-9…”                                                                                                             |
| CL-10 | werdykt walidacji trwały po powrocie do kroku 1           | `gluszyna.spec.ts` — „CL-10…”                                                                                                            |
| CL-11 | rodzaj księgi niezgodny z kartą                           | `gluszyna.spec.ts` — „CL-11 (negatywny)…” (grunt na karcie lokalu) · `smoke.spec.ts` — „karta gruntu ostrzega…” (lokal na karcie gruntu) |
| CL-12 | panel zmiany sposobu: „Zostaw jak jest” / „…usuń dane”    | `gluszyna.spec.ts` — „CL-12…”                                                                                                            |
| CL-13 | zatwierdzenie i DOCX w Wordzie (§8.2 obie tabele działów) | — brama wymaga prowenancji geokodowania z żywego autofetch (patrz `E2E_APPROVE`); kontrola układu w Wordzie zostaje przy rzeczoznawcy    |
| CL-14 | treść Pomocy                                              | — pokrywają testy treści Pomocy (`tests/`)                                                                                               |

Poza numeracją CL: punkt 3 sekcji „Co możesz STRACIĆ” (ręczna edycja tekstu poziomu odłącza progi) → `gluszyna.spec.ts`, test „Co możesz STRACIĆ” pkt 3.

## Lokalnie (jak CI)

Wymagania: Postgres z migracjami i seedem, worker z **`GEOCODER_STUB=1`** (deterministyczny punkt z hasha adresu — zero sieci), `pdftotext` (poppler) w PATH, `WORKER_SHARED_SECRET` ten sam po obu stronach.

```bash
# worker (osobny terminal)
cd apps/worker && WORKER_SHARED_SECRET=dev GEOCODER_STUB=1 uv run uvicorn app.main:app --port 8000
# web: build z flagami jak w CI, potem Playwright sam robi `pnpm start`
cd apps/web
export NEXT_PUBLIC_SUBJECT_AUTOFETCH=off NEXT_PUBLIC_ADDRESS_SUGGEST=off NEXT_PUBLIC_STREET_VIEW=off \
       NEXT_PUBLIC_PHOTO_UPLOAD=off NEXT_PUBLIC_PROSE=off MAPS_FETCH=off \
       WORKER_SHARED_SECRET=dev SEED_ADMIN_PASSWORD=… SEED_APPRAISER_PASSWORD=…
pnpm build && pnpm e2e                    # smoke + spoldzielcze + gluszyna
pnpm exec playwright test --project=gluszyna                     # tylko blok Głuszyna
pnpm exec playwright test --project=gluszyna --repeat-each=3     # stabilność
pnpm exec playwright test --project=zrzuty                       # zrzuty karty KW do opisu PR
```

Projekt `zrzuty` (ADR-021) nie wchodzi do `pnpm e2e`: robi zrzuty stanów karty
„Księga lokalu" do `e2e-zrzuty/`, z atrapą `/kw-transcribe` w przeglądarce
(`page.route`) — bez osobnego serwera i bez zmiennych środowiskowych.

Inny port niż 3000: `E2E_PORT=3006` (i `BETTER_AUTH_URL` na ten sam port).

## Staging (ręcznie)

```bash
cd apps/web
E2E_BASE_URL=https://wyceny-mu.vercel.app SEED_APPRAISER_PASSWORD='<hasło zenona ze stagingu>' pnpm e2e:staging
# + żywy RCN na ścieżce własnościowej:
E2E_LIVE_RCN=1 E2E_BASE_URL=… SEED_APPRAISER_PASSWORD=… pnpm e2e:staging
```

Zasady na stagingu: **nic nie zatwierdza ani nie podpisuje**, dane wyłącznie syntetyczne — każdy przebieg zakłada własną spółdzielnię `SM QA E2E <runId>` (klucz deduplikacji jest treściowy, więc ceny i numery mieszkań zależą od `runId`), zamawiający `QA E2E <runId>`.

**Sprzątanie (obowiązkowe po każdym `e2e:staging`, robi administrator z `DATABASE_PUBLIC_URL` stagingu):** jeden przebieg dokłada ~130 wierszy i ~6 spółdzielni do rejestru, z którego biuro realnie dobiera próby.

```bash
DATABASE_URL='<DATABASE_PUBLIC_URL stagingu>' pnpm e2e:cleanup   # usuwa SM „QA E2E …” (wiersze, partie, mapowania); szkice „QA E2E …” zostają
```

## Flagi

| Zmienna                    | Znaczenie                                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`             | cel zamiast lokalnego `pnpm start` (Playwright nie startuje serwera)                                                                                                                                                                                      |
| `E2E_PORT`                 | port lokalnego serwera (domyślnie 3000)                                                                                                                                                                                                                   |
| `E2E_LIVE_RCN=1`           | włącza test pobrania próby z żywego GUGiK (ścieżka własnościowa); bez flagi test jest pomijany                                                                                                                                                            |
| `E2E_APPROVE=1`            | włącza test zatwierdzenia operatu (CL-13): wymaga buildu z `NEXT_PUBLIC_SUBJECT_AUTOFETCH=on` (bramka potrzebuje prowenancji geokodowania z kroku 1, czyli żywego GEOPOZ/UUG); bez flagi cała grupa jest pomijana razem z jej importem; nigdy na stagingu |
| `GEOCODER_STUB=1` (worker) | geokoder offline — w CI zawsze; na stagingu nigdy                                                                                                                                                                                                         |
| `SEED_APPRAISER_PASSWORD`  | hasło zenona (seed lokalnie / staging)                                                                                                                                                                                                                    |

## Jak dodać test

1. Zacznij od punktu checklisty (`docs/superpowers/qa-*/CHECKLISTA.md` w wiki-repo) — nazwa testu deklaruje `CL-n`, które zamyka.
2. Testuj **skutek dla użytkownika**; logikę pinują testy jednostkowe (`tests/`). Nie dubluj.
3. Selektory user-facing (`getByRole`, `getByLabel`, `getByText`); `data-testid` tylko tam, gdzie nie ma roli — wtedy dodaj testid w komponencie.
4. Asercje web-first (`expect(locator)…`), zero `waitForTimeout`. Timeouty jawne tylko przy ciężkich akcjach (import, render PDF).
5. Własne dane per test (`buildRegistryRun()`), żadnego stanu współdzielonego między testami; `fullyParallel` musi zostać bezpieczne.
6. Page objecty w `pages/` są cienkie: lokatory i sekwencje klików, bez asercji o wyniku.
7. Tag `@staging-safe` tylko dla testu, który na stagingu nic nie zatwierdza i nie wgrywa dużych plików.
