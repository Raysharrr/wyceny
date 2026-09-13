# T-06–T-09 — audyt architektury i propozycja decyzji

2026-09-13 · baza `origin/main` = `9b2903c` po fetch · status: propozycja do zatwierdzenia przed kodem produkcyjnym.

## Wynik audytu

Zachowujemy modularny monolit i istniejący agregat wyceny. KCS i PP to dwa algorytmy wewnątrz tej samej odpowiedzialności, nie dwa serwisy. Potrzebne są wspólny kontrakt wejścia/wyniku, wspólna polityka gotowości, stabilna tożsamość ocen oraz osobne projekcje dokumentu. Nie potrzebujemy nowych tabel, kolejki, frameworka strategii, nowego systemu PDF ani rozszerzania shared kernel.

Audyt wykonano przez CodeGraph oraz odczyt źródeł i szablonów. Dotyczy miejsc zmienianych przez cały blok; nie jest ogólnym certyfikatem jakości repozytorium. Osobny [audyt dokumentu](DOCUMENT-AUDIT.md) zawiera dokładny łańcuch szablonów i podpisu.

## Miejsca zmian — źródło i konsekwencja

| Miejsce w apps/web/src                                                                             | Fakt w bazie                                                                                                | Konsekwencja                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| domain/kcs.ts:110–154,195–231                                                                      | Feature, Comparable i cały snapshot w module KCS; brak metody/ocen porównań; określone etapy zaokrągleń KCS | Wspólne typy przenieść do valuation-input.ts, re-export dla zgodności importów; zachować rachunek KCS                     |
| domain/valuation.ts:609–643                                                                        | Zapis próby i cech zeruje wr; potwierdzenia przenoszone w agregacie                                         | Dodać atomowe uzgadnianie danych PP i unieważnianie potwierdzeń na tych granicach                                         |
| domain/valuation.ts:655–661                                                                        | Kalkulacja od3, bez wspólnej walidacji wag                                                                  | Jedna polityka gotowości dla obu metod                                                                                    |
| domain/provenance.ts:124–132                                                                       | Approval wymaga12 niezależnie od metody                                                                     | Progi per metoda, potwierdzenie wybranej metody, kompletność PP                                                           |
| domain/wizard.ts; steps/step-calculation.tsx:20–54                                                 | Gotowość i KcsBreakdown sterują ekranem                                                                     | Użycie tej samej polityki i dyskryminowanego wyniku                                                                       |
| app/actions/wizard-schemas.ts:49–55; lib/valuation-form-schema.ts:15–48                            | Schematy wycinają dozwolone pola; zamknięte klucze, zawsze3 oceny                                           | Każde nowe pole musi przejść jawny schema/ACL/mapowanie; reguły cech współdzielone z domeną                               |
| lib/assign-provenance.ts:52–97                                                                     | Źródła/statusy ustalane po stronie web; nie ufa statusom klienta                                            | Potwierdzenie metody/ocen/poprawek w tej samej granicy zaufania                                                           |
| adapters/valuation-drizzle.ts:74–76,372–434                                                        | JSON snapshot, row lock, owner, draft-only CAS i audit                                                      | Rozszerzyć istniejące mutacje i meta audytu; nie przenosić zapisu PP poza blokadę                                         |
| adapters/valuation-drizzle.ts:625–708                                                              | Przy approve porównanie expectedInputs i ponowna kontrola prozy                                             | Zachować ochronę wyścigu render/zapis                                                                                     |
| steps/step-sample.tsx:105–230; use-sample-review.ts:39–61,107–149                                  | Jeden ekran dla źródeł, przelicza effective proposal, rcnRow zaokrągla cenę do2 miejsc                      | Oddzielić pulę propozycji od świadomie wybranych3–5; zachować KCS i ręczne poprawki; nie utracić precyzji ceny PP         |
| domain/sample-selection.ts:133–154,266–276; sample-manual.ts:68–98                                 | Ranking geograficzny, proposedN20, rejection dopełnia listę                                                 | Zachować algorytm KCS; dla PP checkbox wyboru nie jest odrzuceniem, nie dopełnia sam próby                                |
| steps/step-features.tsx:80–103,148–178                                                             | Mapowanie cech i podgląd KCS, nawet przy błędnej sumie                                                      | Własna cecha/skala w obecnych komponentach; podgląd wyłącznie poprawnych danych                                           |
| actions/preview-operat.ts:164; approve-valuation.ts:123; sign-valuation.ts:64; domain/prose.ts:192 | Niezależne computeKcs                                                                                       | Wszystkie ścieżki przechodzą przez wspólny dispatcher; dokument przez wspólną projekcję z częścią per metoda              |
| domain/prose-hash.ts:70–85                                                                         | Hash zależny od faktów per sekcja, brak PP                                                                  | Zmiany metody/poprawek muszą zmieniać odpowiednie fakty, nawet przy tym samym zaokrąglonym WR; nie psuć starych hashy KCS |
| domain/document-model.ts:411,489–499,569–583,653–665; adapters/docx-render.ts:23                   | Jedna projekcja KCS, zaokrąglone procenty, jeden szablon                                                    | Cztery tabele PP oraz skale/własna cecha w KCS; wspólne maskowanie i media                                                |
| domain/operat-sections.ts:14–37                                                                    | Faktyczne sekcje10–13, nie numeracja makiety                                                                | Zachować strukturę, Opisy i prawdziwy PDF                                                                                 |

