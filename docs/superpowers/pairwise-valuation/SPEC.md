# Lokale — cechy własne, skale i porównywanie parami

> D-ARCH i D-AUTO zatwierdzone przez użytkownika 2026-09-13. [Zapis decyzji i warunki realizacji](ACCEPTANCE.md). Bramka fazy4 jest zamknięta.

Status: projekt kontraktu przed implementacją, 2026-09-13. Kierunek funkcjonalny zaakceptowany; D-ARCH/D-AUTO w [ARCHITECTURE](ARCHITECTURE.md) zatwierdzone do realizacji. Baza9b2903c. [Źródła](SOURCES.md), [pierwotny plan cech](ORIGINAL-FEATURE-PLAN.md) zachowany jako materiał historyczny; ten spec zastępuje jego wyłączenie PP, bazę/worktree i dawny build-slice. Oryginał poza tym worktree pozostaje nietknięty.

## Z perspektywy rzeczoznawcy

Krok Próba proponuje metodę zależnie od dostępnych danych i prosi o świadomy wybór. KCS wymaga minimum12 transakcji. PP przyjmuje3–5 wybranych przez człowieka; propozycje nie są wyborem. Przy6–11 transakcjach można wskazać z nich3–5 do PP lub uzupełnić próbę KCS. Nie przełączamy metody w tle po zmianie liczebności.

W kroku Cechy można dodać jedną własną cechę i wybrać skalę2/3. Dla PP dochodzą oceny każdej przyjętej transakcji oraz jawne podpowiedzi poprawek z możliwością uzasadnionego nadpisania. Kalkulacja pokazuje wszystkie poprawki i ceny po korekcie. Kolejne kroki nadal obejmują Opisy i rzeczywisty podgląd PDF. Operat zachowuje strukturę obecnej aplikacji; część metodyczna zawiera właściwe cztery tabele PP.

Nie zmieniamy stylu aplikacji, nie wdrażamy domów/działek, katalogów wag130%/120%, profili biura, uczenia lub nowych źródeł danych. HTML nie jest kodem do przeniesienia do produktu.

## Kontrakty wspólne (do zamrożenia w S1)

Poniższe nazwy są uzgodnionym projektem interfejsów sesji po zatwierdzeniu D-ARCH. S1 może zgłosić konieczną korektę, ale przed uruchomieniem zależnych sesji koordynator aktualizuje wszystkie HANDOFF-y.

```ts
type ValuationMethod = "kcs" | "pp";
type RatingScale = "two" | "three";
type FeatureRating = "gorsza" | "przecietna" | "lepsza";
// Obecne pola Feature i Comparable pozostają; dodatki są opcjonalne dla historii.
// Feature.ratingScale?: RatingScale; Comparable.id?: string (manual-row id)
// Nowy ValuationInput zawiera wszystkie obecne pola KcsInput oraz:
type MethodFields = {
  method?: ValuationMethod;
  methodConfirmed?: boolean;
  pairwise?: PairwiseSnapshot | null;
};
type PairwiseCell = {
  rating: FeatureRating | null;
  multiplier: number | null;
  overrideReason?: string;
};
type PairwiseSnapshot = {
  selectedComparableIds: string[];
  // klucz transakcji → klucz cechy → ocena i przyjęty mnożnik
  comparisons: Record<string, Record<string, PairwiseCell>>;
  confirmedBasis?: string; // brak = macierz niepotwierdzona
};
// confirmedBasis stempluje web po jawnym akcie. Poprawki są potwierdzone tylko gdy
// confirmedBasis === pairwiseBasis(bieżący snapshot). Klient nie nadaje tego markera.
type CalculationIssue = { path: string; label: string };
// signatures:
// resolveMethod(input: ValuationInput): ValuationMethod
// comparableIdentity(row: Comparable): string | null
// valuationComparables(input: ValuationInput): Comparable[]
// pairwiseBasis(input: ValuationInput): string
// allowedRatings(feature: Feature): readonly FeatureRating[]
// validateFeatures(features: readonly Feature[]): CalculationIssue[]
// calculationIssues(input: ValuationInput): CalculationIssue[]
// computeValuation(input: ValuationInput): ValuationResult
// suggestPairwiseMultiplier(subject: FeatureRating, comparable: FeatureRating,
//                          scale: RatingScale): number
// computePairwise(input: ValuationInput): PairwiseResult
// result = ({method:"kcs"} & KcsResult) | ({method:"pp"} & PairwiseResult)
// PP common fields: cmin,cmax,unitValue,wrUnrounded,wr;
// PP details: priceSpread, pairs[{comparableId,pricePerM2,corrections[
// {featureKey,weight,range,multiplier,amount}],totalCorrection,correctedPrice}]
```

