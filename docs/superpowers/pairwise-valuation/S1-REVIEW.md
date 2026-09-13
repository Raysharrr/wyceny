# S1 — kontrola kontraktów i obliczeń

2026-09-13. PR: https://github.com/Raysharrr/wyceny/pull/41, baza `integration/pairwise-valuation`.

## Dowody

- Implementer: 13 plików testowych,266 PASS i1 istniejący skip F14; typy, lint zmienionych plików, depcruise oraz hooki PASS.
- Koordynator: niezależny przebieg `valuation-calculation`, `pairwise`, `feature-rules`, obu KCS golden oraz `kcs-rounding`:6 plików/97 PASS.
- Porównanie z `9b2903c`: kod od `FeatureShare`, stałe `ROUNDING` oraz cała funkcja `computeKcs` identyczne. Refaktor przenosi typy wejść i zachowuje re-eksporty.
- PP odtwarza740900 i339400 z arkuszy; importowe ceny zaokrąglone do2 miejsc zachowują te finały.399400 z drugiego PDF pozostaje rozpoznanym błędem źródła.
- Nowe funkcje nie są jeszcze podłączone do ekranu/zapisu. Weryfikacja UI całego bloku pozostaje S3–S5. Pomoc: bez zmian w S1.

## Znalezisko procesu

CI miało `pull_request.branches: [main]`, więc pierwszy head PR nie uruchomił testów GitHub. Konieczna poprawka S1 `cf257d1` dodaje `integration/**`; push do main, warunki migracji i wdrożeń pozostają bez zmian. Rzeczywiste CI uruchomiło się po poprawce. Zielony Vercel nie zastępuje CI ani E2E.

Pierwszy przebieg pełnego CI: lint/typecheck/test/build PASS, ale F-9 błędnie rozpoznało11 cyfr części ułamkowej ceny w raporcie spike jako identyfikator; E2E zostało pominięte. Koordynator ograniczył wyłącznie prezentację liczb raportu do8 miejsc. Obliczenia i asercje spike nadal używają pełnej precyzji i przechodzą740900/339400. Skaner bez zmian i bez wyjątków: lokalnie F-9 PASS. Wymagany ponowny pełny CI/E2E.

## Przegląd Opus/high

Pierwszy przegląd `c727cae..da595d1`: brak blokujących uwag. Pełny raport lokalnie `/tmp/pairwise-s1-review.txt`. Cztery uwagi P3 rozstrzygnięto następująco:

- Zmiana tożsamości po normalizacji źródła/uzupełnieniu id: instrukcja i test w HANDOFF S2; UI korzysta z utrwalonych identyfikatorów, nigdy pozycji.
- Różne odciski dla null/braku/pustych definicji: HANDOFF S2 wymaga normalizacji przed stemplowaniem i testu round-trip JSONB. S1 nie ukrywa zmian danych.
- Błędy PP pokazywane etapami po poprawieniu wyboru próby: bezpieczne zachowanie, nie wymaga zmiany kontraktu.
- Jawny KCS z pustą próbą rzucał zwykły Error: przekazano S1 poprawkę na typowany błąd nowych obliczeń, bez zmiany ścieżki historycznej ani progu12 w gotowości.

## Bramka

Poprawka i drugi przegląd oraz CI/E2E w toku. PR nie jest jeszcze dopuszczony do merge; S2 czeka na scalenie i zamrożenie kontraktów.
