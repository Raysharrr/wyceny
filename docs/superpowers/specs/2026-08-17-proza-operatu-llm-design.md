# Proza operatu z LLM — design slice'a (FR-6 przyspieszone)

Status: DRAFT po spike'u · Decyzja: wiki [[decisions/ADR-014-proza-operatu-llm]] · Spike: wiki-repo `tools/spike/2026-08-17-proza-operatu/`

## Sekcja produktowa

Operat, który dziś generuje aplikacja, ma perfekcyjne liczby i tabele, ale jego sekcje
opisowe są zaszytą prozą jednego konkretnego operatu (Kościelnej) albo uczciwymi stubami
(„zostanie uzupełnione po oględzinach"). Rzeczoznawca dostaje więc dokument, w którym
analiza rynku potrafi twierdzić, że badano lokale 50–90 m², podczas gdy tabela obok
zawiera transakcję 109 m² — i musi te fragmenty przepisywać ręcznie w Wordzie, tak jak
przed powstaniem aplikacji.

Po tym slice'ie sekcje opisowe będą powstawać z danych TEGO operatu: model językowy
(ten sam, który czyta akty notarialne) dostaje komplet faktów wyceny — przedmiot z EGiB,
realną próbę z jej pasmem powierzchni i cen, notatkę z oględzin — oraz prompt-drogowskaz
ze wzorcami stylu z prawdziwych operatów kancelarii, i proponuje treść sekcji. Propozycja
nigdy nie trafia do operatu sama: pojawia się na kroku 6 („Opisy" — dziś placeholder)
jako tekst DO WERYFIKACJI, który rzeczoznawca edytuje i zatwierdza jak każdą inną daną
z automatu. Bez zatwierdzonych opisów brama nie wypuści operatu. Użytkownik nie widzi
promptów — widzi dobrze napisane, osadzone w faktach akapity po polsku. Edycja samych
promptów przez użytkownika (pełne FR-6) dojdzie później jako ekran ustawień; ten slice
zaszywa prompty w systemie jako wersjonowane pliki.

## Wynik spike'a (2026-08-17)

Leave-one-out na 5 realnych operatach (Kościelna, Olga Sławska-Lipczyńska, Meissnera,
Starołęcka, Wojska Polskiego) × 3 sekcje, `claude-sonnet-5`, kryteria ustalone przed
uruchomieniem (`KRYTERIA.md`): K1 zero liczb spoza wejścia, K2 kompletność ≥90%,
K3 długość 0,5–2× wzorca, K4 polszczyzna bez dyskwalifikacji.
Wynik: patrz `tools/spike/2026-08-17-proza-operatu/RAPORT.md` (wiki-repo).

## Miejsca podmiany per operat (inwentarz — dziś statyczne/stub w `templates/operat-szablon.docx`)

| #   | Sekcja operatu                                                 | Dziś                                                                             | Docelowo                                                                                 |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | 11. Analiza i charakterystyka rynku                            | statyczna proza Kościelnej („od 50 do 90 m²", „po 2000 r.", odrzucenia „<60 m²") | LLM z: próba (n, pasmo pow., zakres dat, Cmin/Cśr/Cmax), obszar (obręb/dzielnica z EGiB) |
| 2   | 8.x Charakterystyka bezpośredniego otoczenia                   | stub                                                                             | LLM z: notatka z oględzin (+ w przyszłości zdjęcia „otoczenie" — vision)                 |
| 3   | 8.x Opis zagospodarowania terenu                               | stub                                                                             | LLM z: EGiB (działka, budynek) + notatka                                                 |
| 4   | 8.x / wyciąg: układ funkcjonalny i opis lokalu                 | stub / generyczne zdanie                                                         | LLM z: notatka (układ pomieszczeń), pow. użytkowa, nr lokalu                             |
| 5   | 8.x Opis standardu wykończenia                                 | brak                                                                             | LLM z: notatka + oceny cech (+ w przyszłości zdjęcia „wnętrza")                          |
| 6   | 13. Uzasadnienie wyniku — zdanie o pozycji wyniku na tle próby | brak                                                                             | LLM/szablonowe z: cena jedn. vs Cmin/Cśr/Cmax                                            |

Zasada twarda: **zero nowych hardcode'ów** — z szablonu znikają także pozostałe literały
Kościelnej w tych sekcjach (audyt szablonu = task 0 slice'a).

## Architektura

- **Generacja w workerze** (`POST /prose-proposal`) — jedyny punkt styku z Anthropic
  (wzorzec `/kw-extract`, ADR-009). Wejście: JSON faktów wyceny (bez PII zbędnych),
  wyjście: `{sekcja: tekst}` + model. **F-11 zachowane**: prompt nie dostaje WR i nie
  produkuje kwot wyniku; jedyne kwoty w prozie to ceny próby podane na wejściu.
- **Prompty jako wersjonowane pliki** w repo workera (`app/prompts/prose/*.md`):
  drogowskaz stylu + few-shot z realnych operatów (leave-one-out nie dotyczy produkcji —
  produkcyjny few-shot to stały, ręcznie wybrany komplet wzorców). Struktura plików od
  razu pod przyszłe FR-6 (edycja per biuro = nadpisanie plików wartościami z ustawień).
- **Krok 6 przestaje być placeholderem**: przycisk „Zaproponuj opisy" → propozycje w
  edytowalnych polach ze statusem `to_verify` i źródłem `ai` (rozszerzenie zamkniętego
  enumu źródeł w `@wyceny/shared`); edycja przez rzeczoznawcę → `confirmed` (rzeczoznawca).
- **Brama F-4**: niezatwierdzone opisy = blocker (jak próba/EGiB/cechy).
- **Write-once**: zatwierdzone teksty w `inputs.prose` (jsonb, zero DDL) — render
  approve↔sign ze snapshotu, determinizm zachowany mimo niedeterministycznego LLM.
- **Szablon**: nowe tagi `{proza_*}` w miejscach z inwentarza (etap w `build_template.py`,
  wiki-repo), **F-12** rozszerzone o nowe tagi + strażnik „zero starych literałów Kościelnej".
- **Kill-switch**: `NEXT_PUBLIC_PROSE=off` (wzorzec KW/foto) — krok 6 wraca do stubów,
  e2e offline nietknięte.

## Fitness functions

- **F-1..F-13 nietknięte**; golden 1 044 400 zł byte-identical (proza nie dotyka silnika).
- **Nowy test anty-halucynacyjny** (CI, bez API — na nagranych fixture'ach): ewaluator K1
  ze spike'a jako funkcja produkcyjna — każda liczba w tekście propozycji musi występować
  w wejściu; wywoływany też RUNTIME w workerze przed zwróceniem propozycji (odrzucenie
  = 502 z komunikatem „spróbuj ponownie").
- Test determinizmu: approve↔sign renderują ten sam tekst ze snapshotu (rozszerzenie
  istniejącego strażnika równości tekstu).

## Poza zakresem tego slice'a

- Edycja promptów w UI (pełne FR-6) — osobny slice po „Ustawieniach biura".
- Vision (zdjęcia jako wejście opisów) — dogrywka po slice'ie „AI-ocena cech ze zdjęć"
  (wspólna infrastruktura wejścia zdjęciowego).
- Sekcje 8.1/8.3 mapy-proza i pełna proza uzasadnienia — jeśli spike'owy wzorzec się
  utrzyma, dołożyć w tym samym wzorcu w kolejnej iteracji.

## Rozstrzygnięcia brainstormu (user, 2026-08-17)

1. **Auto-generacja przy wejściu na krok 6** (pierwsze wejście lub nieaktualne propozycje po
   zmianie danych) + przycisk „Wygeneruj ponownie"; stan ładowania na kroku.
2. **Bez limitu generacji**; każda generacja logowana w audycie z licznikiem tokenów/kosztu
   (koszty raportowane userowi; szacunek: ~0,3–0,4 zł za komplet 6 sekcji, sonnet-5).
3. **Nowe źródło `ai`** w zamkniętym enumie `Sourced` (@wyceny/shared) — reużyje je także
   slice „AI-ocena cech ze zdjęć".
4. **Stała adnotacja** przy propozycjach („Propozycja wygenerowana automatycznie — za treść
   operatu odpowiada rzeczoznawca") + akapit w Pomocy; bez dodatkowych checkboxów.

## Uwaga F-9 (repo publiczne!)

Produkcyjny few-shot NIE może zawierać fragmentów realnych operatów (adresy, ceny, dane
nieruchomości = F-9 zakazuje w VCS). Wzorce few-shot do repo = **syntetyczne przykłady
w stylu kancelarii** (fikcyjny adres/liczby, zredagowane na bazie stylu — nie kopie).
Spike z realnymi fragmentami żyje wyłącznie w prywatnym wiki-repo.
