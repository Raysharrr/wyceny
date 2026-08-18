# Potwierdzasz to, co widzisz — design slice'a

Status: DRAFT po brainstormingu (2026-08-18) · Gałąź: `feat/confirm-what-you-see`
Spike: wiki-repo `tools/spike/2026-08-18-odcisk-per-sekcja/` (PASS)
Poprzedni slice: `2026-08-17-proza-operatu-llm-design.md` · Decyzja: wiki ADR-014

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś rzeczoznawca kończy wycenę na ekranie, który pokazuje trzy liczby — powierzchnię,
wartość rynkową i kwotę słownie, przy czym ta ostatnia w chwili decyzji jest zawsze
kreską — i każe mu jednym kliknięciem potwierdzić dwanaście transakcji, dane
ewidencyjne, dane z księgi wieczystej i wagi cech. Żadnej z tych rzeczy na tym ekranie
nie widać. Podpisuje też operat, którego nie czytał: PDF powstaje dopiero **po**
zatwierdzeniu.

Po tym slice'ie potwierdzanie wraca tam, gdzie są dane. Każdy krok kreatora kończy się
jednym świadomym aktem — „Zatwierdź próbę i dalej" naprawdę potwierdza próbę, patrząc na
nią. Wrócić można w każdej chwili, a poprawka zdejmuje potwierdzenie **dokładnie z tego,
co się zmieniło**: poprawiona cena w jednej transakcji nie unieważnia jedenastu
pozostałych ani opisu otoczenia.

Krok 7 przestaje być ekranem trzech liczb i staje się tym, czym się nazywa — podglądem
operatu. Rzeczoznawca czyta **prawdziwy dokument**, ten sam, który za chwilę zostanie
wydany, z mapami w środku. Tam, gdzie brakuje opisu, widzi wyraźną zaślepkę z nazwą
sekcji i powodem — bo zadaniem podglądu jest ujawnić niekompletność, a nie ją ukryć.
Dopiero pod przeczytanym dokumentem stoi jedyny nieodwracalny przycisk w całym
przepływie: **„Zatwierdź i generuj operat"**.

Pod maską dochodzi trzecia rzecz, niewidoczna, ale to ona pozwala na resztę: proza
przestaje być unieważniana hurtem. Każda z sześciu sekcji pamięta, z jakich faktów
powstała, więc zmiana ceny transakcji regeneruje dwie sekcje zamiast sześciu — o połowę
taniej — a cztery zatwierdzone teksty zostają zatwierdzone.

## Wynik (DoD)

1. Potwierdzanie prowenancji odbywa się **wyłącznie na krokach**, przy widocznych danych.
   Krok 7 nie ma ani jednego przycisku potwierdzania.
2. Edycja po potwierdzeniu zdejmuje `confirmed` **punktowo** — z tej pozycji, nie z grupy.
3. Każda sekcja prozy niesie własny odcisk faktów; nieaktualna jest tylko ta, której
   dane realnie się zmieniły.
4. Krok 7 renderuje **prawdziwy operat** (ta sama ścieżka co wydanie) z mapami; zaślepki
   pokazują braki i nigdy nie trafiają do wydanego pliku.
5. Mapy pobierane raz przy pierwszym podglądzie i zamrażane; wydanie nie sięga do
   Geoportalu.
6. Golden F-1, F-9, F-10, F-11, F-12 nietknięte; smoke e2e zaktualizowany i zielony.

## Rozstrzygnięcia usera (2026-08-18, nie renegocjować)

| #   | decyzja                                                                            |
| --- | ---------------------------------------------------------------------------------- |
| 1   | Jeden spec na całość; podział na etapy dopiero w planie wdrożenia                  |
| 2   | Potwierdzanie **scalone** z przejściem dalej (wariant A), nie osobny przycisk      |
| 3   | Unieważnianie **punktowe** (wariant A), potwierdzanie pozostaje grupowe            |
| 4   | Podgląd = **prawdziwy render**, nie symulacja CSS                                  |
| 5   | Mapy pobierane i zamrażane **przy pierwszym podglądzie**                           |
| 6   | Czytnik: `#toolbar=0&navpanes=0`, pełna szerokość kolumny treści                   |
| 7   | Render startuje **automatycznie dopiero bez blokerów**; przy brakach — przyciskiem |
| 8   | Nazwa aktu: **„Zatwierdź i generuj operat"**                                       |
| 9   | Bez znaku wodnego; „operat niewydany" odrzucone jako sformułowanie                 |

## Architektura

### A. Odcisk per sekcja

Odcisk przenosi się z migawki na **wpis sekcji**, bo jest własnością tekstu:

```ts
sections: Partial<
  Record<
    ProseSection,
    {
      value: string;
      provenance: Provenance;
      factsHash: string; // odcisk podzbioru faktów, z którego ten tekst powstał
    }
  >
>;
```

Mapa zależności `PROSE_SECTION_FACTS` w `domain/prose.ts`, wyprowadzona z bloków
`### DANE` produkcyjnych promptów:

