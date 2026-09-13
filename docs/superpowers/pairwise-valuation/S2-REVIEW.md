# S2 — kontrola zapisu i metody

PR42, baza91a718d, pierwszy head `eba365e`. Stan: PASS po poprawkach; końcowy head `e0c3c1550a9996668c20360e80f470257e21712f`, squash PR42 do integracji `c7bb94a64a0f88122525cdc2e6fee3e86c16a924`.

## Dowody pierwszego head

- Implementer: web1781PASS/1 istniejący skip, lokalny E2E12PASS/2 opt-in skip. Rzeczywiste PDF i przepływy opisane w `S2-STATE.md` w PR42.
- Koordynator: niezależne4 pliki/22PASS (`pairwise-state`, `rtl-method-selection`, oba KCS golden), przegląd diff źródeł i testów. Dodatkowe próby negatywne poniżej wykazały luki mimo zielonych testów.
- CI i E2E na eba365e PASS, log `/tmp/pairwise-s2-ci-eba365e.log`. To wynik pierwszego head, nie przyszłych poprawek.

## Znaleziska do poprawy

1. **P2, default-deny approval:** `approvalGate` pomija `calculationIssues` przy brakującym area/features. Koordynator odtworzył: poprawny fixture→ok; usunięcie area→nadalok; nieznana metoda przy brakującym area→nadalok. `approveValuation` z takim snapshotem zwraca approved. Nowe zatwierdzenie musi odrzucać niepełne dane i nieznaną metodę. Wyjątek starego podpisu nie uprawnia do nowego zatwierdzenia. Stare skrótowe fixture prowenancji wymagają prawidłowych danych obliczeń.
2. **P2, źródło transakcji:** osłona stabilnego id nadpisuje wynik ACL starym źródłem rejestru. Implementer zgłosił, koordynator odtworzył: wejście po ACL ma rejestr_sm i coopTxId, a `applySampleUpdate` zapisuje rcn ze starego wiersza. Poprawka musi zachować źródło wynikające z identyfikatora SM oraz istniejącą ochronę przed usuwaniem identyfikatorów źródłowych.
3. **P2, ścieżka błędu PP:** Opus wskazał, że prowenancja numeruje wybrane wiersze od początku podzbioru, podczas gdy ścieżki danych/calculationIssues dotyczą pełnej puli. Błąd ma wskazywać rzeczywisty indeks puli, z jednoznaczną etykietą; potrzebny test niepierwszego/reorderowanego wyboru.

Pierwszy Opus/high zakończony (`/tmp/pairwise-s2-review.txt`). Mimo nagłówka PASS zalecił usunięcie gałęzi testowej jakoP1; koordynator uznał odtworzony bypass za wymagający naprawy. Trzy punkty przekazano w jednym pakiecie do S2, wraz z testami nieaktualnego jawnego wyboru i unieważnienia stempla po zmianie powierzchni. Drugi review, odpowiednie testy i kontrola zmienionego przepływu poprzedzą merge.

Hydratacja coopTxId/ratingScale i podgląd PP w cechach pozostają jawnie S3. Czyszczenie średniej oceny przy zmianie na skalę2 jest zgodne ze SPEC. Sugestia dodatkowego odczytu produkcji z raportu review nie zmienia lokalnego zakresu ani nie jest nową zgodą na wdrożenie.

## Refinement S3

`saveFeaturesAction` zachował wcześniejszy heurystyczny wybór prowenancji definicji na podstawie mediany powierzchni całej puli. PP w S3 wymaga zgodności z wybranymi porównaniami. S3 otrzyma jawne prawo do minimalnej korekty tej akcji; nie wolno pozostawić UI/ACL z różnym zbiorem odniesienia. Nie wpływa to na arytmetykę S1.

## Zamknięcie kontroli — 2026-09-13

Wszystkie trzy znaleziska naprawione. Drugi Opus/high PASS (`/tmp/pairwise-s2-review2.txt`); pierwotne negatywne próby koordynatora po poprawce PASS: brak powierzchni/nieznana metoda blokują również aggregate approval, a coopTxId zachowuje źródło SM. Dodatkowe testy chronią nieaktualny wybór i unieważnienie po zmianie powierzchni.

Końcowe [CI](https://github.com/Raysharrr/wyceny/actions/runs/34747912535): web156 plików/1793PASS/1 istniejący skip; shared4PASS; worker319PASS/1skip; browser12PASS/2 opt-in skip w27.8s. Lokalny końcowy smoke2PASS w17.4s. Logi `/tmp/pairwise-s2-ci-e0c3c15.log`, `/tmp/pairwise-s2-smoke-e0c3c15.log`. Pomoc i indeks zaktualizowane.

Koordynator niezależnie przeszedł rzeczywisty Chrome na finale0c3c15: web3017, worker8017, osobny PostgreSQL5545, syntetyczny Zenon. Nowa wycena własności699de582-0982-4f37-baa4-e33fe71e673a:12 transakcji9000–10100,50m². Brak potwierdzenia blokuje kalkulację; sam wybór bez przycisku nie przetrwa reloadu. Potwierdzony KCS przetrwa reload i daje477500. KCS→PP usuwa WR i blokuje dalsze kroki do wyboru3–5/ocen; PP→KCS przywraca477500 po obliczeniu. Odczyt zapisu potwierdził3 świadome zmiany metody i niezmienione12 cen. Dowody DOM/screenshot/persistedJSON: `/tmp/pairwise-s2-coordinator-browser/`. Ten celowany test CUA nie ma trace Playwright ani nowego PDF/approval.

Pełne lokalne KCS UI/PDF/approval obu praw wykonał implementer na własnym stacku i syntetycznej Anecie, z rzeczywistym LibreOffice oraz wizualną kontrolą Chrome: `/tmp/pairwise-s2-browser/`. CI obejmuje oba prawa; nie deklarujemy jeszcze pełnego PP, podpisu, żywych importów ani generowania AI. Kontrakty kolejnych sesji zamrożone w [S2-STATE](S2-STATE.md).
