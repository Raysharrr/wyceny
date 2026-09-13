> ARCHIWALNA KOPIA PLANU CECH. Zachowana bez utraty wcześniejszej pracy. Polecenia dotyczące build-slice, osobnej realizacji cech, braku PP i wcześniejszej bazy/worktree nie obowiązują w nowym bloku. Aktualne wymagania wykonawcze: SPEC.md, ARCHITECTURE.md i plan T-06–T-09. Oryginalny plik w worktree cechy-lokali pozostaje nietknięty.

# Plan: cecha własna i skale ocen dla lokali — T-08/T-09

**Data:** 2026-09-13. **Status:** plan do przeglądu; zakres planowania potwierdzony przez użytkownika. Implementacji nie rozpoczęto.

**Baza inspekcji:** app `9b2903c`; [analiza źródeł i kodu](/Users/michalczekala/Development/wyceny/wiki/topics/tech/cechy-wagi-2026-09-13-przygotowanie-wdrozenia.md). Przy rozpoczęciu prac sprawdzić aktualny HEAD i dostosować plan do ewentualnych zmian.

**Dedykowane miejsce pracy — wymaganie użytkownika:** `/Users/michalczekala/Development/wyceny-app-worktrees/cechy-lokali`, gałąź `feature/apartment-features`, utworzona z `9b2903c`. Plan i całą implementację aplikacji prowadzić tutaj, nie w głównym checkoutcie `wyceny-app`. Worktree ma ten sam commit co zweryfikowana baza 156 testów; przed realizacją przygotować w nim zależności i jawnie lokalną konfigurację. Działający wcześniej serwer 3000 pochodzi z głównego checkoutu — przed testami zmian zastąpić go serwerem z tego worktree. Nie przenosić sekretów do śledzonych plików.

## Opis produktowy — co budujemy z perspektywy użytkownika

Wyceniany obiekt nadal jest **lokalem mieszkalnym**. Funkcja działa dla odrębnej własności i spółdzielczego własnościowego prawa do lokalu. Użytkownik pracuje w obecnym kroku 4 „Cechy”, bez nowego kreatora i bez wyboru domu lub działki.

Zostaje lista dziewięciu znanych cech, z której sześć jest aktywnych na początku. Zostają obecne wagi startowe. Użytkownik może dodać **jedną cechę własną**, wpisać jej nazwę, np. „winda wewnątrz mieszkania”, nadać wagę, opisać znaczenie ocen i wybrać ocenę lokalu.

Przy każdej cesze pojawia się wybór **„2 stopnie” / „3 stopnie”**. Dwa stopnie oznaczają wyłącznie „gorsza” i „lepsza”; trzy dodają „przeciętna”. Zmiana skali nie zmienia wagi. Jeżeli użytkownik wyłączy środkowy stopień, gdy był zaznaczony, musi sam wskazać nową ocenę.

Po dodaniu lub usunięciu cechy użytkownik sam koryguje wagi do 100%. Dopóki zestaw jest niepoprawny, zamiast wyliczonej kwoty widzi informację, co uzupełnić. Po zatwierdzeniu kroku nazwa własnej cechy, jej waga i ocena pozostają po odświeżeniu i trafiają do operatu.

Pod maską rozszerzamy dane cechy zapisane w istniejącej wycenie. Pozostają obecny silnik KCS, zapis transakcyjny, kontrola dostępu i ochrona zatwierdzonych dokumentów; nie budujemy odrębnego silnika ani bazy słowników użytkownika.

## 1. Zakres i źródła

**W zakresie:**

- jedna cecha własna na wycenę, z własną nazwą;
- jawny wybór skali dwustopniowej lub trzystopniowej per cecha;
- walidacja w formularzu i backendzie, czytelne błędy i poprawny podgląd;
- spójność zapisu, kalkulacji, opisów i tabel dokumentu;
- precyzja wag w wydruku odpowiadająca wartościom formularza;
- regresja dla obu praw do lokalu i istniejących snapshotów.