| sekcja             | podzbiór faktów                                                                                                              | transakcje w odcisku |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `analiza_rynku`    | `adres`, `obreb`, `pow_uzytkowa`, `rynek`, `proba`                                                                           | tak (trend)          |
| `uzasadnienie`     | `pozycja_wyniku`, ceny z `proba`                                                                                             | tak (trend)          |
| `zagospodarowanie` | `nr_dzialki`, `obreb`, `pow_dzialki_m2`, `uzytek`, `budynek_rodzaj`, `kondygnacje`, `rok_budowy`, `notatka_zagospodarowanie` | nie                  |
| `standard`         | `notatka_standard`, `oceny_cech`                                                                                             | nie                  |
| `opis_lokalu`      | `pow_uzytkowa`, `notatka_uklad`                                                                                              | nie                  |
| `otoczenie`        | `notatka_otoczenie`                                                                                                          | nie                  |

**Prompt zostaje nietknięty** — każda sekcja dalej dostaje pełny słownik faktów.
Zmienia się wyłącznie to, z czego liczymy odcisk. Dzięki temu walidacja empiryczna
promptów (18 generacji, K1–K4) pozostaje ważna.

**Migracja:** brak odcisku per sekcja czytamy jako „nieaktualne" → jedna regeneracja
na istniejący szkic przy pierwszym wejściu na krok 6.

### B. Potwierdzanie na krokach

| krok         | przycisk                       | co robi po zmianie                                                 |
| ------------ | ------------------------------ | ------------------------------------------------------------------ |
| 1 Przedmiot  | „Dane się zgadzają — dalej"    | zapis + potwierdzenie EGiB/MPZP, danych KW/aktu i **geokodowania** |
| 2 Oględziny  | „Dalej"                        | bez zmian (notatka i zdjęcia poza bramą)                           |
| 3 Próba      | „Zatwierdź próbę i dalej"      | zapis + potwierdzenie transakcji z RCN                             |
| 4 Cechy      | „Zatwierdź cechy i dalej"      | zapis + potwierdzenie cech, wag i definicji skali                  |
| 5 Kalkulacja | „Zatwierdź kalkulację i dalej" | bez zmian                                                          |
| 6 Opisy      | „Zatwierdź opisy i dalej"      | bez zmian — **wzorzec dla reszty**                                 |
| 7 Operat     | „Zatwierdź i generuj operat"   | tylko stan i wydanie                                               |

Potwierdzenie **geokodowania** przenosi się z przycisku próby (gdzie jest dziś,
`confirmSampleProvenance`) na krok 1, bo geokodowanie jest własnością adresu.

**Kaskada** wykonywana w funkcjach `apply*` przy zapisie:

| edycja po potwierdzeniu | prowenancja      | kalkulacja                | proza                                                      |
| ----------------------- | ---------------- | ------------------------- | ---------------------------------------------------------- |
| jedna transakcja        | tylko ten wiersz | `wr: null` _(już działa)_ | `analiza_rynku`, `uzasadnienie`                            |
| dane EGiB/MPZP          | przedmiot        | `wr: null` _(już działa)_ | `zagospodarowanie`, `analiza_rynku`                        |
| ocena lub waga cechy    | cechy            | `wr: null` _(już działa)_ | `standard`, `uzasadnienie`                                 |
| notatka z oględzin      | —                | —                         | `opis_lokalu`, `otoczenie`, `standard`, `zagospodarowanie` |
| klient, cel, numer KW   | —                | —                         | —                                                          |

Krok 7 raportuje stan z **odnośnikiem do kroku**, w którym dana mieszka.

### C. Krok 7 — podgląd i wydanie