`comparables` zachowuje dotychczasowe wiersze próby/puli, również ręczne; PP zapisuje osobno `selectedComparableIds`. `valuationComparables` rozwiązuje wybrane id do dokładnie3–5 wierszy PP albo zwraca pełną próbę KCS. Jest wspólnym wejściem progów, arytmetyki, prowenancji porównań, faktów prozy i tabel dokumentu. Brak/duplikat/obcy id jest błędem. Przełączenie PP→KCS nie kasuje niewybranych ręcznych transakcji.

`computeValuation` rozstrzyga metodę raz i odrzuca nieznany wariant. Gotowość operacji (`calculationIssues`) obejmuje próg i potwierdzenie, ale odtworzenie archiwalnego zatwierdzonego KCS nie otrzymuje nowych retroaktywnych blokad. Nowy szkic bez wyboru może się zapisać; nie może zatwierdzić kalkulacji/operatu. `pairwiseBasis` jest czystą funkcją S1: serializuje metodę, powierzchnię, wybrane id W KOLEJNOŚCI (kolumny dokumentu), dane użytych transakcji, cechy i wszystkie komórki ocen/mnożników/uzasadnień; pomija wyłącznie marker confirmedBasis i statusy. Klucze map sortuje deterministycznie, kolejności porównań nie sortuje. `expectedPairwiseBasis` żądania to odcisk snapshotu OTWARTEGO formularza, nie przesyłanych po edycji wartości. S2 porównuje go z bazą pod blokadą, następnie stempluje odcisk NOWEGO snapshotu po świadomym potwierdzeniu. To nie jest samoodwołanie: marker nie należy do własnego odcisku.

`KcsInput` pozostaje aliasem/re-exportem dla kompatybilności, nie drugim niezależnym modelem. Domena nie importuje UI, Zod ani infrastruktury.

## Cecha własna i skale

- `Feature.rating` w zapisanej cesze nadal jest wymagane; pusty wybór przedmiotu istnieje wyłącznie w stanie formularza i blokuje zapis. `PairwiseCell.rating=null` może oznaczać nieukończony szkic porównań, ale blokuje kalkulację. `LOKAL_FEATURE_KEYS` i katalog9 pozostają bez zmian; nowy `FEATURE_INPUT_KEYS` rozszerza dozwolone wejście o `inne`.
- Jeden klucz `inne`; nazwa trim1–120 znaków, bez kolizji z nazwami katalogu/aktywnymi nazwami po normalizacji wielkości liter i białych znaków. Stałe nazwy katalogowe sprawdzane po stronie serwera.
- Własna cecha startuje bez oceny, waga0, skala3, puste definicje. Wszystkie dozwolone definicje własnej cechy wymagane (do1000 znaków każda).
- Brak ratingScale w historii=3. 3→2 usuwa ocenę przeciętną przedmiotu i porównań, wymaga ponownego wyboru; końce zachowane. Skala2 zapisuje tylko definicje końców; wymagane oba. Stare katalogowe skale3 nie dostają wymogu pełnych definicji.
- Waga w snapshotcie ułamek, w UI procent. Wartości skończone/nieujemne, suma100%±0,1p.p. Bez automatycznej normalizacji. Waga0 nie uczestniczy w kalkulacji, prozie ani dokumencie; niekompletny własny wiersz przed zapisem trzeba uzupełnić/usunąć.
- KCS zachowuje istniejące wzory i zaokrąglenia. Skala2 daje istniejące końce Ui, bez środka. W dokumencie środek Ui i środkowa SUMA przy skali mieszanej mają kreskę z wyjaśnieniem; same skale3 bez zmian. Druk procentów do2 miejsc i rzeczywista suma.
- Odczyt historycznych kluczy bez key nie zgaduje tożsamości. Przy edycji jednoznaczne nazwy można przypisać do katalogu; niejednoznaczność ma czytelny komunikat bez utraty danych. PP wymaga jawnych unikalnych kluczy.

## Próba, precyzja, sugestie i poprawki

