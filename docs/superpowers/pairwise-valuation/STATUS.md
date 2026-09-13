# Stan bloku T-06–T-09

> D-ARCH i D-AUTO zatwierdzone przez użytkownika 2026-09-13. [Zapis decyzji i warunki realizacji](ACCEPTANCE.md). Bramka fazy4 jest zamknięta.

2026-09-13 · koordynator: zadanie `01a09928-7929-7b71-ac87-01929eedf3b0`.

## Zakres i stan

Użytkownik zlecił pełny blok cech lokali i PP, samodzielne sesje Codex, jedną integrację, bieżącą regresję KCS oraz brak częściowych zmian na stagingu. Kierunek funkcjonalny HTML zaakceptowany z zachowaniem istniejącej aplikacji. Przegląd Opus/high zakończony;9 uwag rozstrzygniętych w [PLAN-REVIEW](PLAN-REVIEW.md) i wprowadzonych do dokumentów. D-ARCH i D-AUTO w [ARCHITECTURE](ARCHITECTURE.md) zostały zatwierdzone; trwa realizacja według zależności.

- [x] 0 Wskazanie i narzędzia — git/GitHub, CodeGraph, Codex task API, przeglądarka, lokalny worker/DB, Claude Opus CLI dostępne.
- [x] 1 Kontekst — źródła, wcześniejszy przegląd aplikacji i pokaz makiety; rozbieżności opisane poniżej.
- [x] 2 Logika i dane — dwa wzorce liczbowo odtworzone; model odpowiedzialności i źródeł.
- [x] 3 Spike arytmetyki i kolumn DOCX — PASS, wyniki w tools/spike/2026-09-13-pairwise-reference. Osobny spike kolumn3/4/5: PASS, istniejący PizZip/Docxtemplater + selektywna zmiana oznaczonych tabel OOXML, PDF lokalnie skonwertowane i obejrzane; [raport](../../../tools/spike/2026-09-13-pairwise-columns/RAPORT.md). Reguła sugestii pozostaje decyzją, nie techniczną niewiadomą do ukrycia w kodzie.
- [x] 4 Architektura — audyt i refaktor zatwierdzone; D-ARCH/D-AUTO zaakceptowane.
- [x] 5 Spec/plan/HANDOFF — zaakceptowane do realizacji; sygnatury S1 zostaną zamrożone przed S2.
- [ ] 6 Sesje — S1→S2→[S3||S4]→S5; nie wystartowały przed zatwierdzeniem kontraktu.
- [ ] 7 Weryfikacja — komplet lokalnie/integration i finalny PR; końcowa zgoda przed stagingiem.
- [ ] 8 Domknięcie — filing zgodny z rzeczywistym wynikiem; brak deklaracji wdrożenia.

## Tabela założeń i źródeł

Źródła wiki odnoszą się do repo `/Users/michalczekala/Development/wyceny`.

| Założenie                                  | Status                                     | Dowód / ograniczenie                                                                                            |
| ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Jawny wybór/potwierdzenie metody           | POTWIERDZONE                               | lista-zadan31.08 T06: „rzeczozawca powinien zatwierdzić w ogóle wybraną metodologię”                            |
| Człowiek wybiera3–5, program sugeruje      | POTWIERDZONE                               | T07 „wybór zostaje po stronie rzeczoznawcy, program tylko podpowiada najbardziej podobne”                       |
| Maksymalna automatyzacja                   | POTWIERDZONE jako intencja                 | alokacja06.09 §7 (nie §5): T07 „Tak, niech jak najwięcej liczy sam”                                             |
| Uniwersalny mnożnik z samych etykiet       | BRAK W ŹRÓDŁACH                            | oddzielne komórki ocen i mnożników, odpowiedź „Ta różnica wynika z tej konkretnej transakcji”; D-AUTO potrzebne |
| Cztery tabele PP                           | POTWIERDZONE                               | oba DOCX/PDF i T07; szczegóły SOURCES/DOCUMENT-AUDIT                                                            |
| Wzorzec PP A740900                         | POTWIERDZONE                               | arkusz/PDF i niezależna reprodukcja                                                                             |
| Wzorzec PP B399400 z PDF                   | SPRZECZNE                                  | formuły dają339400; PDF błędny, nie używać jego finału jako expected                                            |
| Jedna cecha własna, stałe nazwy katalogu   | POTWIERDZONE jako zakres użytkownika/planu | T08 i zachowany ORIGINAL-FEATURE-PLAN; ograniczenie do jednej cechy z wcześniejszego uzgodnienia                |
| Skala2 bez zmiany rachunku KCS             | POTWIERDZONE                               | alokacja06.09 §7 T09 „sposób wyliczenia bez zmian, zmienia się wygląd w operacie”                               |
| Domy/działki poza blokiem                  | POTWIERDZONE                               | obecne polecenie; sumy130%/120% nie blokują lokali                                                              |
| Obecna aplikacja gotowa na PP              | SPRZECZNE                                  | computeKcs w niezależnych ścieżkach, brak modelu ocen porównań                                                  |
| Jednolite progi obecnie                    | SPRZECZNE                                  | calculate3 kontra approval12, potwierdzone kodem i wcześniej w UI                                               |
| Stary podpis identyczny po nowym szablonie | NIEZAGWARANTOWANE                          | sign ponownie renderuje aktualnym kodem; wymagana ścieżka legacy                                                |
| Design jest zgodą na redesign              | SPRZECZNE                                  | wyraźne zastrzeżenie użytkownika: obecne komponenty, Opisy, PDF i numeracja                                     |