**Poza zakresem:** domy, działki, nowe wagi z maila 7.09, automatyczna normalizacja wag, uczenie z historii, profile własnych presetów, osobne katalogowe cechy ogródek/parking/komórka, dowolne nazwy poziomów lub skale 4+ stopni, metoda porównywania parami.

Źródła potrzeb: [mail 26.08 — liczba ocen](/Users/michalczekala/Development/wyceny/raw/emails/2026-08-26-uwagi-anety-runda-2/02-uzupelnienie-2026-08-26.md:24), [spotkanie 28.08 — cecha własna i stałe nazwy](/Users/michalczekala/Development/wyceny/raw/meetings/2026-08-28-omowienie-aplikacji-wyceny/transcript.md:195), [T-08/T-09](/Users/michalczekala/Development/wyceny/wiki/deliverables/2026-08-31-lista-zadan-dla-klienta.md:431), [ADR-006](/Users/michalczekala/Development/wyceny/wiki/decisions/ADR-006-wagi-cech-preset-nie-r2.md).

Mail z 7.09 nie jest blokadą tego zakresu. Wyjaśnienie sum 130%/120% dotyczy przyszłych katalogów domów i działek. Śledzenie późniejszej implementacji: **T-31 w LATER** w [roadmapie wiki](/Users/michalczekala/Development/wyceny/wiki/roadmap.md), z zakresem i warunkami rozpoczęcia. Nazwy kolejnych gałęzi po angielsku, kebab-case, według rodzaju pracy (`feature/`, `fix/`, `chore/`), zgodnie z aktualnym kontraktem wiki.

## 2. Kontrakt zachowania

### 2.1 Cecha własna

- Wybór „Inna cecha…” w istniejącym mechanizmie dodawania. Po dodaniu opcja znika; wraca po usunięciu wiersza.
- Zapisany identyfikator: `key: "inne"`. Nazwa wpisana przez użytkownika jest nazwą wyświetlaną również w dokumencie; „inne” nie zastępuje jej na wydruku.
- Początek: pusta nazwa, waga 0%, skala 3, ocena niewybrana, puste definicje. Nie zakładamy, że nowa cecha jest przeciętna.
- Własna nazwa: po trim 1–120 znaków. Brak kolizji z nazwami katalogu i aktywnych cech po ujednoliceniu wielkości liter oraz białych znaków. Nie usuwamy polskich znaków z nazw wyświetlanych.
- Dla własnej cechy wymagane są opisy wszystkich dozwolonych ocen i wskazana ocena; maksymalnie 1000 znaków na opis. Są to limity techniczne proponowane w tym planie, nie wymaganie podane przez Anetę.
- Waga 0% jest dozwolona jako przygotowany wiersz, ale taka cecha nie wpływa na wynik, dokument ani prozę. Niekompletny nowy wiersz należy uzupełnić lub usunąć przed zapisem.
- Nazwy cech katalogowych pozostają stałe także w backendzie. Własna cecha nie staje się wspólnym wpisem dla innych wycen.

### 2.2 Skala ocen

- Pole snapshotu `ratingScale?: "two" | "three"`. Brak pola oznacza dotychczasowe trzy stopnie.
- Obecne presety nie zmieniają automatycznie skali. Użytkownik może świadomie ustawić dwa stopnie dla pomieszczeń przynależnych, dodatków lub innej cechy.
- UI pokazuje tylko dozwolone przyciski. Definicje i dozwolone oceny to odrębne dane: pusty opis nie wyłącza oceny.
- Przełączenie 3→2 zachowuje „gorszą”/„lepszą”, a „przeciętną” zamienia w stan formularza „Wybierz ocenę”. Ten pusty stan nie może zostać zapisany jako poprawna ocena.
- Dla wybranej skali 2 trzeba uzupełnić definicje obu końców. W zapisie skali 2 pomijamy definicję „przeciętnej”. UI może zachować jej niezapisany tekst do przełączenia z powrotem w tej samej sesji edycji.
- Przełączenie 2→3 zachowuje wskazany koniec i udostępnia środek. Dotychczasowe standardowe cechy trzystopniowe zachowują obecne zasady opcjonalnych opisów; nie wymuszamy uzupełniania wszystkich starych opisów przy okazji tej zmiany.
- Dla skali 2 rachunek korzysta z obecnych końców KCS: gorsza=`w×Vmin`, lepsza=`w×Vmax`. Nie zmieniamy wzoru, wag ani zaokrągleń. Przykład: `w=0,1`, `Vmin=0,8`, `Vmax=1,2` → `Ui=0,08` albo `0,12`.

