# Odbiór lokalny T06–T09

Stan: plan testów przed integracją S3/S4; poniższe pola nie oznaczają PASS. S5 przypisze do każdego punktu rzeczywisty test/commit/środowisko/dowód. Koordynator przejdzie całość na swoim lokalnym web+worker+DB z integracji. Staging dopiero po osobnej końcowej decyzji użytkownika.

| ID   | Działanie rzeczoznawcy                                                                             | Oczekiwany rezultat                                                                                                             | Warstwa dowodu                                   |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| AC01 | Nowy lokal → Próba → wybór i potwierdzenie KCS/PP; reload; zmiana metody po kalkulacji             | Sam wybór nie potwierdza; reload zachowuje potwierdzenie; zmiana usuwa poprzedni wynik                                          | UI + zapis/audit                                 |
| AC02 | KCS z11/12; PP z2/3/5/6 wybranymi z większej puli                                                  | KCS min12, PP dokładnie3–5, bez automatycznego wyboru                                                                           | UI + kontrakt serwera                            |
| AC03 | Dodaj Inną cechę, wpisz nazwę/definicje/wagę, zapisz i wróć; spróbuj pustej/zdublowanej nazwy      | Jeden własny wiersz; dane zachowane; błędy czytelne; nazwy katalogu stałe                                                       | UI + walidacja                                   |
| AC04 | Zmień skalę3→2 przy przeciętnej ocenie, uzupełnij końce; wpisz błędną sumę wag                     | Środek usunięty także w porównaniach; jawny ponowny wybór; błędne wagi nie pokazują WR                                          | UI + PDF                                         |
| AC05 | Wybierz PP z większej puli, zmień kolejność/usuń wiersz, reload, wróć do KCS                       | Oceny przypisane do tych samych tożsamości; zachowane ceny/pula/źródła; brak cichego zastąpienia wyboru                         | UI + persistence/provenance tests                |
| AC06 | Ustaw oceny PP; nadpisz mnożnik np.-1.25; dopisz uzasadnienie; otwórz drugi formularz i zmień dane | Sugestia odróżniona od decyzji; wyjątek wymaga uzasadnienia; stary formularz odrzucony i wymaga świadomego odświeżenia          | UI + row-lock/CAS tests                          |
| AC07 | Oblicz zatwierdzone wzorce i porównaj szczegóły rachunku                                           | PP740900/339400; KCS1044400/446900; brak dodatkowych zaokrągleń; ΔC0 poprawne                                                   | Domain goldens + UI representative fixture       |
| AC08 | Podgląd i pobranie DOCX/PDF dla PP3/4/5 oraz KCS ze skalami mieszanymi                             | Cztery tabele PP, prawidłowe kolumny/numeracja10–13/prawo/kwota; brak znaczników szablonu; długa cecha i polskie znaki czytelne | Parsed real PDF + Chrome visual                  |
| AC09 | Uzupełnij i potwierdź ręczne Opisy; zmień poprawkę bez zmiany zaokrąglonego WR                     | Tekst pozostaje, właściwe sekcje tracą aktualność; niezmienione ogólne opisy pozostają aktualne                                 | UI + deterministic prose contract                |
| AC10 | Podpisz syntetyczny dokument zatwierdzony przed zmianą; pobierz podpisany dokument ponownie        | Zachowany stary tekst/procenty/prawo poza podpisem; istniejące podpisane bajty i SHA niezmienne                                 | Frozen baseline + real across-version action/PDF |
| AC11 | Dla każdej pary KCS/PP × własność/spółdzielcze przejdź zapis→reload→Opisy→PDF→zatwierdź→podpisz    | Spójny wynik, prawo i ręczna proza w całym przepływie; syntetyczny podpis; dokument nieedytowalny po podpisaniu                 | Durable full-flow E2E + coordinator browser      |
| AC12 | Otwórz Pomoc przy metodzie/cechach; uruchom nowy zestaw3× i CI                                     | Instrukcje zgodne z UI, testy deterministyczne; czas i pominięcia jawnie podane                                                 | Help + CI logs                                   |

## Dane i ograniczenia

Wyłącznie własne syntetyczne wyceny oraz syntetyczny podpis. Hasła z lokalnego env nie trafiają do dowodów ani repo. Użytkownik testowy Zenon w ręcznej kontroli koordynatora; nazwa innego konta w automatycznych testach musi być jawna. Prawdziwy worker LibreOffice wymagany dla dokumentów; brak płatnych wywołań LLM, żywych importów i cudzych wycen. Opisy wyłączone flagą nie zamykają AC09/AC11: ręczna ścieżka z włączonym krokiem plus deterministyczne testy adaptera automatycznej prozy.

S1 zachował stare zatwierdzenia obu praw w DB5544 do AC10; nie zmieniać ich przed testem S4. IAB potrafił pokazać pusty PDF mimo poprawnego pliku: wizualny odbiór w Chrome, nie na podstawie samego iframe. Zrzuty/trace/dokumenty z brandingiem zostają poza gitem, w raporcie tylko ścieżki i faktyczne asercje.

## Rejestr wykonania

Uzupełnić po gotowej integracji: commit, web/worker/DB, użytkownik, data, wynik każdego AC, test i artefakt. Nie przenosić PASS z S1/S2 na jeszcze niezaimplementowany PP. Dowody etapów: S1-BROWSER.md, S2-REVIEW.md.
