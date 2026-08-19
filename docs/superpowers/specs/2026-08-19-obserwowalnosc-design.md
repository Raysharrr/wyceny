# Obserwowalność: strukturalne logi, traceId, dziennik zdarzeń — design slice'a

Status: DRAFT po brainstormie (2026-08-19) · Zamyka: otwarty punkt ADR-009 (trace-id web↔worker) · Poprzedza: metrykę „% pól as proposed" z NEXT roadmapy

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś, gdy rzeczoznawca mówi „coś nie poszło", nie ma czym tego sprawdzić. Aplikacja
prowadzi wzorowy dziennik prawny (`audit_log`: kto, co, kiedy zatwierdził — append-only,
pilnowany triggerem), ale ten dziennik z założenia zapisuje **wyłącznie sukcesy**: wpis
powstaje w tej samej transakcji co zmiana, więc nieudana próba nie zostawia po sobie nic.
Porażki lądują w 21 gołych `console.error`, bez numeru wyceny, bez użytkownika, bez
powiązania — a użytkownik widzi ostrożnie ogólne zdanie („Nie udało się potwierdzić próby
— spróbuj ponownie"). Zdanie po stronie użytkownika i wpis po stronie serwera nic nie łączy.
Do tego połowa pracy dzieje się w workerze, na osobnym hostingu, bez wspólnego identyfikatora
żądania — więc „proza się nie wygenerowała" wymaga ręcznego zestawiania znaczników czasu
między Vercelem a Railway.

Po tym slice'ie każde zdarzenie w aplikacji ma **ośmioznakowy kod**, który przechodzi przez
cały system — od kliknięcia, przez wywołanie workera, po zewnętrzne API — i który przy błędzie
pokazuje się użytkownikowi („kod: a3f1c2d9"). Rzeczoznawca podaje ten kod przez telefon,
a `pnpm trace a3f1c2d9` odtwarza cały przebieg: co robił, co odpowiedział worker, gdzie
i dlaczego pękło. Ślady istotne diagnostycznie przeżywają tydzień i więcej, bo lądują
w bazie, a nie tylko w ulotnych logach hostingu.

Slice nie zmienia niczego, co użytkownik widzi w normalnej pracy — poza kodem błędu
w komunikacie. Nie liczy też jeszcze metryk produktowych; zbiera pod nie dane, bo
części z nich (jak wyglądała propozycja AI, zanim rzeczoznawca ją poprawił) nie da się
odtworzyć wstecz.

**Pod maską:** każde żądanie dostaje ośmioznakowy identyfikator trzymany w kontekście
asynchronicznym (`AsyncLocalStorage` w web, `contextvars` w workerze), więc równoległe
żądania nie mieszają sobie śladów; jedzie on nagłówkiem `X-Request-Id` do workera, dzięki
czemu logi z dwóch osobnych hostingów dają się zestawić. Logi lecą jako JSON na standardowe
wyjście (pino w web, structlog w workerze), a to, co ma przeżyć tydzień, ląduje dodatkowo
w nowej tabeli `event_log` — świadomie osobnej od `audit_log`, który zostaje czystym
dziennikiem prawnym. Wpisy przechodzą przez allowlistę pól, więc dane osobowe nie mogą
do nich trafić przez przeoczenie, a propozycje AI zapisujemy jako skróty, nie treść.

## Wynik spike'a (2026-08-19) — PASS z jedną poprawką designu

Zweryfikowane empirycznie na **produkcyjnym buildzie** (`next build` + `next start`,
worker z worktree na porcie 8001):

| Kryterium                      | Wynik                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| build bez ostrzeżeń bundlera   | **PASS** — `serverExternalPackages` okazało się niepotrzebne         |
| JSON z pino na wyjściu         | **PASS** — `{"level":30,"event":"spike.start","traceId":"7181afe4"}` |
| ten sam traceId w logu workera | **PASS** — `SPIKE health x-request-id=7181afe4`                      |

ALS przeżył `await` oraz zagnieżdżone wywołanie, któremu identyfikatora nigdy nie podano —
czyli założenie, na którym stoi rezygnacja z przepychania traceId przez pięć interfejsów
portów, jest potwierdzone.

**Znalezisko zmieniające design:** domyślne pino loguje **asynchronicznie**, a jego własna
dokumentacja (`docs/asynchronous.md`) ostrzega, że na AWS Lambda kończy się to opóźnionymi
albo **zgubionymi** wpisami, bo runtime zamarza, zanim bufor trafi na wyjście. Funkcje
Vercela to Lambda, a moment zamarznięcia wypada tuż po odpowiedzi — czyli dokładnie po
zalogowaniu porażki. Nieskorygowane, gubiłoby to logi, dla których ten slice powstaje.
**Logger musi używać `pino.destination({ sync: true })`** (Task 1). Lokalny test tego nie
pokazuje — proces nie zamarza.

**Odstępstwo od zarejestrowanego kryterium:** kryterium 2 brzmiało „wpis widoczny w logach
**Vercela**". Wdrożenie preview z worktree nie doszło do skutku (link `.vercel` nie
przenosi się między katalogami), więc potwierdzenie jest z produkcyjnego builda lokalnie,
nie z Vercela. Ryzyko rezydualne (przechwytywanie stdout przez Vercel) jest znane i
adresowane przez `sync: true`; domknięcie następuje przy pierwszym realnym wdrożeniu
slice'a — Task 10, krok 5. Kryterium 3 celowo nie było odtwarzane na stagingu: wymagałoby
wypchnięcia jednorazowego echa na współdzielony serwis `worker-v2`, a przekazanie nagłówka
HTTP nie zależy od hostingu.

## Przegląd bramki RODO (2026-08-19) — co sprawdzono i co z tego wynika

Przegląd adwersaryjny pytania „czy dane osobowe mogą trafić do logów albo do `event_log`".
Niezależny recenzent na Opus 5 **nie dostarczył raportu** (dwa kolejne uruchomienia zawisły
i zostały zatrzymane) — poniższe jest wynikiem przeglądu prowadzącego, wsparte weryfikacją
runtime na działającej aplikacji. Zasięg zapewnienia jest więc węższy, niż zakładał plan,
i warto przed merge puścić `/code-review`.

**Znalezione i naprawione (Critical, commit `10543d0`):** `errFields()` zwracał nieobcięte
`errMessage`/`errStack`, a limit 300/2000 znaków siedział wyłącznie w `pickAllowed` — przez
które przechodzi tylko ścieżka stdout. `recordFailure` kopiował surowe wartości do
`event_log.meta`, a `meta` jest `jsonb` i allowlisty nie przechodzi. Skutek: pełna treść
błędu i wielokilobajtowe stack trace'y lądowały w bazie, wbrew ograniczeniu zapisanemu
w tym samym dokumencie. Obcinanie przeniesione do `errFields`, czyli do źródła; `pickAllowed`
nadal obcina jako druga warstwa.

**Sprawdzone i czyste:**

| Ścieżka                | Ustalenie                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Klucze `fingerprint()` | Wszystkie trzy zestawy to zamknięte, generyczne literały: `parcel`/`building`/`mpzp`, sześć nazw sekcji prozy (`analiza_rynku`, `opis_lokalu`, …), oraz `tx0…txN` po pozycji. Żaden nie niesie `transactionId` ani adresu. |
| `detail` z workera     | Wszystkie stałe. Jedyny składany dynamicznie (`Za mało transakcji w okolicy (znaleziono N)`) wstawia liczbę, nie adres.                                                                                                    |
| Komunikaty adapterów   | `worker /X responded <status> <statusText>` — adres jedzie w ciele POST-a, nie w URL-u, więc nie ma go w komunikacie błędu.                                                                                                |
| Logi workera           | Zdarzenia + `section`, `violations`, `err=str(exc)`. `violations` niesie wyłącznie liczby dopasowane regexem (`_NUM_RE`), bez otaczającego tekstu — logujemy „model wymyślił 2019", nie fragment prozy.                    |
| Sonda empiryczna       | Po pełnym przebiegu przez UI: adres wyceny w logach web **0 trafień**, w logach workera **0**, w `event_log.meta` **0 wierszy**.                                                                                           |

**Pozostałe ryzyko, świadomie przyjęte:** `err=str(exc)` w `kw_extraction_failed`
i `prose_section_failed` opakowuje wyjątki z wywołań LLM, których prompty zawierają dane
osobowe. Błędy SDK Anthropica niosą komunikat API, nie treść promptu, więc ryzyko jest
niskie — ale niezerowe i nieprzetestowane na żywym błędzie. Do przeglądu przy przejściu
na produkcję z danymi realnych klientów, razem z decyzją o `errMessage`.

## Zakres (co wchodzi)

1. **pino + wrapper z allowlistą** w web; reguła `no-console` w eslint poza modułem loggera.
2. **traceId przez `AsyncLocalStorage`**, widoczny użytkownikowi w komunikacie błędu jako
   „kod: a3f1c2d9".
3. **structlog + middleware `X-Request-Id`** w workerze; ruff `T201` na `print`.
4. **Migracja `event_log`** + port `PortEventLog` i adapter drizzle.
5. **Zapis trzech rodzajów zdarzeń** (błąd akcji, nieudane wywołanie workera, odcisk
   propozycji AI jako skróty pól) — podpięcie w 21 istniejących miejscach `console.error`
   oraz w trzech miejscach pobierania propozycji.
6. **Czytnik `pnpm trace <id>`** — skrypt konsolowy przyjmujący **albo** traceId, **albo**
   identyfikator wyceny; wypisuje oś czasu przebiegu (zdarzenia z `event_log` przeplecione
   z wierszami `audit_log` tej wyceny, rosnąco po czasie). Bez UI.
7. **F-13 „logi bez PII"** w CI.

## Architektura

**Dwa ujścia o różnych zadaniach.**

- **stdout, JSON** — wszystko: początek i koniec akcji, czas trwania, wywołania workera,
  błędy. Zero kosztu przy zapisie, retencja hostingu. Widok „co się dzieje teraz".
  Web: `pino`. Worker: `structlog`.
- **Postgres `event_log`** — wyłącznie to, co ma wartość po tygodniu. Widok „co się stało wtedy".

**Co trafia do `event_log` (lista zamknięta na starcie):**

| Zdarzenie                                   | Dlaczego przeżywa tydzień                     |
| ------------------------------------------- | --------------------------------------------- |
| błąd akcji użytkownika                      | dokładnie to, co dziś ginie w `console.error` |
| nieudane wywołanie workera                  | zewnętrzne API (GUGiK, GEOPOZ) i koszt LLM    |
| snapshot propozycji AI (RCN / EGiB / proza) | nieodtwarzalny wstecz — patrz niżej           |

**Tabela** — bliźniacza do `audit_log`, żeby nie wprowadzać drugiego wzorca:
`id bigserial, at, level, event, trace_id, actor_id, valuation_id, meta jsonb`.
Bez FK (ten sam powód co przy audycie: wiersze mają przeżyć operacje na danych).
**Bez triggera append-only** — to zapis operacyjny, nie dowodowy; kasowanie starych
wierszy jest funkcją, nie naruszeniem.

**Trzy rozstrzygnięcia, które łatwo zepsuć refaktorem:**

1. **`audit_log` zostaje nietknięty.** Zamknięty enum akcji, trigger, artefakt prawny
   (FR-12). Dokładanie tam błędów rozcieńcza jego wartość dowodową i wymusza rozszerzanie
   enumu przy każdym nowym typie zdarzenia.
2. **Zapis zdarzenia idzie POZA transakcją mutacji.** `audit_log` pisze _wewnątrz_
   transakcji, bo ma zniknąć razem z nieudaną zmianą. Z błędem jest odwrotnie: w tej samej
   transakcji rollback skasowałby zapis o własnej porażce. Osobny insert, po `catch`.
3. **Odcisk propozycji AI zapisujemy od razu, mimo że metryki nie budujemy — ale jako
   skróty, nie wartości.** Metrykę „% pól as proposed" (PRD §10) da się policzyć
   kiedykolwiek, ale wyłącznie z danych zebranych wcześniej: propozycja z RCN/EGiB ląduje
   w `inputs`, a gdy rzeczoznawca ją poprawi, wartość pierwotna znika bezpowrotnie
   (write-once dotyczy snapshotu, nie historii pola). Bez tego kroku slice zamyka drogę
   do tej metryki na zawsze.

   Zapisujemy jednak `{pole: sha256(wartość)}` plus liczniki, **nigdy tekst jawny**.
   Powód jest twardy: przechowywanie propozycji wprost oznaczałoby wpisanie do `event_log`
   działki i budynku z EGiB, transakcji porównawczych z RCN i zgeokodowanego adresu —
   czyli dokładnie tych danych, które F-12 maskuje do `RRRR-MM`, zanim trafią do dokumentu.
   Byłaby to obwodnica własnej allowlisty z sekcji niżej. Metryka tego nie potrzebuje:
   „przyjęte bez zmian vs nadpisane" to czyste porównanie równości, więc skrót propozycji
   zestawiony ze skrótem końcowej wartości z `inputs` odpowiada na nie w całości.

   `ponytail:` skróty odpowiadają „czy zmieniono", nie „o ile zmieniono". Gdyby kiedyś
   potrzebna była skala rozbieżności, to osobna decyzja — z osobnym uzasadnieniem RODO.

**traceId — jeden identyfikator na całe życie żądania.**

Osiem znaków hex (`crypto.randomUUID().slice(0, 8)`), bo ma być czytany przez człowieka na
głos. Przy kilku tysiącach zdarzeń tygodniowo kolizja jest nierealna, a jej jedynym skutkiem
byłyby dwa przebiegi w wyniku wyszukiwania. Rodzi się w server action → nagłówek
`X-Request-Id` do workera → wraca do użytkownika w komunikacie błędu.

Propagacja do adapterów przez **`AsyncLocalStorage`** (`node:async_hooks`, biblioteka
standardowa — brak konfliktu z bundlerem). Powód: jedna pętla zdarzeń obsługuje równoległe
żądania, więc traceId w zmiennej modułowej byłby nadpisywany między użytkownikami. Wariant
jawny (traceId jako parametr) wymagałby zmiany pięciu interfejsów portów i wszystkich
wywołań — duży diff w warstwie niezwiązanej z logowaniem. W workerze rolę tę pełni
`structlog.contextvars` (ten sam problem, to samo rozwiązanie, inny język).

**Warstwy (F-10).** Logger i zapis zdarzeń żyją w akcjach i adapterach, **nigdy w `domain/`**
— domena zostaje czysta (`kcs.ts` bez I/O). `event_log` dostaje port + adapter drizzle,
wzorcem `PortValuation`.

## Bramka RODO — allowlista, nie denylista

Wszystkie wpisy przechodzą przez jeden cienki wrapper nad pino, przyjmujący **zamknięty
zestaw kluczy**: `valuationId, actorId, traceId, event, ms, status, count, section, model,
errName, errMessage, errStack`. Adres nieruchomości, dane z księgi wieczystej, imiona,
treść prozy nie mają w tym zestawie miejsca, więc nie wyciekną przez zapomnienie.
Typ TypeScriptu pilnuje tego w kompilacji, `pick()` w locie jako druga warstwa.

Kierunek jest tu istotny. `redact` z pino działa **denylistą**: wyliczasz ścieżki do
zamaskowania, a jedna zapomniana ścieżka to wyciek. Allowlista odwraca kierunek błędu
na „brakujące pole w logu" — właściwy dla Security=H i RODO. Realizujemy ją własnym
serializerem wewnątrz pino, nie przez `redact`.

`errMessage` obcinamy do 300 znaków i **zostaje** — komunikat zewnętrznego API teoretycznie
może zacytować adres, który mu wysłaliśmy, ale na stagingu koszt pomyłki jest niski,
a wartość diagnostyczna wysoka. **Założenie do przeglądu przy przejściu na produkcję
z danymi realnych klientów.**

Bypass zamykamy lintem: eslintowa reguła `no-console` w `apps/web/src` z wyjątkiem modułu
loggera (goły `console.log` nie przejdzie CI), w workerze ruff `T201` na `print`.

## Fitness functions

- **F-13 „logi bez PII"** (nowa): test odrzucania nieznanych kluczy przez wrapper + reguła
  lintera. Dokłada się do F-9, która pilnuje tego samego, tylko w repo.
- F-1 (golden 1 044 400 zł), F-12 (szablon) i pozostałe — **nietknięte**; slice nie dotyka
  domeny ani szablonu.

## Testy

| Test                                            | Co pilnuje                                                   |
| ----------------------------------------------- | ------------------------------------------------------------ |
| wrapper odrzuca nieznany klucz                  | F-13, sedno bramki RODO                                      |
| traceId przeżywa `await`                        | ALS działa — inaczej ślady mieszają się między użytkownikami |
| wycofana transakcja **zostawia** wpis o błędzie | rozstrzygnięcie 2 z Architektury                             |
| worker wiąże `X-Request-Id` i zwraca go w logu  | korelacja web↔worker, dług z ADR-009                         |
| ścieżka błędu w UI pokazuje kod                 | to, co użytkownik odczytuje przez telefon                    |

## Task zerowy: spike bundlingowy pino

Pino pod Turbopackiem to jedyna niezwalidowana rzecz w tym slicie; odkrycie problemu
w połowie implementacji kosztuje dużo. Ryzyko edge runtime **zweryfikowane i odpadło**
(2026-08-19: `grep` po `apps/web/src` — zero `runtime = "edge"`, brak `middleware.ts`,
wszystko na Node runtime). Pino nie występuje na domyślnej liście `serverExternalPackages`
Next-a, więc może wymagać wpisu w `next.config.ts`.

Drugie, poważniejsze założenie tego designu to jednak **nie pino, tylko
`AsyncLocalStorage`**: że kontekst przeżywa łańcuch server action → adapter → `fetch`.
Twierdzę to, ale tego nie sprawdziłem. Gdyby nie przeżywał, wariantem zapasowym jest
przepchnięcie traceId przez pięć interfejsów portów — czyli dokładnie ten duży diff,
którego ALS miał uniknąć, odkryty po przerobieniu 21 miejsc wywołań. Dlatego spike
sprawdza oba ryzyka jednym wdrożeniem.

Zakres spike'a: najcieńsza server action, która loguje przez pino **i** wywołuje workera
z nagłówkiem `X-Request-Id` pobranym z ALS → `pnpm build` → deploy na staging (web
automatycznie, **worker ręcznie** — serwis `worker-v2` na Railway nie ma podpiętego `source`)
→ odczyt logów po obu stronach.

**Kryterium PASS ustalone przed uruchomieniem** (wszystkie trzy naraz): build przechodzi
bez ostrzeżeń bundlera; wpis pojawia się w logach Vercela jako JSON; **te same osiem znaków
traceId widać w linii logu workera**.
**FAIL → decyzja użytkownika:** `serverExternalPackages` jako obejście albo zejście na
własny cienki logger (~30 linii, ta sama allowlista, ten sam interfejs wrappera).
`structlog` w workerze zostaje niezależnie od wyniku.

## Zależność: migracja `0012` i gałąź `chore/migracje-automatyczne`

Nasza migracja to **`0012`** (na `origin/main` ostatnia jest `0011_maps_freeze.sql`).

W locie jest gałąź `chore/migracje-automatyczne` (dd986d0), która dokłada dwie rzeczy:
`migrate-on-deploy.mts` (migracje w buildzie **produkcyjnym**, z jawną bramką
`VERCEL_ENV` — buildy preview celowo NIE migrują) oraz krok CI `check-migration-drift.mts`,
porównujący liczbę migracji w repo z liczbą zastosowanych na bazie stagingu.

**Te dwie rzeczy razem zatrzasną każdy PR wprowadzający migrację — także nasz.** Skrypt
dryfu kończy się błędem, gdy `applied < inRepo`, a jedyne miejsce stosujące migracje to
build produkcyjny, czyli **po** merge'u. PR z migracją `0012` ma więc w repo 12, na stagingu
11, CI na czerwono i żadnej ścieżki do zieleni w obrębie samego PR-a. Obie połowy tamtej
gałęzi są z osobna dobrze uzasadnione — dopiero ich złożenie tworzy zakleszczenie.

Rozstrzygnięcie kolejności **do decyzji użytkownika** (poza zakresem tego slice'a, ale
blokujące go):

- **(a) Nasz slice wchodzi pierwszy** — kontrola dryfu jeszcze nie istnieje, problem nas
  nie dotyczy, a tamta gałąź rozwiązuje go u siebie.
- **(b) Tamta gałąź wchodzi pierwsza, z poprawką** — kontrola dryfu odpala się wyłącznie
  przy pushu na `main`, nie na gałęziach PR (`if: github.ref == 'refs/heads/main'`). Dryf
  z definicji dotyczy relacji „wdrożone środowisko ↔ `main`", nie gałęzi tematycznej.
  Jedna linia w `ci.yml`.
- **(c) Migracja stosowana ręcznie na stagingu przed merge'em** — działa, ale znosi cel
  tamtej gałęzi i wraca do procesu, który miała zastąpić.

Rekomendacja: **(b)**. Niezależnie od naszego slice'u tamta gałąź w obecnej postaci
zatrzasnęłaby każdą przyszłą migrację.

## Poza zakresem tego slice'a

- **Alerty** (Sentry, powiadomienia mailem/Slackiem) — użytkownik świadomie ich nie wybrał.
- **Metryka „% pól as proposed"** — osobna pozycja NEXT roadmapy; ten slice kładzie pod nią
  szynę i zbiera dane.
- **Dreny logów** do zewnętrznego zbieracza.
- **Dziennik w UI** dla rzeczoznawcy — czytnikiem jest `pnpm trace` w konsoli.
- **Automatyczne kasowanie starych zdarzeń** — na stagingu bezprzedmiotowe, ale tabela
  rośnie bez ograniczeń; follow-up.

## Rozstrzygnięcia brainstormu (user, 2026-08-19)

1. Cel: odtwarzanie zgłoszeń użytkownika + zbieranie danych pod metryki + zamknięcie długu
   z ADR-009. **Alerty odrzucone.**
2. Horyzont sięgania po ślad: „kilka dni do tygodnia" → przesądza o trwałym zapisie
   w Postgresie (retencja Vercela jest krótsza, Railway ~7 dni).
3. Logger: **pino** w web (wybór użytkownika mimo rekomendacji własnego wrappera),
   **structlog** w workerze — pino nie wchodzi do workera, bo worker jest w Pythonie.
4. Kwestia RODO rozwiązana serializerami z allowlistą zamiast `redact`.
5. `errMessage` zostaje (300 znaków) — uzasadnienie: staging, tani koszt pomyłki.
6. Do DoD wchodzi **punkt kontrolny po pierwszych realnych zgłoszeniach**: czy zebrane
   zdarzenia wystarczają do diagnozy, czy trzeba dołożyć kolejne.

## Uwaga F-9 (repo publiczne!)

Ani spec, ani testy, ani przykłady logów nie zawierają realnych adresów, numerów ksiąg
wieczystych ani danych osobowych. Fixture'y testowe używają danych syntetycznych.