- Zachować pobranie/przegląd RCN i rejestru SM, maskowanie, ręczne poprawki i źródła. KCS ranking/F-14 nie zmienia się. `id` musi jawnie przejść przez comparableSchema i mapowania. Tożsamości mają osobne przestrzenie `rcn:tx|lok`, `sm:coopTxId`, `manual:uuid`. Serwer wylicza tożsamości rejestrów i sprawdza unikalność; przy niepełnym identyfikatorze źródłowym nadaje trwałe id zapisu (bez udawania ręcznego pochodzenia). Dla istniejącego wiersza zachowuje wcześniej nadane id. Nowy ręczny wiersz może mieć tymczasowy id klienta; zapis weryfikuje format/unikalność i trwałą tożsamość, nie ufa podszyciu pod id rejestru. PP wybór to jawna lista, nie usuwanie z dopełnianego proposedN20. Zmiana promienia nie zmienia wybranych lokali bez komunikatu/aktu użytkownika.
- Nie zmieniać znaczenia ani precyzji istniejącego `pricePerM2`: zachować obecne zaokrąglenie importu rcnRow do2 miejsc, klucze dopasowania prowenancji i zapisane ręczne wartości. PP liczy bez kolejnych zaokrągleń pośrednich z wartości ZAPISANYCH. Zmiana metody/fetch→save→reload nie może podmieniać ceny ani gubić potwierdzeń. Test arytmetyki wzorcowej używa pełnych liczbowych wejść arkusza; test aplikacyjny osobno obejmuje obecny import2 miejsc — oba dają te same finały740900/339400, lecz kwoty pośrednie nie muszą być identyczne. Nie wprowadzać nowego pola źródłowej ceny w tym bloku.
- ΔC=max−min cen wybranych3–5. Poprawka=ΔC×waga×przyjęty mnożnik. Cena skorygowana=cena+suma poprawek. Średnia arytmetyczna bez przedwczesnego zaokrąglenia, ×powierzchnia, końcowe zaokrąglenie do100. Formatowanie dokumentu nie staje się wejściem rachunku. ΔC0 daje zerowe poprawki i równą cenę; nie dzielić przez0.
- D-AUTO: sugestia z uporządkowanych ocen; człowiek zatwierdza. Własna korekta różna od sugestii wymaga uzasadnienia. Nie przycinać do±1 ani siatki0,5. Ujemna/zerowa skorygowana cena blokuje. Mnożnik/ocena0 to poprawne dane, null to brak.
- Serwer ponownie wylicza sugestię i weryfikuje wyjątek/kompletność. Klient nie może nadać statusu potwierdzenia cudzej lub nieaktualnej macierzy. Ochrona starych formularzy: żądanie FeaturesUpdate zawiera `expectedPairwiseBasis: string`, obliczony przez `pairwiseBasis` ze snapshotu otwartego formularza zgodnie z pełną definicją powyżej; atomowy zapis porównuje je z bieżącym snapshotem i przy zmianie zwraca konflikt zamiast potwierdzać niewidziane dane.
- Sugestie ocen tylko ze znanych, strukturalnych progów presetu; zmienione teksty definicji wyłączają taką sugestię. Nie klasyfikować standardu/otoczenia ani roku budowy na podstawie braku danych.

## Wybór metody jako jawna mutacja

`selectMethodAction(id, {method, confirm:true})` → `PortValuation.selectMethod` → `applyMethodSelection` pod owner/draft/row-lock. Ustawia method i methodConfirmed z jawnego aktu. SampleUpdate nie zmienia metody; zapisuje pulę i selectedComparableIds. Sugestia metody jest stanem UI, nie zapisanym potwierdzeniem. Jeśli resolveMethod przed/po jest ten sam (w tym brak→kcs dla starego szkicu), wybór zachowuje WR i stare hashe prozy; rzeczywiste kcs↔pp zeruje WR i aktualność poprawek. Zwykły zapis próby zachowuje dotychczasowe unieważnianie WR. `newVersionOf` zachowuje wybraną metodę jako propozycję do ponownego potwierdzenia (methodConfirmed=false), usuwa confirmedBasis i zeruje WR; nie kopiuje potwierdzeń.

## Unieważnianie i historia

