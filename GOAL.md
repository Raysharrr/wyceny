# GOAL — slice obserwowalności

Brief w formacie `/goal`. Źródło prawdy o rozwiązaniu:
`docs/superpowers/specs/2026-08-19-obserwowalnosc-design.md`.
Ten plik mówi **czego chcemy i jak poznamy, że jest zrobione** — nie powtarza projektu.

---

## Desire

Gdy rzeczoznawca mówi „coś nie poszło", chcę odtworzyć jego przebieg w dwie minuty.

Konkretnie, po tym slice'ie:

- Każde żądanie ma **ośmioznakowy kod**, który przechodzi przez web, workera i wywołania
  zewnętrzne, a przy błędzie pokazuje się użytkownikowi w komunikacie („kod: a3f1c2d9").
- `pnpm trace <kod|id-wyceny>` wypisuje oś czasu przebiegu: co użytkownik zrobił, co
  odpowiedział worker, gdzie i dlaczego pękło.
- Ślady istotne diagnostycznie **przeżywają tydzień i więcej** (Postgres), a nie znikają
  z retencją hostingu.
- Zamknięty zostaje otwarty punkt ADR-009 (trace-id korelujący logi web↔worker).
- Zebrane są dane, których nie da się odtworzyć wstecz (odciski propozycji AI) — pod
  metrykę „% pól as proposed", której ten slice **nie liczy**.

Czego NIE chcę w tym slice'ie: alertów, Sentry, drenów logów, dziennika w UI, samej metryki.

---

## Quality bar

Slice jest zrobiony, gdy **wszystkie** poniższe są prawdziwe:

| Kryterium                                            | Jak mierzone                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Żadne PII nie może trafić do logu                    | F-13: test odrzucania nieznanych kluczy + `no-console` w eslint + ruff `T201`        |
| Istniejące bramki nietknięte                         | F-1 (golden **1 044 400 zł**), F-4, F-9, F-10, F-11, F-12 zielone bez zmian          |
| Błąd zostaje zapisany mimo wycofania transakcji      | test integracyjny na rollbacku                                                       |
| traceId nie miesza się między równoległymi żądaniami | test przeżycia `await` przez ALS                                                     |
| Korelacja web↔worker działa **na żywym stagingu**    | te same 8 znaków w logach Vercela i Railway                                          |
| Dodanie nowego zdarzenia kosztuje jedną linię        | przegląd przy code review                                                            |
| Repo jest publiczne                                  | zero realnych adresów, numerów KW i danych osobowych w kodzie, testach i fixture'ach |

Poprzeczka na koniec: **prowokujemy realny błąd na stagingu, odczytujemy kod z UI
i odtwarzamy przebieg** — bez tego slice nie jest skończony.

---

## Tools + Discovery

**Narzędzia:** pnpm + turbo, drizzle-kit, uv + pytest + ruff, Playwright, lefthook,
dependency-cruiser. Wdrożenie: web automatycznie z `main` (Vercel), **worker `worker-v2`
ręcznie** (Railway, serwis bez podpiętego `source`). Dostęp do bazy stagingu przez psql.

**Rozpoznanie obowiązkowe PRZED implementacją — task zerowy to spike.** Dwa założenia
designu są niezweryfikowane i oba są nośne:

1. pino buduje się pod Turbopackiem i jego JSON widać w logach Vercela,
2. `AsyncLocalStorage` przeżywa łańcuch server action → adapter → `fetch`.

Spike sprawdza oba jednym wdrożeniem. **Kryterium PASS ustalone przed uruchomieniem**
(wszystkie trzy naraz): build bez ostrzeżeń bundlera; wpis w logach Vercela jako JSON;
te same osiem znaków traceId w linii logu workera.
**FAIL → wracasz do użytkownika po decyzję**, nie improwizujesz: `serverExternalPackages`
albo zejście na własny cienki logger o tym samym interfejsie.

**Rozpoznanie w kodzie (czytać, nie zgadywać):** 21 miejsc `console.error` w `apps/web/src`,
pięć adapterów w `apps/web/src/app/valuations/_deps.ts`, trzy miejsca pobierania propozycji
AI, `insertAudit` w `apps/web/src/adapters/valuation-drizzle.ts` jako wzorzec portu.

---

## Creative Freedom

**Wolna ręka:** kształt API wrappera, nazewnictwo zdarzeń, format wyjścia `pnpm trace`,
rozmieszczenie plików, sposób inicjalizacji ALS, konfiguracja procesorów structloga,
struktura testów, treść komunikatów.

**Nie do negocjacji** (zmiana wymaga zgody użytkownika, nie decyzji implementera):

- allowlista, nie denylista — `redact` z pino jest odrzucony świadomie;
- odciski `sha256`, nigdy wartości jawne, w odcisku propozycji AI;
- zapis zdarzenia **poza** transakcją mutacji;
- `audit_log` nietknięty — zamknięty enum, trigger, artefakt prawny;
- zero logowania w `domain/` — F-10 pilnuje;
- pino (web) + structlog (worker) — wybór użytkownika;
- osiem znaków traceId, czytelne na głos;
- migracja `0012`, addytywna, bez triggera append-only na `event_log`.

---

## Verification Loop

Cykl per task, wg `build-slice`:

1. **RED** — test opisujący zachowanie, uruchomiony i widziany jako czerwony.
2. **GREEN** — najmniejsza implementacja, która go zapala.
3. `pnpm turbo lint typecheck test build` + `pnpm depcruise`; worker: `uv run ruff check .`
   oraz `uv run pytest -q`.
4. **Niezależny reviewer** na Opus 5 po każdym tasku; fala poprawek przed następnym.
5. Commit + push per task.

Pętla całościowa: spike na żywym stagingu **przed** resztą → po ostatnim tasku pełne E2E
na stagingu (wycena → sprowokowany błąd → kod z UI → `pnpm trace` → potwierdzony przebieg).

**Punkt kontrolny w DoD:** po pierwszych realnych zgłoszeniach sprawdzamy, czy zebrane
zdarzenia wystarczają do diagnozy. Jeśli nie — dokładamy, i to jest oczekiwany bieg rzeczy,
nie porażka projektu.

---

## Delivery

- **Kod:** gałąź `feat/obserwowalnosc` (worktree `~/Development/wyceny-app-obserwowalnosc`),
  PR do `Raysharrr/wyceny`.
- **Migracja `0012`** zastosowana zgodnie z rozstrzygnięciem kolejności wobec gałęzi
  `chore/migracje-automatyczne`. **BLOKER WEJŚCIOWY — decyzja użytkownika jeszcze nie
  zapadła**; warianty i rekomendacja (b) w specu, sekcja „Zależność".
- **Wiki** (`~/Development/wyceny`, main chroniony → przez PR): strona `topics/tech/`
  opisująca slice, wpis w `roadmap.md`, wpis w `timeline.md` i `log.md`, **odhaczony
  checkbox w ADR-009**.
- **Spec** aktualizowany, jeśli rzeczywistość rozejdzie się z projektem — zwłaszcza gdy
  spike wypadnie FAIL.
- Wynik spike'a raportowany wg konwencji `tools/spike/` w wiki-repo.

**Definicja skończenia:** wszystkie kryteria z „Quality bar" spełnione i zweryfikowane
empirycznie na stagingu, CI zielone, wiki zaktualizowana.
