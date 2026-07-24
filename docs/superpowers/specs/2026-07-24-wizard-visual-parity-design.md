# Slice 12 — UI wizard: parity wizualne z makietą v3-r4

Data: 2026-07-24 · Status: zatwierdzony na checkpoincie (a) · Poprzednik: Slice 11a (parity strukturalne, spec `2026-07-22-wizard-ui-fr13-design.md`)

## Opis produktowy — co budujemy z perspektywy użytkownika

Po Slice 11a wycena przechodzi przez ten sam 7-krokowy proces co w makiecie — ale wygląda jak
surowy prototyp: wąska pojedyncza kolumna, brak paska nawigacji u góry, brak informacji „gdzie
jestem i co tu robię", przyciski porozrzucane na końcu treści. Ten slice zamyka tę lukę: aplikacja
ma **wyglądać jak makieta**, którą Aneta i Zenon znają z warsztatów.

Konkretnie, rzeczoznawca po zalogowaniu zobaczy u góry stały **topbar** z logo aplikacji i swoim
nazwiskiem — na liście wycen, w kreatorze i w podglądzie zatwierdzonej wyceny. Po wejściu w wycenę
pod topbarem pojawi się **pasek kroków** (1–7, z ikonami i haczykami na krokach ukończonych) —
także na ekranie tworzenia nowej wyceny, gdzie dziś go nie ma, więc od pierwszej chwili widać,
że to krok 1 z 7. Każdy krok otwiera **nagłówek** w stylu makiety: „KROK 3/7 — DOBÓR PRÓBY
TRANSAKCJI", duży tytuł i jedno zdanie wyjaśnienia.

Treść kroków układa się w **dwie kolumny**: główna praca po lewej, a po prawej przyklejony
(sticky) panel z tym, co warto mieć przed oczami — na kroku 1 **mapa** z kafelkiem adresu
i powierzchni, na kroku 3 **statystyki próby** (ceny min/max/średnia i granice korekty), na
kroku 4 **licznik ΣUi i podgląd wartości**, które przeliczają się na żywo przy każdej zmianie
oceny cechy — rzeczoznawca od razu widzi, jak jego decyzja wpływa na wynik. Na dole ekranu
zawsze wisi **pasek nawigacji**: „Wstecz" po lewej, podsumowanie pośrodku („Próba: 12 transakcji
· Cśr 13 123,60 zł/m²", „Wartość rynkowa 1 044 400,00 zł"), główna akcja po prawej — nie trzeba
scrollować na dół formularza, żeby przejść dalej. Tam, gdzie aplikacja coś zrobiła sama, mówi
o tym wprost zielonym paskiem: „Pobrano 19 transakcji z RCN" (krok 3), „Wynik policzony
automatycznie z zatwierdzonej próby i ocen" (krok 5).