| Zmiana                                      | WR / macierz                                                                                 | Opisy                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Metoda                                      | WR=null, potwierdzenie metody i poprawek ponowne                                             | stara treść pozostaje, sekcje zależne od metody nieaktualne                         |
| Próba, cena, powierzchnia porównania        | WR=null, potwierdzenie poprawek wygasa; wartości dla tożsamych lokali można zachować roboczo | analiza/uzasadnienie zależnie od rzeczywistych faktów                               |
| Nazwa, klucz, skala, definicja, ocena, waga | WR=null, odpowiednie oceny/wyjątki do sprawdzenia; usunięty klucz usuwa powiązania           | aktualność sekcji, które korzystają ze zmienionych faktów                           |
| Mnożnik lub uzasadnienie wyjątku            | WR=null, potwierdzenie poprawek ponowne                                                      | uzasadnienie/sekcja metodologiczna zależna od tego faktu, nawet przy niezmiennym WR |
| Powierzchnia przedmiotu                     | WR=null; zależne sugestie ponownie do sprawdzenia                                            | istniejące zależności faktów                                                        |
| Podpisany operat                            | brak edycji/re-renderu; nowa wersja istniejącą ścieżką                                       | zamrożone                                                                           |

Utrzymać stary kształt hashy dla niezmienionych danych KCS. Dla PP dodać fakty metody/porównań do właściwych sekcji, nie wszystkich sześciu. Nie kasować ręcznych opisów. Approval zachowuje expectedInputs/CAS i blokadę nieaktualnej prozy.

## Dokument i podpis

Wspólna projekcja faktów i maskowania; deterministyczna część metodyczna KCS albo PP. Cztery tabele PP zgodnie z [SOURCES](SOURCES.md), dynamicznie3/4/5 porównań. Adaptacja obu praw do lokalu, bez utraty map, zdjęć i podpisu. Zachować sekcje10–13 aplikacji i wygenerowane operat-sections.ts. Pomoc opisuje nowe zachowanie.

Stare zatwierdzone snapshoty bez method: zachowana arytmetyka KCS, OBOWIĄZKOWA stara projekcja (w tym procenty) i szablon9b2903c przy podpisie. Pierwszy krok S4 przed zmianami utrwala syntetyczny referencyjny tekst renderu9b2903c. Podpis takiego snapshotu nie uruchamia nowych calculationIssues ani walidacji cech. Renderer przyjmuje `templateVersion?: "legacy-kcs" | "valuation-v2"`. Nowy dokument nie może zostać wydany bez jawnej metody. Podpisane pliki/SHA bez zmian. Ścieżka zgodności dotyczy tej granicy wdrożenia, nie dowolnej historii wcześniejszych szablonów.

Wszystkie produkcyjne akcje kalkulacji/prozy/preview/approve/sign używają dispatchera. Bramy, statystyki, fakty i dokument używają valuationComparables zamiast surowej puli. Nowy test fitness wykrywa bezpośrednie computeKcs poza dispatcherem, modułem zachowanej legacy arytmetyki i testami. Nie zmieniać istniejących narzędzi golden używających silnika bezpośrednio.

## Macierz odbioru

- AC01: metoda proponowana, jawnie wybrana/potwierdzona, zmiana unieważnia wynik.
- AC02: KCS<12 i PP poza3–5 zablokowane na UI i serwerze; wybór PP nie automatyczny.
- AC03: własna cecha, unikalność i stałe nazwy; zapis/odczyt bez utraty.
- AC04: skala2/3 przedmiotu i porównań, brak ukrytej przeciętnej; błędne wagi bez WR.
- AC05: tożsamość transakcji/cechy po reorder/remove/reload/radius, zachowane ceny i potwierdzenia przy przełączeniu metod.
- AC06: sugestie vs override, uzasadnienie i ponowne potwierdzenie; wyścigi/stary formularz odrzucone.
- AC07: wzorce PP740900 i339400, ułamki/ekstrapolacja, ΔC0; KCS1044400 i446900 bez zmian.
- AC08: cztery tabele PP, skale/procenty KCS,3/4/5 transakcji, oba prawa, PDF bez placeholderów/PII.
- AC09: Opisy i aktualność per sekcja; compute/preview/approve/sign zgodne; ręczny tekst zachowany.
- AC10: stare snapshoty, podpisane artefakty i zatwierdzenie przed aktualizacją→podpis po niej.
- AC11: pełne UI→zapis→reload→Opisy→PDF→approve→document→sign dla2 metod×2 praw.
- AC12: Pomoc, trwałe E2E w CI,3× deterministyczny przebieg, czyste granice zależności.