### Zachowanie identyfikatora rejestru przy odczycie formularza

Inspekcja `step-sample.tsx:147–161` pokazuje mapowanie source/transactionId/lokalId bez coopTxId, podczas gdy `assign-provenance.ts:75` daje pierwszeństwo coopTxId, a samo transactionId kwalifikuje jako RCN. To ryzyko utraty źródła przy zapisie odświeżonego szkicu spółdzielczego. S3 ma dodać regresję round-trip i zachować ten identyfikator w mapowaniu, jeśli test potwierdzi problem. Jest to konieczne dla poprawnego użycia obu praw w nowym wyborze PP, nie osobny refaktor rejestru.

## Model odpowiedzialności

| Zdarzenie                           | Polecenie / aktor                 | Właściciel stanu                                 |
| ----------------------------------- | --------------------------------- | ------------------------------------------------ |
| Wybrano i potwierdzono metodę/próbę | zapis kroku3 / rzeczoznawca       | Valuation, transakcja repo                       |
| Zmieniono cechy i oceny porównań    | zapis kroku4 / rzeczoznawca       | Valuation; czyste feature-rules i pairwise-rules |
| Zasugerowano poprawki               | czysta funkcja po znanych ocenach | propozycja, nie potwierdzony fakt                |
| Potwierdzono kalkulację             | krok5 / rzeczoznawca              | Valuation, wr                                    |
| Zatwierdzono/podpisano operat       | obecne akcje / właściciel         | Valuation + istniejące porty storage/worker      |

Pula to dostępne kandydatki, próba to świadomie przyjęte transakcje; ocena nie jest mnożnikiem; sugestia nie jest potwierdzeniem; render dokumentu nie wybiera algorytmu wyceny. RCN/rejestr SM pozostają dostawcami danych za istniejącymi adapterami. Wewnętrzna domena nie importuje ORM, Zod, React ani klienta HTTP (ADR-008/F-10). Zachowujemy Sourced/statusy i audyt (ADR-010) oraz synchroniczne bramki (ADR-012).

## Proponowana decyzja architektoniczna D-ARCH

1. `valuation-input.ts` przejmuje współdzielone typy z kcs.ts; kcs.ts re-eksportuje historyczne nazwy, `KcsInput` pozostaje aliasem zgodności. `valuation-calculation.ts` zawiera jeden wybór algorytmu i politykę minimum/maksimum. Silniki czyste; KCS bez zmiany wzorów/zaokrągleń. Polityka nowych operacji jest osobna od arytmetyki potrzebnej do odtworzenia archiwum.
2. Rozszerzenie istniejącego JSON: metoda, potwierdzenie, dane ocen/poprawek PP; żadnej migracji wszystkich historycznych wierszy. Brak metody oznacza KCS przy odczycie/arytmetyce, ale nowa operacja zatwierdzenia szkicu wymaga jawnego wyboru. Odczyt zatwierdzonych/podpisanych danych ich nie uzupełnia ani nie zapisuje.
3. `comparables` zachowuje pełne dotychczasowe wiersze, a `pairwise.selectedComparableIds` wskazuje przyjęte3–5. Wspólny resolver `valuationComparables` karmi bramki, silnik, prozę i dokument; przełączenie do KCS nie usuwa ręcznych wierszy. Tożsamość transakcji: źródło + composite transactionId/lokalId lub coopTxId; ręczne wiersze dostają trwały id przy utworzeniu wiersza, zachowany przy edycji. Nazwa ani pozycja w tabeli nie stanowią identyfikatora. Klucze cech katalogowych + jeden `inne`; stare niejednoznaczne cechy bez kluczy nie są zgadywane podczas edycji.
4. Potwierdzenia PP należą do snapshotu i są weryfikowane w atomowym zapisie. Zmiana zależności kasuje aktualność, zachowując wartości robocze i własne opisy; nie oznaczamy starych mnożników jako automatycznie poprawnych. Usunięta transakcja/cecha nie przekazuje ocen nowej.
5. Zachować szablon i projekcję KCS z bazy jako ścieżkę podpisu starszych zatwierdzonych snapshotów bez metody. Nowo zatwierdzane dokumenty mają jawnie metodę; nowy renderer dostaje techniczny `templateVersion`, nie wybiera biznesowej metody. Nie budować repozytorium wersji szablonów. Jest to ograniczona zgodność z bazą9b2903c, nie obietnica odtworzenia dowolnej wcześniejszej wersji systemu.
6. Jedna integracja `integration/pairwise-valuation`; sesje z PR do niej, brak częściowych merge do main. Ostateczna kontrola na wspólnym web/worker/DB z integracji. Finalny PR do main dopiero po lokalnym PASS i przeglądach; merge/staging podlega końcowej bramce.