### 2.3 Wagi, podgląd i zapis

- Zachowujemy wagę jako ułamek w `inputs.features`, procenty w formularzu oraz dotychczasową tolerancję sumy ±0,1 p.p. Nie wprowadzamy automatycznego skalowania do 100%.
- Sprawdzamy wartości skończone, nieujemne, sumę, klucze, nazwy, skalę i ocenę. Ten sam wynik walidacji steruje podglądem oraz zapisem. Zod pozostaje na granicy formularza, a reguły obliczeniowe są czystą logiką domenową.
- Przy złej sumie lub niepełnych cechach nie pokazujemy ΣUi/WR jako gotowego wyniku ani w sidebarze, ani w dolnym pasku. Pokazujemy sumę i konkretny komunikat, np. „Suma wag wynosi 130%. Popraw ją do 100%, aby zobaczyć wynik”.
- Zapis pozostaje przyciskiem „Zatwierdź cechy i dalej”; błędne wejście nie zapisuje części zestawu. Komunikat wskazuje pole/wiersz, a nie tylko ogólne „błąd”.
- Poprawny zapis: transakcja, kontrola właściciela i szkicu, aktualizacja `inputs.features`, potwierdzenie grupy, `wr=null`, obecne wpisy audytu. Krok 5 wymaga ponownej kalkulacji.
- Reguły wagi i zgodności skali/oceny sprawdzamy także przy kalkulacji i zatwierdzeniu, aby ominięcie formularza nie zalegalizowało błędnych danych.

### 2.4 Dokument — propozycja konkretnego wyglądu

Tabela definicji pokazuje dokładnie 2 albo 3 poziomy. Tabela współczynników zachowuje obecny układ sześciu kolumn; wiersz dwustopniowy ma kreskę w `Ui śr`, wiersz trzystopniowy zachowuje obecną wartość. Pod tabelą dopisek: „Kreska oznacza, że dla tej cechy nie stosuje się oceny pośredniej”. Dopisek pojawia się tylko przy co najmniej jednej aktywnej cesze dwustopniowej.

| Cecha                                 | Waga | Ui min | Ui śr | Ui max | Ui przedmiotu |
| ------------------------------------- | ---: | -----: | ----: | -----: | ------------: |
| standard wykończenia (3 stopnie)      |  90% |  0,720 | 0,900 |  1,080 |         0,900 |
| winda wewnątrz mieszkania (2 stopnie) |  10% |  0,080 |     — |  0,120 |         0,120 |
| SUMA                                  | 100% |  0,800 |     — |  1,200 |         1,020 |

To przykład syntetyczny, z `Vmin=0,8`, `Vmax=1,2`, standardem przeciętnym i windą ocenioną jako lepsza. Przy mieszanych skalach nie ma wspólnego wariantu „wszystkie przeciętne”, dlatego środkowa komórka SUMA też pokazuje kreskę. Dla samych skal 3 pozostaje `1,000` i dotychczasowy wygląd.

Waga drukowana zachowuje do dwóch miejsc po przecinku, z pominięciem zbędnych zer: 10% → 10%, 10,25% → 10,25%. Przy dopuszczonej tolerancji sumy nie drukujemy fikcyjnego 100, jeśli zapisane wagi sumują się np. do 99,95%: komórka SUMA ma pokazywać rzeczywistą sumę. Nie zmieniamy przy tej okazji precyzji `Ui` ani WR.

Nowe pola modelu dokumentu, np. `ma_skale_dwustopniowe`, `suma_ui_sr`, `suma_wag_pct`, muszą otrzymać wartości odtwarzające stary wygląd dla starych danych. Zmiana szablonu skryptem, bez ręcznej edycji binarnego DOCX.