Trzy stany: **braki** (lista + „Pokaż podgląd mimo braków", wydanie nieaktywne),
**gotowe** (render automatyczny + „Zatwierdź i generuj operat"), **wydany** (jak dziś).

Podgląd: `buildDocumentModel` → `renderOperatDocx` → `/convert-to-pdf` → iframe
`#toolbar=0&navpanes=0`, pełna szerokość, ~85vh.

**Podgląd różni się od wydanego operatu dokładnie dwiema rzeczami:**

1. datą sporządzenia (podgląd — bieżąca, wydanie — data wydania; dlatego wydanie
   renderuje na nowo i dlatego w nazwie przycisku jest „generuj"),
2. zaślepkami brakujących sekcji.

Ścieżka „Zatwierdź bez map" przenosi się z wydania na podgląd.

## Dowody empiryczne (zmierzone 2026-08-18 na stagingu)

| pomiar                                       | wynik                                        |
| -------------------------------------------- | -------------------------------------------- |
| konwersja DOCX→PDF (operat 16 stron, 1,1 MB) | **1,2–1,4 s** (3 przebiegi)                  |
| pobranie map z Geoportalu                    | 3–6 s                                        |
| koszt generacji kompletu 6 sekcji            | **0,251 zł** (14 581 tok. wej. + 1 271 wyj.) |
| najdroższa sekcja `analiza_rynku`            | 0,079 zł · 6,7 s                             |
| najtańsza sekcja `opis_lokalu`               | 0,029 zł · 2,9 s                             |
| oszczędność: zmiana ceny transakcji          | 0,251 → **0,125 zł** (50%)                   |
| oszczędność: zmiana notatki                  | 0,251 → **0,127 zł** (49%)                   |
| oszczędność: zmiana oceny cechy              | 0,251 → **0,076 zł** (70%)                   |

**Czytnik PDF w iframe** (ten sam operat, cztery warianty):

| wariant                            | panel miniatur | zoom | czytelność            |
| ---------------------------------- | -------------- | ---- | --------------------- |
| dzisiejsze osadzenie (62% kolumny) | jest           | 46%  | nieczytelne           |
| `view=FitH`, pełna szerokość       | znika          | 299% | sam nagłówek          |
| `navpanes=0`, pełna szerokość      | znika          | 100% | **czytelne**          |
| `toolbar=0&navpanes=0`             | znika          | 100% | **czytelne, szersze** |

**Spike odcisku per sekcja** (`tools/spike/2026-08-18-odcisk-per-sekcja/`), kryteria
ustalone przed uruchomieniem, 3 przebiegi × 6 sekcji:

- **K1 (poprawność, blokujące): PASS** — zero użyć faktu spoza podzbioru. Odcisk per
  sekcja nie przegapi nieaktualności.
- **K2 (szczelność, informacyjne):** `analiza_rynku` nie użyła `adres` ani
  `pow_uzytkowa`; `zagospodarowanie` nie użyło `budynek_rodzaj`, `kondygnacje`,
  `rok_budowy`. Mapy **nie zawężamy**: trzy przebiegi to za mało na „nigdy", a nadmiar
  kosztuje grosze, podczas gdy niedomiar kosztuje nieaktualny operat.

Uwaga metodyczna: pierwszy przebieg spike'a zgłosił FAIL na `kondygnacje` w dwóch
sekcjach. Przyczyną był **detektor**, nie projekt — wzorzec `\b7\b` trafiał w siódemkę
wewnątrz ceny „7 431,00", a słowo „kondygnacj" nie padło ani razu. Wynik poprawiono
przeliczając te same 18 tekstów właściwym wzorcem.

## Fitness functions

**Nietknięte:** golden F-1, F-9, F-10 (`depcruise`), F-11, F-12.

**Nowe:**

1. **Mapa zależności ↔ prompty** — test czyta `### DANE` z
   `apps/worker/app/prompts/prose/*.md` i asertuje zgodność z `PROSE_SECTION_FACTS`.
2. **Kaskada dokładnie i wyłącznie** — dla każdej edycji z tabeli B: co się unieważnia
   **i co się NIE unieważnia** (asercja negatywna niesie tu główną wartość).
3. **Podgląd nie generuje prozy** — ścieżka renderu kroku 7 nie woła modelu.
4. **Zaślepki nie wyciekają** — wydany operat nie zawiera ani jednej.
5. **Mapy pobierane raz** — wydanie po podglądzie nie sięga do Geoportalu.

Każdy nowy strażnik weryfikowany mutacyjnie.

`apps/web/e2e/smoke.spec.ts` klika dziś `confirm-features-button` na kroku 7 — przycisk
znika, więc smoke wymaga aktualizacji.

## Poza zakresem

- **wysyłanie podzbioru faktów do modelu** — zmieniłoby blok `DANE` i unieważniło
  walidację promptów; spike dowiódł, że nie jest potrzebne
- **znak wodny „WERSJA ROBOCZA"** — opcja, gdyby wyciek wersji roboczej okazał się realny
- **przyciski potwierdzania przy każdym wierszu próby**
- **defekty z audytu Pomocy**: baner „Pobrano 5000 transakcji", `dataDokumentu` bez pola
  do edycji, baner „Pobrano: EGiB, MPZP" przy braku planu, niezapisywana
  `amountInWords`, brak śladu w audycie po nieudanej generacji — osobny wątek
- **sekcja „wartość dla wymuszonej sprzedaży"**, obecna w operatach wzorcowych

## Ryzyka i znane ograniczenia

1. **Model widzi całość, odcisk pokrywa podzbiór.** Spike zdał (K1 PASS), ale to dowód
   empiryczny z 18 generacji, nie gwarancja konstrukcyjna. Twarda gwarancja wymagałaby
   wysyłania podzbiorów i powtórnej walidacji promptów.
2. **Nie da się już przejść kreatora „na próbę".** Każde wyjście z kroku dalej jest
   świadomym potwierdzeniem. To cel, ale zmienia rytm pracy.
3. **Mapy zamrażają się wcześniej** niż dziś (podgląd zamiast wydania) — zmiana wobec
   decyzji ze Slice'u 9. Zamrożenie **musi** trzymać adres, z którego powstało: mapy są
   pochodną adresu (geokoder → działka → bbox → WMS), więc podgląd, poprawka adresu
   i wydanie bez rozmrożenia dałyby w podpisanym operacie mapę **poprzedniej działki**.
4. **Podgląd bez paska narzędzi** traci wyszukiwanie w treści i licznik stron;
   przewijanie działa.
5. **Jedna regeneracja na istniejący szkic** przy migracji odcisków.