Te decyzje mają sens produktowy: proces wyceny jest długi i formalny, więc użytkownik musi
w każdej chwili wiedzieć **gdzie jest** (stepper + nagłówek), **co już ustalono** (sidebar
z liczbami na żywo) i **co dalej** (stały pasek na dole). Komunikaty „AI to zrobiło" budują
zaufanie do automatyzacji — pokazujemy tylko te, które są prawdziwe (celowo NIE kopiujemy
z makiety banneru „AI oceniło cechy ze zdjęć", bo tej funkcji jeszcze nie ma).

Pod maską to slice czysto prezentacyjny: zmienia się wyłącznie warstwa JSX/CSS — tokeny kolorów
i typografii (ciepłe tło, mono-numeryka dla kwot, font IBM Plex), wspólny szkielet ekranu
(WizardShell) i kompozycja komponentów kroków. Logika kroków, mutacje, gating, silnik obliczeń,
szablon operatu, worker i schemat bazy pozostają nietknięte co do bajta; jedyny „nowy" kod
liczący to wywołanie istniejącego, czystego silnika `computeKcs` po stronie przeglądarki, żeby
sidebar kroku 4 mógł przeliczać podgląd na żywo.

## Outcome / DoD

Ekrany kroków 1–7 **wyglądają jak makieta v3-r4** (nie tylko działają jak ona). DoD:

- side-by-side kroków 1–7 na prodzie z klikalną makietą bez rozjazdów strukturalno-layoutowych
  (poza świadomymi odstępstwami z sekcji „Poza zakresem"),
- zero regresji smoke/RTL; etykiety przycisków asertowane w smoke **niezmienione co do znaku**,
- golden F-1 (1 044 400) nietknięty; zero zmian F-4/F-7/F-12; worker nietknięty; zero DDL,
- `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` green per task; CI green.

## Decyzje (checkpoint (a), 2026-07-23/24)

1. **Deploy-safety przy auto-CD:** push per task na main; akceptujemy częściowo przestylowany
   prod między taskami (zmiany addytywne, każdy stan pośredni w pełni funkcjonalny).
2. **Shell:** wspólny `WizardShell` (topbar → stepper → nagłówek kroku → treść) używany przez
   `/valuations/new` i `/valuations/[id]` (branch wizarda). Na create stepper z krokiem 1
   aktywnym i 2–7 disabled. **Topbar globalnie** na ekranach po zalogowaniu (lista, wizard,
   flat view); `/login` bez topbara (własny layout jak w makiecie).
3. **Sidebar kroków 4–5:** pełne live ΣUi + WR — import `computeKcs` do komponentu klienckiego.
   Zweryfikowane przed spec'em: silnik czysty TS (139 linii, importy wyłącznie `import type`),
   depcruise nie ma reguły blokującej, moduł tree-shakeable. Korekta wobec roadmapy: sidebar
   ΣUi/WR jest **tylko na kroku 4** (makieta: krok 5 = grid kart T1–T4 bez sidebara).
4. **Tokeny:** globalny theme przez semantyczne zmienne shadcn w `globals.css` (Tailwind v4);
   `--primary` bez zmian (już `#1f7a5c` = akcent makiety). Fonty: Geist → **IBM Plex Sans +
   IBM Plex Mono** przez `next/font/google` (subset **latin-ext** — polskie diakrytyki).
5. **FootNav:** renderowany **przez komponent kroku** (fixed bottom), nie przez shell ze slotem —
   w krokach-formularzach przycisk submit zostaje JSX-owo wewnątrz `<form>` (natywny submit,
   zero portali i atrybutów `form=`), a testy RTL kroków nadal widzą przycisk w drzewie
   komponentu. (Doprecyzowanie względem szkicu z checkpointu (a), który zakładał slot w shellu —
   wynik wizualny identyczny, mniej mechaniki.)
6. **AutoBannery:** kroki **1** (restyl istniejącego paska statusu fetcha przedmiotu),
   **3** („Pobrano N transakcji z RCN" — `sampleMeta.query.count` + `fetchedAt`),
   **5** („Wynik policzony automatycznie z zatwierdzonej próby i ocen"). Krok 4 świadomie BEZ
   banneru (appka nie proponuje ocen ze zdjęć — banner makiety byłby fałszywy); kroki 6/7 bez.
7. **Task 0:** 1-linijkowa asercja linku „Pobierz DOCX" w smoke (fast-follow z final review 11a).
8. **Bug `?step=1` → 500 na legacy v2 drafcie** (`3c813f0e`, znaleziony przy side-by-side
   2026-07-23): diagnoza w S2; fix osobnym małym taskiem jeśli przyczyna jest płytka
   (defensywny fallback na kształcie danych); jeśli głębsza — wraca do usera z diagnozą.

## Architektura UI

### Tokeny (globals.css, Tailwind v4 `@theme`)

Z makiety (`styles.css` makiety, wartości 1:1):

| Token                           | Wartość                                                                                                         | Mapowanie                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| tło strony                      | `#f5f3ee` (ciepłe)                                                                                              | `--background`                                                                                 |
| tło kart                        | `#ffffff`                                                                                                       | `--card`                                                                                       |
| ink / neutrale                  | `#1c1b19` / `#46443f` / `#6f6c64` / `#97938a`                                                                   | `--foreground`, `--muted-foreground` (+ ew. własne `--ink-3/4` gdy skala shadcn nie wystarcza) |
| linie                           | `#e6e3dc` / `#d8d4ca`                                                                                           | `--border`, `--input`                                                                          |
| akcent                          | `#1f7a5c` (+ odcienie przez `color-mix` jak w makiecie: `-050` 9 %, `-100` 20 % z bielą, `-700` 80 % z czernią) | `--primary` (bez zmian) + `--accent-050/100/700`                                               |
| amber (weryfikacja)             | `#b07a16` / bg `#fbf2dd` / line `#ecd9a6`                                                                       | nowe vars `--amber*`                                                                           |
| human (fiolet „tylko człowiek") | `#6b4fb0` / bg `#f1edf9` / line `#ddd2f0`                                                                       | nowe vars `--human*` (użycie przyjdzie ze slice'em prowenancji)                                |
| numeryka                        | IBM Plex Mono, `tabular-nums`                                                                                   | klasa `.num`                                                                                   |
| fonty                           | IBM Plex Sans / IBM Plex Mono                                                                                   | `next/font/google`, subset `latin-ext`                                                         |
| radius                          | 9 px / 14 px (karty)                                                                                            | `--radius` (obecne 0.625rem ≈ 10 px — zostaje, różnica niezauważalna)                          |

Dark mode: appka ma blok `.dark` — dostaje analogiczne wartości (przyciemnione neutrale), ale
side-by-side robimy w light (makieta jest light-only).

### WizardShell i warstwy sticky

```
z-40  Topbar    sticky top-0      h-60px   brand (mono-mark „W" + nazwa) · spacer · user (avatar + imię/rola)
z-39  Stepper   sticky top-[60px] h-52px   „← Wyceny" | kroki 1–7 (kółko + label; done=zielone z ✓, active=ring)
      PageHead                             eyebrow „KROK N/7 — SEKCJA" · h1 · opis (1 zdanie)
      children                             treść kroku (max-w-[1240px], grid `1.6fr 1fr` gdy sidebar)
z-30  FootNav   fixed bottom               [Wstecz] | podsumowanie (środek) | [primary]   (backdrop-blur)
```

- `WizardShell({ currentStep, maxReachedStep, valuationId?, children })` — RSC; create podaje
  `maxReachedStep=1` (kroki 2–7 disabled). Stepper = **restyle** istniejącego `stepper.tsx`
  (Link/span disabled zostają), nie rewrite. `WIZARD_STEPS` (labels) bez zmian.
- Topbar = osobny komponent w layoucie segmentu `/valuations` (obejmuje listę, create, [id]);
  lista oddaje mu akcje „Profil"/„Wyloguj" (przycisk „Nowa wycena" zostaje na liście przy tytule).
- Main dostaje `padding-bottom` ~120 px (miejsce na FootNav); FootNav tylko w wizardzie
  (create + kroki draft-ownera), NIE we flat view i NIE na liście.
- `WizardNav` (obecny pasek back/next) znika — zastępuje go FootNav per krok.

### Mapa per krok (nagłówek · layout · sidebar · FootNav · banner)

Copy nagłówków wg makiety, skorygowane do prawdy aplikacji (FR-13: bez tekstów edukacyjnych;
opisy = 1 zdanie funkcjonalne). Etykiety primary **1:1 z dzisiejszymi** (smoke je asertuje).

| Krok            | Eyebrow / tytuł                                                                                                                                          | Sidebar (sticky)                                                                                                                                                                                                                                               | FootNav: środek                                 | FootNav: primary                                                                                                                        | AutoBanner                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1 (create+edit) | KROK 1/7 — PRZEDMIOT WYCENY / „Dane przedmiotu" / „Dane pobierane są automatycznie ze źródeł — zweryfikuj, uzupełnij braki; każde pole jest edytowalne." | `MapPreview` (przeniesiony z sekcji) + kafelek podsumowania live z form state (wg makiety: adres · dzielnica/miasto · Powierzchnia · Piętro — w zakresie pól, które formularz faktycznie ma)                                                                   | „Przedmiot: {typ}, {pow} m²"                    | „Dane się zgadzają — dalej" (submit w formie RHF)                                                                                       | TAK — restyl paska statusu fetcha („Pobrano dane przedmiotu: EGiB, MPZP, geokoder")                |
| 2               | KROK 2/7 — OGLĘDZINY / „Oględziny nieruchomości" / „Jedyny krok, którego nie da się zautomatyzować — zdjęcia i notatka z wizyty."                        | — (struktura sekcji foto z FR-2 zostaje 1-kolumnowa)                                                                                                                                                                                                           | „Oględziny: {N} zdjęć"                          | link „Dalej" (label frozen — smoke)                                                                                                     | —                                                                                                  |
| 3               | KROK 3/7 — DOBÓR PRÓBY TRANSAKCJI / „Próba porównawcza" / „Pobierz transakcje z RCN i zbuduj próbę (min. 12)."                                           | „Statystyki próby": Cmin/Cmax/Cśr (już liczone live) + Vmin=Cmin/Cśr, Vmax=Cmax/Cśr, położenie Cśr + rangebar „Granice korekty [Vmin ; Vmax]"                                                                                                                  | „Próba: {N} transakcji · Cśr {X} zł/m²"         | „Zatwierdź próbę i dalej" (submit w formie)                                                                                             | TAK — „Pobrano {count} transakcji z RCN ({data})" z `sampleMeta`; widoczny gdy sampleMeta istnieje |
| 4               | KROK 4/7 — CECHY RYNKOWE / „Cechy, oceny i wagi" / „Wagi domyślne dla typu obiektu (lokal) — oceny i wagi należą do Ciebie."                             | „Wskaźnik korekty ΣUi" (duża liczba + opis lepszy/gorszy od średniej + pasek Vmin/1,000/Vmax) + „Podgląd wartości (WR)": Cśr × ΣUi = cena jedn. × pow. = WR — **live** (`computeKcs` client-side na live form state; przy niepełnych/niepoprawnych danych „—") | „ΣUi {X} · podgląd WR {Y} zł"                   | „Zatwierdź cechy i dalej" (submit w formie)                                                                                             | NIE (świadomie — patrz decyzja 6)                                                                  |
| 5               | KROK 5/7 — KALKULACJA / „Kalkulacja i wynik" / „Każda liczba ma widoczne źródło i wzór — Tabele 1–4 trafiają wprost do operatu."                         | — (grid kart T1–T4, jak makieta)                                                                                                                                                                                                                               | „Wartość rynkowa {WR} zł"                       | „Zatwierdź kalkulację i dalej" / „Dalej" po potwierdzeniu (istniejący `ConfirmCalculationButton` przeniesiony do FootNav)               | TAK — „Wynik policzony automatycznie z zatwierdzonej próby i ocen."                                |
| 6               | KROK 6/7 — SEKCJE OPISOWE / „Sekcje opisowe" / „Generator prozy (FR-6) w przygotowaniu — opisy powstają z szablonu przy zatwierdzeniu."                  | —                                                                                                                                                                                                                                                              | „Opisy z szablonu przy zatwierdzeniu"           | link „Dalej" (frozen)                                                                                                                   | —                                                                                                  |
| 7               | KROK 7/7 — PODGLĄD OPERATU / „Operat szacunkowy" / „Sprawdź kompletność danych i zatwierdź operat — PDF wygeneruje się po zatwierdzeniu."                | —                                                                                                                                                                                                                                                              | „Wartość rynkowa {WR} zł" (lub status blokerów) | „Zatwierdź operat" (istniejący przycisk `approve-button`, przeniesiony do FootNav; pozostałe akcje `ValuationActions` zostają w karcie) | —                                                                                                  |

Amber banner inwalidacji WR na kroku 5 (z 11a) zostaje — restyl na `AutoBanner kind="warn"`.

### Live ΣUi/WR na kroku 4 — przepływ danych

`step-features.tsx` (client) dostaje z serwera (już dziś) snapshot `inputs` (comparables z kroku 3,
area itd.); komponuje `KcsInput` z live `useWatch` (ratings/wagi) + snapshot i woła `computeKcs`
w `useMemo`. Silnik może rzucać na niepoprawnym wejściu → wywołanie w `try/catch`, sidebar
pokazuje „—" + neutralny komunikat, dopóki dane niekompletne. Zero nowych zależności; F-1
nietknięty (silnik tylko WYWOŁYWANY, nie zmieniany).

## Poza zakresem (świadome odstępstwa — do punch-listy przy side-by-side)

1. **K7: render A4 + „Pobierz PDF/Edytuj w aplikacji" przed zatwierdzeniem** — trwałe odstępstwo
   (decyzja usera 2026-07-23): natywny viewer PDF w iframe po approve.
2. **K6: generator prozy** — FR-6, osobny slice (placeholder zostaje, dostaje tylko nagłówek+FootNav).
3. **K3: AI-dobór próby, kolumna „STATUS DOBORU", „Analiza rynku" (proza) w sidebarze** — funkcjonalne, poza slice'em.
4. **K2: sidebar „Sekcje operatu z tych zdjęć", zmiana nazw sekcji foto, „Dyktuj notatkę"** —
   struktura kroku 2 z FR-2/Slice 10 zostaje; tylko nagłówek+FootNav+restyl kart.
5. **Prowenancja per pole** (badge 🤖/✍️, panel „Skąd te dane", rozbieżności inline) — NEXT
   (spec sekcja 11b w `2026-07-22-wizard-ui-fr13-design.md`).
6. **Teksty edukacyjne makiety** — nadal pomijane (FR-13).
7. **Banner K4 „AI oceniło cechy ze zdjęć"** — do czasu realnej funkcji.

## Nietykalne (fitness)

F-1 golden (silnik nietknięty — tylko nowe wywołanie client-side), F-4 approvalGate, F-7 audyt
(zero nowych/zmienionych mutacji), F-9 fixture'y syntetyczne, F-10 depcruise, F-12 szablon.
Worker nietknięty. Zero DDL. Pliki `"use server"` — bez nowych eksportów (lekcja 11a).

## Ryzyka i mitigacje

| Ryzyko                                                                          | Mitigacja                                                                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| RTL kroków 3/4 łamie się na przeniesieniu przycisku do FootNav                  | FootNav renderowany przez komponent kroku — przycisk zostaje w drzewie renderu; asercje `getByRole` przeżywają |
| Smoke łamie się na copy                                                         | Etykiety frozen (tabela wyżej); task ruszający etykietę migruje smoke w tym samym commicie                     |
| `latin-ext` zapomniany przy next/font                                           | jawny krok w tasku tokenów + wizualny check „ą/ż/ó"                                                            |
| Sticky layering (topbar/stepper/footnav) koliduje z iframe PDF na K7 po approve | flat view bez FootNav; sanity-check QA na wycenie zatwierdzonej                                                |
| Restyling globalny psuje flat view / listę                                      | flat view reużywa `cards.tsx` — restyl kart obejmuje oba widoki; QA obu przed checkpointem deployu             |
| 500 na `?step=1` legacy draftu zasłania side-by-side K1 edit                    | osobny task diagnostyczno-naprawczy (decyzja 8)                                                                |

## Proces

S3 wg `superpowers:subagent-driven-development`: świeży implementer + niezależny reviewer per
task; ledger `.superpowers/sdd/progress.md` — nowa sekcja `# SLICE 12`; briefy
`parity-task-N-brief.md` / `-report.md`. Per task: `pnpm turbo lint typecheck test build
--env-mode=loose && pnpm depcruise` → commit (EN, conventional, ≤100 znaków) → push (kontroler,
nie subagent) → `gh run watch` na własnym SHA. Push na main = auto-deploy PROD (~50 s).
Side-by-side z klikalną makietą PRZED checkpointem deployu (reguła `ui-planning.md` §5).