## Środowisko i dowody bazowe

- Aktualny origin/main po fetch: `9b2903cfbec6129f8d0017068ee37ac696d30adc`.
- Koordynator: `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-valuation`, `integration/pairwise-valuation`.
- Istniejące worktree cech i makiety zachowane bez zmian. Plan cech skopiowany jako materiał historyczny, nie przeniesiony/usunięty.
- Zależności z lockfile; zbudowany shared package. Osobny Postgres16 `wyceny-pairwise-test`,127.0.0.1:5544, baza `pairwise_valuation_test`. Lokalne testowe env jest gitignored. Każda równoległa sesja DB potrzebuje własnego klastra, bo migracja tworzy rolę app_role na poziomie klastra.
- Baseline:9 plików/189 testów PASS (golden KCS dla obu praw, f4, wizard-domain, schema, provenance, prose facts/staleness, template integrity). Następnie f7-immutability22/22 PASS na osobnym klastrze. Razem211. Pierwsze uruchomienia ujawniły brak builda shared/DB i konflikt roli na wspólnym klastrze; naprawiono konfigurację bez zmian kodu. Logi lokalne `/tmp/pairwise-baseline.log` (9PASS + niegotowy jeszcze DB) i `/tmp/pairwise-baseline-immutability.log` (22PASS po gotowości).
- Jest to celowany baseline, nie pełny CI/build/E2E przyszłego bloku.
- PP spike uruchomiony, PASS740900/339400, sanitizowane wyniki w repo. Błędy źródeł i zakres reprodukcji opisane w SOURCES.

## Kolejne zadania po zatwierdzeniu

| Zadanie               | Zależność                 | Gałąź                      |
| --------------------- | ------------------------- | -------------------------- |
| pairwise-s1-contracts | D-ARCH/D-AUTO             | feature/pairwise-contracts |
| pairwise-s2-state     | S1 merge                  | feature/pairwise-state     |
| pairwise-s3-wizard    | S2 merge                  | feature/pairwise-wizard    |
| pairwise-s4-operat    | S2 merge, równolegle z S3 | feature/pairwise-operat    |
| pairwise-s5-e2e       | S3 i S4 merge             | feature/pairwise-e2e       |

Wszystkie PR do integration/pairwise-valuation. Koordynator sam tworzy zadania i worktree oraz przeprowadza review/fixes/merge. Zarejestrowany projekt Codex „Wyceny” wskazuje wiki; każde zadanie musi jawnie pracować w app-worktree, bez mylenia tego z checkoutem wiki. Brak osobno zarejestrowanego projektu aplikacji nie wymaga ręcznego otwierania sesji przez użytkownika.

## Realizacja rozpoczęta

D-ARCH/D-AUTO zatwierdzone; zapis ACCEPTANCE.md. S1 uruchomiony jako zadanie Codex `pairwise-s1-contracts` (`01a0999c-1aff-7e01-9557-42fc6f8b8b00`) w `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-contracts`, branch `feature/pairwise-contracts`. Baseline S1 golden/F6:17/17PASS; nowe testy RED przed implementacją. Pozostałe zadania czekają na zależności, nie na ponowne pozwolenie.

Koordynator uchwycił bazowy render obu praw z ułamkowymi wagami i testową prozą przed zmianą kodu: `tools/spike/2026-09-13-legacy-render/`, commit0cddfbd. Wejścia+hash tekstu w repo; pełny tekst i DOCX lokalnie w `/tmp/pairwise-legacy-render/`. S4 ma użyć tego odniesienia do podpisu across-version.

Środowisko integracji: web localhost:3015, worker127.0.0.1:8015, własny Postgres5544. Oba procesy z worktree integracji, testowe konta bez prawdziwych wycen. Login Zenon potwierdzony w przeglądarce. Dane `.env` lokalne i poza gitem. Opisy włączone do testów ścieżki ręcznej; klucz LLM nie jest przekazany do izolowanego workera, by weryfikacja nie wykonywała płatnych generacji. To gotowość środowiska, nie test wdrożonego PP.