### 2.5 Historia i proza

- Nie aktualizujemy zbiorczo bazy ani zapisanych operatów. Nowe pola żyją w istniejącym JSON; plan nie wymaga migracji SQL.
- Odczyt i render snapshotu bez `ratingScale` zachowują trzy stopnie. Nie dopasowujemy historycznych wag i opisów do nowej wersji katalogu.
- Starsze fixture'y bez `key` pozostają poprawne dla odczytu, obliczenia i renderu. Nowa walidacja sumy/skali nie może wymagać katalogowego klucza w tych ścieżkach.
- Przy edycji starego szkicu bez kluczy stosujemy dopasowanie do katalogu wyłącznie przy jednoznacznej nazwie; nie zgadujemy i nie zamieniamy kilku nierozpoznanych cech na jedną „inne”. Jeśli taki przypadek istnieje, dajemy jawny komunikat wymagający osobnego rozwiązania, bez utraty danych.
- Proza nadal otrzymuje nazwy i wybrane oceny cech o wadze >0. Dlatego pilnujemy unikalności nazw. Nie zmieniamy globalnego kontraktu workera ani hashy prozy tylko po to, by dodać metadane skali.
- Testujemy aktualność sekcji po zmianie nazwy, wybranej oceny i aktywnego zestawu. Same definicje skali dziś nie są faktem prozy: nie obiecujemy ich automatycznego opisywania przez AI. Dane definicji zawsze trafiają do deterministycznych tabel dokumentu.

## 3. Układ UI i zasady techniczne

Punktem odniesienia jest istniejący krok 4 sprawdzony na localhost 13.09 oraz ekran Cechy z [makiety v3-r4](</Users/michalczekala/Development/wyceny/raw/interactive-mockup/Wyceny%20-%20Makieta%20MVP%20(standalone)%20-%20v3-r4-2026-06-30.html>). Nowe pole nazwy i wybór skali są świadomym rozszerzeniem tego ekranu; nie przebudowujemy kreatora.

- `StepFeatures` pozostaje komponentem `"use client"`: lokalny stan formularza, zmiana skali i podgląd. Strona i odczyt wyceny pozostają RSC.
- Mutacja przez istniejące `saveFeaturesAction`, bez nowego Route Handlera. Walidacja po obu stronach.
- Wykorzystać istniejące `SectionCard`, `Table`, `Input`, `Button`, `FieldError`, `FootNav` i mechanizm rozwijania definicji. Skala jako oznaczona grupa dwóch przycisków albo istniejący prosty `select`; bez nowej biblioteki.
- Własna nazwa jest polem `Input` tylko w wierszu własnej cechy. Przyciski oceny muszą mieć dostępne etykiety zawierające nazwę cechy; pusta nazwa używa „Inna cecha”.
- Zachować obecne kolory, typografię, odstępy i dwukolumnowy układ z podglądem. Sprawdzić desktop i węższy widok, w którym tabela nie może zasłaniać przycisków.
- Nazwy kodu i komentarze po angielsku, UI i dokument po polsku. API frameworka sprawdzać w lokalnych instrukcjach Next.js; nie przepisywać istniejącego przepływu na podstawie starszych przykładów.

## 4. Zadania wykonawcze

Kolejność **1 → 2 → 3 → 4 → 5**. Zadania dotykają wspólnych plików, dlatego nie planować równoległych implementacji. Każde zadanie: test wykazujący brak, minimalna implementacja, testy adekwatne do zmiany i niezależny przegląd według lokalnego `build-slice`. Ten dokument nie uruchamia implementacji ani publikacji.

### Zadanie 1 — reguły cechy, skali i zgodność danych

**Pliki:** `apps/web/src/domain/kcs.ts` (typ `Feature`), `domain/feature-presets.ts`; nowy `domain/feature-rules.ts`; `lib/valuation-form-schema.ts`; `tests/f6-feature-preset.test.ts`, `tests/valuation-form-schema.test.ts`; nowy `tests/feature-rules.test.ts`.

