# E2E (Playwright)

Zestawy w `playwright.config.ts` mają oddzielną ścieżkę wydania z aktywnymi Opisami:

| Projekt                  | Plik                                                                                                                                                                                            | Konto                                                                            | Kiedy                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| `smoke`                  | `smoke.spec.ts`                                                                                                                                                                                 | aneta (admin, loguje się sam)                                                    | CI, każdy push          |
| `setup` → `spoldzielcze` | `auth.setup.ts` → `spoldzielcze.spec.ts`                                                                                                                                                        | zenon (rzeczoznawca, jedno logowanie per przebieg, `storageState` w `.e2e-tmp/`) | CI, każdy push          |
| `staging`                | `spoldzielcze.spec.ts`, tylko testy `@staging-safe` (import, formularz ręczny, dym własnościowy CL-16 — **bez** wyceny spółdzielczej, bo na stagingu proza jest ON i krok 6 kosztuje generację) | zenon na stagingu                                                                | **ręcznie**, nigdy w CI |

## Lokalnie (jak CI)

Wymagania: Postgres z migracjami i seedem, worker z **`GEOCODER_STUB=1`** (deterministyczny punkt z hasha adresu — zero sieci), `pdftotext` (poppler) w PATH, `WORKER_SHARED_SECRET` ten sam po obu stronach.

```bash
# worker (osobny terminal)
cd apps/worker && WORKER_SHARED_SECRET=dev GEOCODER_STUB=1 uv run uvicorn app.main:app --port 8000
# web: build z flagami jak w CI, potem Playwright sam robi `pnpm start`
cd apps/web
export NEXT_PUBLIC_SUBJECT_AUTOFETCH=off NEXT_PUBLIC_ADDRESS_SUGGEST=off NEXT_PUBLIC_STREET_VIEW=off \
       NEXT_PUBLIC_KW_UPLOAD=off NEXT_PUBLIC_PHOTO_UPLOAD=off NEXT_PUBLIC_PROSE=off MAPS_FETCH=off \
       WORKER_SHARED_SECRET=dev SEED_ADMIN_PASSWORD=… SEED_APPRAISER_PASSWORD=…
pnpm build && pnpm e2e                    # smoke + spoldzielcze
pnpm exec playwright test --project=spoldzielcze                 # tylko blok
pnpm exec playwright test --project=spoldzielcze --repeat-each=3 # stabilność
```

Inny port niż 3000: `E2E_PORT=3006` (i `BETTER_AUTH_URL` na ten sam port).

## T06–T09: aktywne Opisy, PP i podpis (wyłącznie lokalnie / CI)

`pairwise-valuation.spec.ts` ma siedem niezależnych testów (osiem z logowaniem): cztery pełne ścieżki KCS/PP × własność/spółdzielcze, dwa przepływy negatywne i PP4 z Pomocą. Konto: syntetyczny `zenon@wyceny.test`; każda wycena ma własny losowy sufiks. Profil dostaje tę samą syntetyczną falę `tests/fixtures/signature-synthetic.png`. Test nie używa podpisu człowieka. Odczyty SQL dotyczą wyłącznie utworzonych identyfikatorów i potwierdzają zapis, nie zastępują czynności w UI.

**Wymagany drugi build z `NEXT_PUBLIC_PROSE=on`.** `pnpm e2e` zachowuje dotychczasowe smoke/spoldzielcze z Opisami OFF. CI uruchamia je najpierw, następnie buduje aktywne edytory i wykonuje `pnpm e2e:pairwise`. Worker nie ma klucza LLM: test czeka na konkretną odmowę pierwszej generacji i brak naliczonego użycia, a następnie wpisuje i potwierdza sześć ręcznych tekstów. Samo oczekiwanie na błąd nie zapobiega płatnemu wywołaniu źle skonfigurowanego workera — brak klucza jest obowiązkowym warunkiem uruchomienia. Konwersja DOCX→PDF i kwota słownie pochodzą z prawdziwego workera; brak przechwytywania odpowiedzi lub testowego trybu produkcji.