### Dlaczego refaktor jest potrzebny i orientacyjny koszt

| Refaktor konieczny                             | Bez niego                                                | Szacunek części przygotowawczej |
| ---------------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| Wspólny typ + dispatcher/polityka              | osobne if-y i różne progi w co najmniej6 wejściach       | 2–3 h                           |
| Tożsamość i atomowe uzgadnianie PP             | oceny przeniesione na inny lokal po sortowaniu/usunięciu | 2–3 h                           |
| Metodyczna projekcja dokumentu + legacy render | zmiana historycznego operatu podczas podpisu             | 2–3 h                           |

Szacunki planistyczne, nie pomiar przepracowanych godzin ani oferta dla klienta. Pozostałe kroki funkcjonalne w planie. Nie refaktorujemy innych modułów „przy okazji”.

## Techniczny spike tabel PP

PASS: oznaczone trzy tabele dynamiczne można przed obecnym Docxtemplater dopasować do3/4/5 kolumn porównań, aktualizując komórki, tblGrid i szerokości. Czwarta tabela wyniku jest stała. [Raport](../../../tools/spike/2026-09-13-pairwise-columns/RAPORT.md) zawiera sprawdzone syntetyczne DOCX/PDF; pełna paginacja z długimi polskimi nazwami wymaga kontroli w S4. Wąski helper adaptera dotyka tylko jawnie oznaczonych tabel PP, bez globalnego przepisywania tabel KCS i bez nowego renderera.

## Decyzja automatyzacji D-AUTO — potrzebna przed realizacją PP

Rekomendacja: po ocenieniu lokali aplikacja proponuje mnożnik `(ranga przedmiotu − ranga porównawczego)/(liczba poziomów − 1)`. Dla3 poziomów jedna różnica daje0,5 zakresu, dwie1; dla2 poziomów różnica daje1. To jawna propozycja do sprawdzenia, nie dowiedziona uniwersalna reguła z materiałów. Rzeczoznawca może zmienić mnożnik (także0,25 lub1,25), podaje uzasadnienie odstępstwa, potwierdza całą macierz. Nie ograniczamy domenowo do listy z makiety ani do±1; wymagamy wartości skończonej, uzasadnienia wyjątku i dodatniej ceny po korekcie.

Przykład: przedmiot przeciętny, porównawczy lepszy, skala3 → sugestia−0,5. Zmiana na−0,25 wymaga uzasadnienia i potwierdzenia. Arkusze przechowują oceny i mnożniki oddzielnie, dlatego automatyzacji nie wolno uznać za już zaakceptowaną. Alternatywa: wszystkie mnożniki wpisywane ręcznie, automatyczne tylko działania arytmetyczne (mniej odpowiada intencji klienta).

Ranking PP: wykorzystać obecne kryteria i dane, wyjaśnić odległość/tożsamość budynku oraz powierzchnię/datę jako jawne dane porównania, bez nowej nieuzgodnionej punktacji. Nie przypisywać ocen lokalizacji/standardu z brakujących danych. Podpowiedź oceny powierzchni dopuszczalna wyłącznie dla niezmienionych, maszynowo znanych progów presetu; brak takiej podstawy pozostawia pole puste. Nie dodawać LLM do oceny transakcji.

D-ARCH i D-AUTO są propozycjami do zatwierdzenia. Pełne źródła: [SOURCES](SOURCES.md). Akceptacja makiety nie rozstrzygnęła tych punktów.