**Interfejsy:** typ skali, resolver skali domyślnej, lista dozwolonych ocen, identyfikator własnej cechy, normalizacja nazwy i walidacja zestawu. Reguły domeny nie importują formularza/Zod/React. Osobno reguły poprawności obliczeń (także historyczne dane bez klucza) i kontrakt zapisu nowego formularza.

- [ ] RED: własna cecha, duplikat własnej, nazwa kolidująca z katalogiem, pusta nazwa, nieznany klucz, podmieniona nazwa katalogowa, niewłaściwa ocena skali 2, ujemna/nieskończona waga, zła suma.
- [ ] RED kompatybilności: brak skali=3; fixture bez kluczy nadal liczy i renderuje; dziewięć standardowych kluczy i wagi 40/30/10/10/4/6 bez zmian.
- [ ] GREEN: dodać czyste reguły i podpiąć je do schematu; nie zmieniać wzoru `computeKcs`.
- [ ] Sprawdzić granice tolerancji wag na obecnych jednostkach, żeby konwersja `% ↔ ułamek` nie dała innego wyniku po stronie serwera.
- [ ] F-6 ma nadal pilnować katalogu 9 pozycji; własna cecha jest osobnym typem wejścia, a nie dziesiątym standardowym presetem.

**Odbiór:** walidacja rozróżnia poprawne/niepoprawne zestawy, a stare poprawne wyceny pozostają zgodne. To mały etap przygotowawczy dla dwóch kolejnych funkcji, nie osobne wydanie.

### Zadanie 2 — własna cecha od formularza do zapisu

**Pliki:** `app/valuations/[id]/steps/step-features.tsx`, `app/actions/wizard.ts`, `lib/assign-provenance.ts`, `domain/valuation.ts`; sprawdzić mapowania w `app/actions/create-valuation.ts`; testy `rtl-features-section`, `wizard-actions`, `wizard-domain`, `wizard-repo`, `assign-provenance`.

**Interfejsy:** rozszerzony `FeaturesStepInput` i `FeaturesUpdate`; nazwa, klucz, opisy i skala przenoszone w całości do `inputs.features`. Adapter SQL nadal operuje snapshotem; nie tworzymy tabeli cech.

- [ ] RED: dodaj „Inna cecha…”, wpisz nazwę, wagi sumujące się do 100%, opisy i ocenę; akcja dostaje komplet; odczyt z repo zwraca identyczną cechę.
- [ ] RED: druga własna cecha odrzucona serwerowo; nazwa standardowa niezmienialna przez żądanie; brak uprawnień i zapis do zatwierdzonej wyceny odrzucone.
- [ ] GREEN: nowy wiersz i obsługa usunięcia/powrotu opcji; serwerowa normalizacja; zachowanie obecnej transakcji, potwierdzenia i audytu.
- [ ] Dla katalogowych nazw porównywać po neutralnej normalizacji; nie przepisywać historycznych snapshotów podczas odczytu. Dodać test starego szkicu z działającym zestawem kluczy.
- [ ] Potwierdzić pochodzenie `rzeczoznawca` dla własnej cechy; niewprowadzony ręcznie standardowy preset zachowuje dotychczasową ścieżkę potwierdzenia.

**Odbiór Given/When/Then:** mając szkic lokalu, po dodaniu własnej cechy i zatwierdzeniu kroku, odświeżenie zachowuje jej nazwę/parametry, a poprzednie WR jest unieważnione. Dotyczy obu rodzajów prawa.

### Zadanie 3 — wybór skali i bezpieczny podgląd

**Pliki:** `step-features.tsx`, `domain/feature-rules.ts`, `domain/feature-presets.ts`, `lib/assign-provenance.ts`, `domain/valuation.ts`, `domain/provenance.ts`; sprawdzić preflight w `app/actions/approve-valuation.ts` oraz `preview-operat.ts`; testy `rtl-features-section`, `wizard-domain`, `f4-approval-gate`, `approve-valuation-action`.