```bash
# Zachowaj izolowane DATABASE_URL, BETTER_AUTH_URL i WORKER_URL oraz sekrety
# z lokalnego środowiska. Worker bez ANTHROPIC_API_KEY / OPENAI_API_KEY,
# GEOCODER_STUB=1, STREET_INDEX=off. Nie używaj współdzielonej bazy.
export NEXT_PUBLIC_PROSE=on E2E_PAIRWISE=1
pnpm build
pnpm e2e:pairwise --workers=2
pnpm e2e:pairwise --workers=2 --repeat-each=3
```

Pozostałe flagi offline z powyższego przykładu pozostają OFF. Harness odrzuca nielokalne adresy aplikacji, bazy i workera, brak `E2E_PAIRWISE=1` oraz jawnie wyłączoną prozę. Nie kieruj go na staging. `E2E_BASE_URL` może wskazać już uruchomiony **własny lokalny** serwer; jego build i środowisko muszą odpowiadać temu zestawowi.

| Test / AC                                  | Obserwowany rezultat                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cztery pełne ścieżki — AC01/03/04/08/09/11 | Zapis/reload własnej cechy, skale mieszane i wagi40,25/59,75; sześć ręcznych sekcji w PDF; approve→sign z tym samym tekstem; syntetyczny obraz w DOCX; SHA ponownie pobranego podpisanego PDF bez zmian; oryginalny zatwierdzony PDF pozostaje bajtowo identyczny w magazynie; brak przycisków edycji/podpisu. |
| Metoda/próba — AC01/02/05                  | Wybór bez potwierdzenia nie przetrwa reloadu; KCS11 blokuje/12 daje477500; zmiana metody zeruje WR; PP2 zapisuje tylko pulę, PP3/5 są jawne, szóste porównanie zablokowane; reorder zachowuje oceny przy tożsamościach; PP→KCS zachowuje pełne ceny/pulę.                                                      |
| Cechy/poprawki — AC03/04/06/09             | Kolizja nazwy, błędne wagi, brak oceny, usunięcie średniej oceny po3→2, uzasadnienie−1,25, brak potwierdzenia Enterem w polu, jawne potwierdzenie klawiaturą, konflikt starszej karty, zmiana poprawki przy niezmienionym WR i zachowanie sześciu tekstów.                                                     |
| PP4/Pomoc — AC08/12                        | Rzeczywisty PDF z czterema kolumnami i457500; pełne ścieżki mają także PP3/455000 i PP5/460000. Pomoc kontekstowa kroku3/4 opisuje te same ograniczenia i kontrolki.                                                                                                                                           |

AC07 (arkuszowe wzorce, ΔC0, precyzja), źródła RCN/SM, owner/row-lock, bramki serwera i AC10 legacy mają celniejsze istniejące testy domeny/akcji/repo/rendererów. Nie są powielane jako kolejne warianty UI. Pełne przypisanie testów i rzeczywiste pomiary: `docs/superpowers/pairwise-valuation/QA-CHECKLIST.md` i `S5-E2E.md`.

Projekt `pairwise` zapisuje trace każdego testu; PDF/DOCX/zrzuty i metadane są w `test-results/` (albo w katalogu `--output`). Zawierają branding istniejącego szablonu i pozostają poza gitem. `staging` nadal wybiera wyłącznie `@staging-safe` ze starego pliku i nigdy tego zestawu.

### Rzeczywisty worker Linux

Układ PDF zależy również od dostępnych fontów. Przy zmianie szablonu sprawdź prawdziwy Linux, zgodny z Dockerfile workera; sam lokalny LibreOffice na macOS nie wystarcza. Obraz workera nie wymaga klucza LLM. Przykład z katalogu głównego repozytorium (port musi być wolny, a sekret taki sam jak w web):

```bash
docker build -t wyceny-e2e-worker apps/worker
docker run --name wyceny-e2e-worker --rm -p 127.0.0.1:8023:8000 \
  -e WORKER_SHARED_SECRET -e GEOCODER_STUB=1 -e STREET_INDEX=off wyceny-e2e-worker
# W osobnym terminalu uruchom web/testy z WORKER_URL=http://127.0.0.1:8023.
# Nie przekazuj kluczy LLM ani macOS-owej ścieżki SOFFICE do kontenera.
```

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
