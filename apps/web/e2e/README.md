# E2E (Playwright)

Dwa zestawy, trzy projekty w `playwright.config.ts`:

| Projekt                  | Plik                                                | Konto                                                                            | Kiedy                   |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| `smoke`                  | `smoke.spec.ts`                                     | aneta (admin, loguje się sam)                                                    | CI, każdy push          |
| `setup` → `spoldzielcze` | `auth.setup.ts` → `spoldzielcze.spec.ts`            | zenon (rzeczoznawca, jedno logowanie per przebieg, `storageState` w `.e2e-tmp/`) | CI, każdy push          |
| `staging`                | `spoldzielcze.spec.ts`, tylko testy `@staging-safe` | zenon na stagingu                                                                | **ręcznie**, nigdy w CI |

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

## Staging (ręcznie)

```bash
cd apps/web
E2E_BASE_URL=https://wyceny-mu.vercel.app SEED_APPRAISER_PASSWORD='<hasło zenona ze stagingu>' pnpm e2e:staging
# + żywy RCN na ścieżce własnościowej:
E2E_LIVE_RCN=1 E2E_BASE_URL=… SEED_APPRAISER_PASSWORD=… pnpm e2e:staging
```

Zasady na stagingu: **nic nie zatwierdza ani nie podpisuje** (podgląd operatu tylko), dane wyłącznie syntetyczne — każdy przebieg zakłada własną spółdzielnię `SM QA E2E <runId>` (klucz deduplikacji jest treściowy, więc ceny i numery mieszkań zależą od `runId`), zamawiający `QA E2E <runId>`. Szkice zostają w bazie stagingu; usuwa je administrator.

## Flagi

| Zmienna                    | Znaczenie                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`             | cel zamiast lokalnego `pnpm start` (Playwright nie startuje serwera)                           |
| `E2E_PORT`                 | port lokalnego serwera (domyślnie 3000)                                                        |
| `E2E_LIVE_RCN=1`           | włącza test pobrania próby z żywego GUGiK (ścieżka własnościowa); bez flagi test jest pomijany |
| `GEOCODER_STUB=1` (worker) | geokoder offline — w CI zawsze; na stagingu nigdy                                              |
| `SEED_APPRAISER_PASSWORD`  | hasło zenona (seed lokalnie / staging)                                                         |

## Jak dodać test

1. Zacznij od punktu checklisty (`docs/superpowers/qa-*/CHECKLISTA.md` w wiki-repo) — nazwa testu deklaruje `CL-n`, które zamyka.
2. Testuj **skutek dla użytkownika**; logikę pinują testy jednostkowe (`tests/`). Nie dubluj.
3. Selektory user-facing (`getByRole`, `getByLabel`, `getByText`); `data-testid` tylko tam, gdzie nie ma roli — wtedy dodaj testid w komponencie.
4. Asercje web-first (`expect(locator)…`), zero `waitForTimeout`. Timeouty jawne tylko przy ciężkich akcjach (import, render PDF).
5. Własne dane per test (`buildRegistryRun()`), żadnego stanu współdzielonego między testami; `fullyParallel` musi zostać bezpieczne.
6. Page objecty w `pages/` są cienkie: lokatory i sekwencje klików, bez asercji o wyniku.
7. Tag `@staging-safe` tylko dla testu, który na stagingu nic nie zatwierdza i nie wgrywa dużych plików.