**Interfejsy:** `allowedRatings(feature)`/odpowiednik oraz wspólny wynik walidacji. Nowe komunikaty domenowe mapowane do polskich błędów akcji. Skala jest przenoszona w każdym mapowaniu i wpływa na rozpoznanie edycji presetu.

- [ ] RED: 3→2 przy przeciętnej usuwa wybór i blokuje zapis; przy lepszej zachowuje wybór. 2→3 nie resetuje istniejącego końca.
- [ ] RED: ukrycie opisu nie definiuje skali; niewidoczna przeciętna nie może dotrzeć jako poprawne wejście akcji/kalkulacji/zatwierdzenia.
- [ ] RED: suma 130% lub niekompletna własna cecha usuwa ΣUi/WR z obu miejsc podglądu; poprawa pól przywraca wartości.
- [ ] GREEN: selektor skali, obsługa definicji, czytelny pusty stan oceny i błędy; reguły kalkulacji/zatwierdzenia uruchomione także poza UI, przed tworzeniem dokumentu.
- [ ] Potwierdzić brak zmiany wyników KCS dla tych samych wag i wybranych końców; pełna walidacja nie może zależeć od obecności nowego pola w starych danych.
- [ ] Nie blokować samego odczytu podpisanego operatu nowymi wymaganiami formularza.

**Odbiór Given/When/Then:** mając cechę przeciętną, po zmianie na dwa stopnie trzeba wybrać koniec; podgląd wraca dopiero po poprawnym wyborze i wagach. Ominięcie UI nie omija tej zasady.

### Zadanie 4 — zgodny operat, proza i historia

**Pliki:** `domain/document-model.ts`, `app/valuations/[id]/cards.tsx`, ewentualnie widok kalkulacji; `templates/operat-szablon.docx`; generator w wiki `tools/spike/2026-07-15-template-koscielna/build_template.py`; testy `document-model-skala`, `f12-template-integrity`, `f12-document-sections`, `f12-document-masking`, `golden-wr`, `golden-coop-piastowskie`, `prose-section-facts`, `prose-staleness-flow`.

**Interfejsy:** pola modelu dla rzeczywistej sumy wag, komórki środkowej SUMA i warunkowej noty o skali 2. Oceny/nazwy dla prozy pozostają w obecnym formacie, bez nowego API workera.

- [ ] RED: własna nazwa i jej opisy w DOCX; dwa poziomy w tabeli definicji; kreska w środkowej komórce cechy 2 i SUMA przy mieszanej skali; brak noty/kreski dla starego zestawu 3.
- [ ] RED: 10,25% nie drukuje się jako 10%; rzeczywista suma nie jest zastępowana stałym 100; cecha zerowa nie pojawia się w tabelach ani prozie.
- [ ] RED: znak `&`, cudzysłowy i polskie znaki w nazwie nie psują dokumentu. Duplikaty nazw nie gubią danych w mapie prozy, bo zapis ich nie dopuszcza.
- [ ] GREEN: mapowania i minimalna, powtarzalna modyfikacja szablonu. Nie regenerować ze starego bazowego operatu z pominięciem późniejszych poprawek spółdzielczych, ulic i zdjęć; ustalić aktualny łańcuch generatora/skryptów i zachować go.
- [ ] Wyrenderować przykłady: same skale 3, mieszane 2/3, własna cecha 2 z procentami ułamkowymi; co najmniej po jednym dla obu praw. Obejrzeć DOCX i PDF, w tym zawijanie długiej nazwy.
- [ ] Dla historycznego poprawnego snapshotu porównać wynik obliczeń i semantyczną zawartość dokumentu przed/po; nie żądać identycznego ZIP-a, jeśli zmieniają się wyłącznie metadane opakowania.
- [ ] Sprawdzić zmianę aktualności prozy po nazwie/ocenie i niezmienione hashe dla nietkniętego starego snapshotu. Nie dodawać globalnie nowych pól do hashy.

