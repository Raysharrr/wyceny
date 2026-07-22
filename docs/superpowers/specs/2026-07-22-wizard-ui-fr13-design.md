# Slice 11 (11a+11b) — UI wizard: parity z makietą v3-r4 (FR-13) — design

Data: 2026-07-22 · Status: zaakceptowany na checkpoincie (a) · Poprzednik: Slice 10 (oględziny FR-2)
Źródła: wiki `roadmap.md` (NOW), PRD §4 (rdzeń FR: 7-krokowy workflow, AC-5, §7 `Sourced<T>`),
wiki `topics/product/mvp-gap-analysis-2026-07-18.md` (trzy elementy makiety bez właściciela),
wiki `topics/tech/subject-data-egib-mpzp-slice.md` (known limitations Slice 5), makieta
`raw/interactive-mockup/Wyceny - Makieta MVP (standalone) - v3-r4-2026-06-30.html` + kod JSX
`raw/interactive-mockup/Wyceny - v2 - full code/` (`shared.jsx` STEPS/Stepper/Field/SourceTag,
`screens-1.jsx` panel „Skąd te dane", `data.js` wzorzec `disc`), brainstorm 2026-07-22
(7 rozstrzygnięć usera).

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś rzeczoznawca tworzy wycenę jednym długim formularzem: wszystkie dane naraz (przedmiot,
KW, próba, cechy), na końcu „Utwórz" — i dopiero wtedy wycena istnieje. Oględziny i akcje
operatu żyją osobno, na stronie szczegółów. Makieta — dwukrotnie przetestowana z użytkownikiem
— pokazuje inny, naturalny rytm pracy: **siedem kroków** prowadzących od przedmiotu do
gotowego operatu: **1. Przedmiot · 2. Oględziny · 3. Próba · 4. Cechy · 5. Kalkulacja · 6. Opisy · 7. Operat**. Ten slice przenosi aplikację na ten rytm.

Rzeczoznawca zaczyna jak dziś — od adresu, danych przedmiotu i dokumentu KW. Kliknięcie
„Dalej" na pierwszym kroku **od razu tworzy szkic wyceny**: praca jest zapisana, można
przerwać i wrócić jutro, a lista wycen pokazuje szkic z kreską zamiast kwoty (kwota pojawi
się uczciwie dopiero po kalkulacji — nigdy zmyślona). Od tej chwili rzeczoznawca porusza się
po krokach: pasek postępu u góry pokazuje, gdzie jest; wstecz może wrócić zawsze (obejrzeć
i poprawić), do przodu przechodzi „Dalej" — krok po kroku, jak w makiecie. Zdjęcia z oględzin
wrzuca w kroku 2 (dziś musiał najpierw utworzyć całą wycenę), próbę transakcji zatwierdza
w kroku 3, cechy i wagi w kroku 4, a krok 5 pokazuje wyliczoną wartość rynkową z pełnym
rozbiciem. Jeśli po obejrzeniu wyniku wróci i zmieni próbę albo oceny — kwota zostaje
unieważniona i przeliczy się na nowo, bez ryzyka, że operat pójdzie ze starą liczbą.
Krok 7 to znane dziś zatwierdzenie, podpis i PDF; krok 6 (Opisy) na razie jedynie zapowiada
przyszłą edycję prozy — generator dokumentu działa jak dotychczas.

Druga część slice'a (11b) dokłada to, co w makiecie buduje zaufanie do danych: **przy każdym
polu** widać, skąd wartość pochodzi (🤖 pobrane automatycznie / ✍️ wpisane ręcznie / z wgranego
dokumentu), boczny panel **„Skąd te dane"** podlicza źródła na pierwszym kroku, a gdy dokument
KW i formularz mówią co innego (powierzchnia, numer KW), pole dostaje bursztynową ramkę
z oboma wartościami i miejscem na **uwagę do operatu** — aplikacja zwraca uwagę, ale decyzję
zostawia rzeczoznawcy (nudge, nigdy blokada). Edukacyjne teksty makiety („co dzieje się na
ekranie", opisy techniki) świadomie pomijamy — zgodnie z FR-13 to rusztowanie prototypu,
nie produkcyjne UI; zostaje operacyjny feedback („AI pobrało N transakcji") i legenda oznaczeń.

**Pod maską:** wizard to warstwa UX nad istniejącym modelem — silnik KCS (golden 1 044 400)
i serwerowa brama zatwierdzenia (F-4 `approvalGate`) pozostają nietknięte. Szkic po kroku 1
to dzisiejsza wycena z częściowym snapshotem `inputs` i `wr = NULL` (jedna trywialna migracja);
kroki 3–5 zapisują próbę, cechy i kalkulację osobnymi mutacjami draftu w transakcji z audytem
(wzorzec ze Slice 8/10). Kroki żyją pod `?step=N` na stronie wyceny; nawigacja do przodu
wynika z danych szkicu (co już zapisane), nie z klikania. Całość powstaje za flagą — stary
formularz działa do momentu przełączenia, więc main pozostaje deployowalny po każdym tasku.

## Outcome / DoD

- **11a:** 7-krokowy wizard na prodzie — szkic po kroku 1, kroki 2–7 na wycenie, miękki
  gating `maxReached` z danych, mutacje draftu (próba/cechy/kalkulacja) z audytem, stary
  formularz usunięty po flipie flagi. Zero regresji F-1 (golden) i F-4 (`approvalGate`).
- **11b:** per-pole badge prowenancji, panel „Skąd te dane" (krok 1), wzorzec rozbieżności
  inline (pow. użytkowa + nr KW) — na prodzie. DoD roadmapy (parity z makietą v3-r4) spełnione
  po 11b.
- Wyceny QA na prodzie (`5faecc25`, `f9af0aba`, `11e60dde`, drafty `e2cac945`, `3c813f0e`)
  nietknięte; istniejące wyceny z `wr` działają bez zmian; approved/signed dostają dzisiejszy
  widok read-only.

## Rozstrzygnięcia brainstormu (user, 2026-07-22)

1. **Gating: miękki jak makieta.** `maxReached` — do przodu tylko przez „Dalej" (= zapis/
   zatwierdzenie kroku), wstecz i w obrębie osiągniętych kroków nawigacja wolna. Edycja
   wsteczna nie kaskaduje blokad w nawigacji; spójności pilnuje serwerowy `approvalGate`
   (F-4) — wizard to UX, nie brama. AC-5 spełnione w duchu: pierwsze wejście na N+1 wymaga
   przejścia N.
2. **Lifecycle: create po kroku 1 + `wr` nullable.** „Dalej" na kroku 1 tworzy szkic
   z subject/KW/area; WR liczone i zapisywane na kroku 5. Migracja 0010
   (`ALTER stub_wr DROP NOT NULL`); lista/detal pokazują „—" przy `wr = NULL`. Odrzucone:
   sentinel `wr = 0` (cichy default, łamie AC-3) i staging upload zdjęć bez valuationId
   (przebudowa tokenów uploadu — więcej pracy niż migracja).
3. **Routing: `?step=N`** na `/valuations/[id]`; `/valuations/new` = krok 1 (create →
   redirect na `?step=2`). Jeden route, `page.tsx` jako switch kroków; historia przeglądarki
   i linki działają. `maxReached` wyliczane z danych szkicu, nie z URL. Odrzucone: nested
   routes per krok (7 route'ów, duplikacja fetch/auth, większy diff bez korzyści).
4. **Per-pole badge: mapowanie pole→grupa w UI.** Statyczna mapa „pole X ∈ grupa Y" po
   stronie web; badge renderowany z grupowego `inputs.provenance`. Zero zmian modelu/DDL/
   migracji prowenancji, zero dotykania F-4/F-5 — świadomy podzbiór zapisany już w known
   limitations Slice 5. Odrzucone: model per-pole (dotyka assign-provenance, approvalGate,
   confirm-akcji + migracja danych).
5. **Panel „Skąd te dane": parity z makietą.** Sticky sidebar na kroku 1: liczniki pól per
   źródło (auto-fetch / dokument / ręczne) + legenda oznaczeń. Bez `fetchedAt`, bez linków
   do źródeł (YAGNI — makieta tego nie ma; reguła ui-planning: przenoś makietę, nie wymyślaj).
6. **Rozbieżności: wzorzec inline `disc` dla realnie porównywalnych par.** Makieta nie ma
   osobnego ekranu — ma amber panel przy polu („odpis KW X vs źródło Y") + input „uwaga do
   operatu". Podłączamy do: pow. użytkowa (dzisiejszy `areaMismatch` dostaje kształt makiety)
   i nr KW (dokument vs pole ręczne). Uwaga zapisywana do `inputs`; propagacja do szablonu
   operatu — późniejszy slice (szablon nietykany). Pary z makiety wymagające działu I-O KW
   (pow. działki, kondygnacje, adres) — **nieporównywalne dziś**: ekstrakt KW niesie tylko
   `kwLokalu`/`kwGruntu`/`powUzytkowaKw`; rozszerzenie = zmiana promptu vision-LLM w workerze
   → backlog, osobny slice. Nudge, nigdy blokada.
7. **FR-13 (rusztowanie):** pomijamy teksty edukacyjne makiety (wyjaśnienia „co dzieje się
   na ekranie", opisy kroków/techniki, hinty o AI — materiał zaparkowany do przyszłej sekcji
   „Pomoc", LATER). Zostają: AutoBannery statusowe (operacyjny feedback prowenancji), legenda
   oznaczeń, rozbicie T2/T3/T4 (feature ze Slice 1, nie rusztowanie).
8. **Cięcie: dwa slice'y.** 11a = wizard (rdzeń strukturalny), 11b = prowenancja (badge +
   panel + disc). Jeden spec (ten), dwa plany, dwa cykle SDD, dwa deploye. 11b nie blokuje
   11a; DoD roadmapy spełnia się po 11b.

## Model danych

- **Migracja 0010:** `valuation.stub_wr` (TS: `wr`) → nullable. `NULL` = szkic przed
  zatwierdzoną kalkulacją. Jedyna zmiana DDL w obu slice'ach.
- **Częściowy `inputs` (jsonb, bez zmian DDL):** po kroku 1 snapshot zawiera
  `subject`/`subjectMeta`/`kw`/`kwMeta`/`area`/`provenance` — `comparables: []`,
  `features: []`, `sampleMeta: null`. Kolejne kroki dopisują swoje fragmenty mutacjami.
  Istniejące wyceny (pełny `inputs`, `wr` ustawione) — bez migracji danych.
- **`maxReached` — derywacja z danych, zero nowego stanu:**
  - szkic istnieje → kroki 1–3 osiągalne (oględziny opcjonalne — jak dziś, upload nie jest
    warunkiem dalszej pracy; FR-2: ostrzeżenie, nie blokada),
  - próba zapisana (`inputs.comparables` niepuste) → krok 4,
  - cechy zapisane (`inputs.features` niepuste) → krok 5,
  - `wr` niepuste (kalkulacja zatwierdzona) → kroki 6–7.
    Wejście na `/valuations/[id]` bez `?step` (szkic) → redirect na najdalszy osiągalny krok.
- **`inputs.discrepancyNotes?: Record<string, string>`** (11b) — uwagi rzeczoznawcy do
  rozbieżności, klucz = identyfikator pary (np. `area`, `kwNumber`). Zmiana addytywna typu
  `KcsInput`, silnik jej nie czyta.

## Architektura — 11a

### Krok 1: `/valuations/new` (create częściowy)

- Renderuje dzisiejsze sekcje `subject-section` + `kw-section` (istniejące komponenty —
  dekompozycja, nie rewrite) + pola nagłówkowe (adres, area, purpose, nr KW, klient).
  `inspectionDate` przenosi się do kroku 2 (data oględzin — tam jest naturalna).
- Nowa akcja `createDraft` (owner z sesji): walidacja schematu kroku 1 (podzbiór
  `valuationFormSchema` bez features/comparables), `assignProvenance` dla dostępnych grup,
  zapis z `wr: null`, audyt w tx, redirect `/valuations/[id]?step=2`.
- Dzisiejsza akcja `createValuation` (pełny payload) żyje do flipa flagi, potem usunięta.
- Guardy sekwencji `fetchSeq`/`kwSeq`/`mapSeq` zachowane przy przenoszeniu sekcji.

### Kroki 2–7: `/valuations/[id]?step=N` (switch w page.tsx)

- `page.tsx` (server component): fetch wyceny + wyliczenie `maxReached` + render Steppera
  (7 kroków wg `STEPS` makiety: Przedmiot/Oględziny/Próba/Cechy/Kalkulacja/Opisy/Operat),
  FootNav (Wstecz/Dalej) i komponentu kroku. Kroki poza `maxReached` — disabled w Stepperze.
  Krok 1 w trybie edycji na istniejącym szkicu = te same sekcje co `/valuations/new`,
  zapis mutacją `saveSubject` (tx + audyt `subject_updated`; też nulluje `wr` przy zmianie
  `area` — dane wejściowe silnika).
- **Krok 2 (Oględziny):** przeniesiona `inspection-section` (Slice 10, już komponent na
  detalu) + pole `inspectionDate`. Asymetria new/detail znika.
- **Krok 3 (Próba):** sekcja próby wyjęta z `new-valuation-form.tsx` + „Dalej" = mutacja
  `saveSample` (tx + audyt `sample_updated`, owner-only, draft-only). Inwariant ≥12
  transakcji dla KCS — walidacja jak dziś (AC-4).
- **Krok 4 (Cechy):** sekcja cech/wag (Σ=100%) + „Dalej" = mutacja `saveFeatures`
  (tx + audyt `features_updated`).
- **Krok 5 (Kalkulacja):** server component liczy `computeKcs(inputs)` on-the-fly (czysta
  funkcja, silnik nietykany) i renderuje istniejący `KcsBreakdown` (T2/T3/T4); „Dalej" =
  mutacja `confirmCalculation` zapisująca `wr` (tx + audyt `calculation_confirmed`).
- **Inwalidacja WR:** `saveSample`/`saveFeatures` na szkicu z ustawionym `wr` nullują `wr`
  w tej samej tx (+ wpis audytu) — stara kwota nigdy nie przeżyje zmiany danych wejściowych.
- **Krok 6 (Opisy):** cienki placeholder („generator prozy — wkrótce"; FR-6 nie ma backendu,
  osobny przyszły slice). „Dalej" tylko nawiguje.
- **Krok 7 (Operat):** istniejące blockery + akcje approve/sign + PDF/DOCX przeniesione
  z dzisiejszego detalu. `approvalGate` (F-4) bez zmian; `wr = NULL` musi blokować approve
  (jeśli dzisiejsze blockery tego nie łapią — dodać blocker, nie zmieniać bramy).
- **Approved/signed:** dzisiejszy płaski detal read-only (bez Steppera) — bez zmian.

### Kill-switch (lekcja S10: shipuj wcześnie)

- Flaga `NEXT_PUBLIC_WIZARD`: off = stary formularz + stary detal (jak dziś); on = wizard.
  Wprowadzona w pierwszym tasku UI; main deployowalny po każdym tasku.
- Flip + usunięcie starego formularza (`new-valuation-form.tsx` create-path, stara akcja
  `createValuation`) = przedostatni task 11a. Flaga znika razem ze starym kodem (kill-switch
  tymczasowy, nie permanentna konfiguracja).
- CI e2e: do flipa smoke jeździ po starym formularzu (flaga off); task flipa migruje smoke
  na wizard-flow w tym samym commicie.

### Testy (11a)

- RTL per przenoszona sekcja: `rtl-kw-section`, `rtl-inspection-section`,
  `rtl-features-section` renderują dziś `<NewValuationForm/>` / detal — migrują na render
  komponentu kroku w tych samych taskach, w których sekcja się przenosi (nie ad-hoc).
  Pragma `// @vitest-environment jsdom` + `afterEach(cleanup)`; bez `clearMocks`
  (`.findLast()` na mock.calls); automocki `_deps`: `storage.get` → `undefined`.
- Testy mutacji draftu: `createDraft`/`saveSubject`/`saveSample`/`saveFeatures`/
  `confirmCalculation` — owner-only, draft-only, audyt w tx, inwalidacja `wr`.
- Test derywacji `maxReached` (czysta funkcja od `inputs`/`wr`).
- Golden F-1 bez zmian — fitness gate w CI pilnuje.

## Architektura — 11b

- **`SourceBadge`** (per pole): komponent 🤖/✍️/dokument wg makiety (`SourceTag`), zasilany
  statyczną mapą pole→grupa (`ewidencja`/`mpzp`/`kw`/`geocode`/`area`/`weights`) i grupowym
  `inputs.provenance`. Podpinany do pól kroku 1 i detalu read-only.
- **Panel „Skąd te dane"**: karta-sidebar kroku 1 (wzorzec `screens-1.jsx`): sekcje
  „Darmowy auto-fetch" / „Z wgranego dokumentu" / „Wprowadzone ręcznie" z licznikami pól
  per źródło (z tej samej mapy) + `MarkingLegend`.
- **`DiscrepancyField`**: amber panel przy polu (wzorzec `Field`+`f.disc` z `shared.jsx`):
  dwie wartości z etykietami („odpis KW … / formularz …") + input „uwaga do operatu" →
  mutacja zapisu do `inputs.discrepancyNotes` (tx + audyt). Podpięcia: pow. użytkowa
  (zastępuje wizualnie dzisiejszy nudge `areaMismatch`), nr KW (dokument vs ręczny).
- Testy: RTL badge'a i panelu (mapowanie/liczniki), RTL DiscrepancyField, test mutacji uwag.

## Bezpieczeństwo / compliance

- Mutacje draftu: owner-only + draft-only + tx + audyt (wzorzec Slice 8/10); F-7 zachowane.
- `approvalGate` (F-4) — serwerowy inwariant nietknięty; gating UI to warstwa nad nim.
- F-9: fixture'y syntetyczne; adresy tylko golden-case + fikcyjne; żadnych realnych KW
  w testach/screenshotach.
- F-12: szablon DOCX nietykany w obu slice'ach.

## CI / e2e / deploy

- Per task: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` →
  commit → push → `gh run watch` na własnym sha. Prettier pre-commit.
- Deploy 11a: web (Vercel) + migracja 0010 na Railway Postgres. Zero nowych sekretów.
  Deploy 11b: web-only. Worker nietykany w obu.
- Weryfikacja prod po 11a: nowy szkic przez wizard (krok 1 → 2 → … → 7), stare wyceny QA
  otwierają się bez zmian, lista pokazuje „—" dla szkicu bez kalkulacji.

## Poza zakresem (jawnie)

- FR-6 Opisy (edycja/generowanie prozy) — krok 6 to placeholder; osobny slice.
- Sekcja „Pomoc" + treści hintów makiety — LATER (FR-13).
- Rozszerzenie ekstraktu KW o dział I-O (pow. działki, kondygnacje, adres) — backlog,
  dotyka workera.
- Propagacja `discrepancyNotes` do szablonu operatu — razem z najbliższym slice'em
  dotykającym szablonu.
- Model prowenancji per-pole — świadomie NIE; mapowanie pole→grupa wystarcza.
- Usuwanie porzuconych szkiców (krok 1 bez kontynuacji) — akceptujemy szkice na liście;
  delete → backlog.
- Telemetria „% pól as proposed" — NEXT w roadmapie.
- Backlog „photo hardening" ze Slice 10 — nie wchodzi (UI-only slice).

## Ryzyka

- **Restrukturyzacja łamie testy/e2e:** mitygacja = flaga + migracja testów w tych samych
  taskach co przenoszenie sekcji; smoke migruje przy flipie.
- **`wr = NULL` w miejscach zakładających liczbę** (lista, detal, dokument, blockery):
  mitygacja = task migracji 0010 obejmuje przegląd wszystkich konsumentów `wr` (CodeGraph
  blast-radius) + blocker approve dla `wr = NULL`.
- **Największy slice UI dotąd:** mitygacja = cięcie 11a/11b + kill-switch + sekwencyjny SDD
  z ledgerem; 11a deployowalny bez 11b.
- **Rozjazd krok-1-edycja vs `/valuations/new`:** ta sama para komponentów sekcji w obu
  kontekstach (create vs mutacja) — pilnowane w planie, nie dwie kopie formularza.