**Odbiór:** dokument odzwierciedla wybrane oceny i procenty; golden Kościelna 1 044 400 zł i Piastowskie 446 900 zł pozostają niezmienione; zachowane szablonowe rozróżnienie praw.

### Zadanie 5 — trwałe E2E, Pomoc i przygotowanie wydania

**Pliki:** nowy `apps/web/e2e/cechy.spec.ts`, `apps/web/playwright.config.ts`, `apps/web/package.json` tylko jeśli wymaga dołączenia projektu testowego; `src/content/pomoc/jak-korzystac/krok-4-cechy.mdx` i odpowiednie strony metodyczne; wiki analiza, log, timeline i roadmap dopiero zgodnie z faktycznym stanem realizacji.

- [ ] Dodać trwały test E2E do zwykłego przebiegu CI — plik spoza obecnych `testMatch` sam się nie uruchomi. Projekt `cechy` może współdzielić setup uwierzytelnienia, ale używa własnych syntetycznych szkiców i danych.
- [ ] Dwa warianty: odrębna własność oraz prawo spółdzielcze. Dodaj własną cechę → skala 2 → wagi do 100% → zapisz → odśwież → kalkulacja → dokument. Sprawdzić nazwę, skalę i procent w faktycznie wygenerowanym pliku.
- [ ] Scenariusze negatywne: błędna suma nie zapisuje i nie pokazuje WR; 3→2 wymaga oceny; powtórzona nazwa jest blokowana; kolejna własna cecha niedostępna; usunięcie cechy ją udostępnia.
- [ ] Nie używać istniejącego szkicu Zenona do zapisujących E2E. Przegląd UI może z niego korzystać tylko bez zapisu.
- [ ] Porównać wygląd kroku 4 z obecną makietą i zanotować uzasadnione nowe kontrolki; sprawdzić klawiaturę i węższy ekran. Pokazać przykład mieszanej tabeli operatu przed publikacją.
- [ ] Zaktualizować Pomoc tak, żeby nie opisywała zamkniętej puli i zawsze trzech ocen jako nadal obowiązujących.
- [ ] Kontrole końcowe: formatowanie, lint, typy, testy, build, zależności, istniejące fitness functions i nowe E2E. Brak zmiany źródeł raw i brak sekretów w artefaktach.

**Odbiór:** oba pełne przepływy przechodzą na izolowanych danych; test działa w CI, użytkownik ma zgodny ekran i dokumentację, plan nie pozostawia „E2E tylko w tymczasowym skrypcie”.

## 5. Weryfikacja i warunki rozpoczęcia

W planowaniu wykorzystano wcześniejszy wynik **156/156 testów w 8 plikach** na `9b2903c` i sprawdzenie UI jako Zenon. To punkt wyjścia, nie dowód gotowości przyszłych zmian. W tym etapie nie uruchamiano implementacji ani nowych testów zachowania, którego jeszcze nie ma.

Testy jednostkowe uruchamiać selektywnie: `pnpm --filter web exec vitest run <pliki>`. Końcowe kontrole zgodnie z aktualnym CI: `pnpm format:check`, `pnpm turbo lint typecheck test build --env-mode=loose`, `pnpm depcruise`; testy bazodanowe i E2E tylko na jawnie wskazanej lokalnej bazie testowej. Obecne `.env` web wskazuje port 5432, podczas gdy uruchomiona baza Wyceny używa 5433 — nie polegać bez sprawdzenia na domyślnej konfiguracji.

Rozpoczęcie wymaga akceptacji tego planu; prośba użytkownika w tej sesji dotyczyła jego przygotowania. Nie potrzebujemy wcześniej odpowiedzi o wagach domów/działek. Szczegóły UI i przykład tabeli z §2.4 są konkretną propozycją do przeglądu, a nie cytatem z maila Anety.

Wykonanie na osobnej gałęzi app-repo; równoległe zmiany wiki ograniczyć do generatora i dokumentacji związanej z tym zakresem. Commity, publikację i realizację prowadzić według uzgodnień bieżącej sesji oraz lokalnego `build-slice`; nic nie jest automatycznie zlecane przez zapis tego planu.
