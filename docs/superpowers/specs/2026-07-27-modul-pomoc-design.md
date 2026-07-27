# Moduł Pomoc — instrukcja obsługi + metodyka evidence-based (design spec)

**Data:** 2026-07-27
**Slice:** 13
**Roadmapa:** `wiki/roadmap.md` → 🟢 NOW „Moduł Pomoc: instrukcja + metodyka evidence-based"
**Decyzje wejściowe:** user 2026-07-27 (4 rozstrzygnięcia + brainstorm) — zapisane w `wiki/log.md`
**Zastępuje:** „Prowenancja per pole w UI" (dawne 11b) — wykreślona z roadmapy tą samą decyzją

---

## Opis produktowy — co budujemy z perspektywy użytkownika

Rzeczoznawca, który dziś otwiera aplikację po raz pierwszy, jest zdany na intuicję. Przechodzi przez siedem kroków kreatora, widzi, że część pól wypełnia się sama, i musi uwierzyć, że liczby, które z tego wychodzą, są poprawne. Nie ma gdzie sprawdzić, skąd wzięło się dwanaście transakcji porównawczych, dlaczego jedna z nich odpadła, ani czemu wartość rynkowa kończy się akurat na pełnych stu złotych. Aplikacja liczy dobrze, ale nie tłumaczy się ze swojej pracy.

To nie jest problem wygody. Rzeczoznawca **podpisuje się pod operatem i ponosi za niego odpowiedzialność prawną**. Jeśli bank albo sąd zapyta, na jakiej podstawie dobrano próbę porównawczą, odpowiedź „tak wyliczył program" nie wystarczy. Musi umieć opisać metodę — a żeby ją opisać, musi ją najpierw znać.

Budujemy **Pomoc** — osobną część aplikacji dostępną po zalogowaniu, która odpowiada na dwa różne rodzaje pytań, i dlatego dzieli się na dwa drzewa.

Pierwsze to **„Jak korzystać"**: instrukcja obsługi, strona na każdy krok kreatora plus wprowadzenie i opis tego, co dzieje się po zatwierdzeniu wyceny. Czyta się to zadaniowo — użytkownik utknął na kroku trzecim, wchodzi na stronę kroku trzeciego. Każda strona pokazuje zrzuty prawdziwych ekranów aplikacji, więc widać, o czym mowa.

Drugie to **„Na czym opieramy wynik"**: materiał referencyjny o metodzie. Jak liczymy wartość rynkową i dlaczego zaokrąglamy tak, a nie inaczej. Skąd bierzemy transakcje porównawcze, ile ich pobieramy, jakie odrzucamy i według jakiego kryterium. Z jakich publicznych rejestrów pochodzą dane o działce, budynku i planie miejscowym. Co dokładnie wyciągamy z księgi wieczystej i aktu notarialnego. Kiedy aplikacja pozwala zatwierdzić wycenę, a kiedy blokuje. Co się dzieje z operatem po podpisaniu i dlaczego nie da się go już zmienić. To jest sekcja, do której rzeczoznawca wraca, przygotowując się do rozmowy z instytucją — i którą może zacytować.

Do Pomocy prowadzą trzy drogi. Z menu pod awatarem — wejście ogólne. Ze **znaku zapytania w nagłówku każdego kroku kreatora** — prosto na stronę opisującą ten krok, czyli dokładnie tam, gdzie użytkownik właśnie utknął. I z **wyszukiwarki** wewnątrz Pomocy, która przeszukuje pełną treść, nie tylko tytuły — bo pytanie brzmi zwykle „co to jest IQR" albo „dlaczego brakuje planu miejscowego", a nie „gdzie jest rozdział o próbie".

Kluczowe zobowiązanie tej Pomocy brzmi: **wszystko, co w niej napisane, wynika z rzeczywistego kodu aplikacji**, nie z tego, jak miało być. Liczby, progi i adresy rejestrów pochodzą ze stałych, na których faktycznie liczy silnik. To nie jest broszura marketingowa — to opis działającego systemu, który ma się obronić przed kimś, kto zada trudne pytanie.

_Pod maską:_ treść żyje w plikach MDX obok kodu aplikacji, dzięki czemu wersjonuje się razem z nim, a wartości liczbowe mogą być importowane z modułów domeny zamiast przepisywane. Wyszukiwarka działa po stronie przeglądarki na indeksie budowanym z tych plików — treść jest mała, więc nie potrzeba do tego serwera. Zrzuty ekranu powstają ze stagingu przez sterowaną przeglądarkę i są odświeżane w tym samym rytuale dokumentacyjnym, który po każdym slice'ie aktualizuje wiki. Slice nie dotyka silnika, workera, szablonu operatu ani schematu bazy.

---

## Outcome

Aplikacja ma moduł Pomoc pod `/pomoc`, dostępny wyłącznie po zalogowaniu, opisujący **całość dotychczas wdrożonej funkcjonalności** (slice'y 0–12) w dwóch drzewach: zadaniowym („Jak korzystać") i referencyjnym („Na czym opieramy wynik"), z wyszukiwarką pełnotekstową i trzema wejściami z aplikacji.

Dostarczany w **dwóch falach** z checkpointem użytkownika pomiędzy — wzorzec ze Slice'a 12, gdzie fala 2 uratowała jakość po odrzuceniu fali 1.

## Definition of Done

- Obie fale wdrożone na **staging** (`https://wyceny-mu.vercel.app`).
- `/pomoc` i wszystkie podstrony **niedostępne bez sesji** (przekierowanie na login, wzorzec per strona jak w `valuations`).
- Wyszukiwarka znajduje strony **po treści**, nie tylko po tytułach.
- Znak zapytania w nagłówku **każdego z 7 kroków** kreatora prowadzi do właściwej strony Pomocy.
- Wartości liczbowe w drzewie referencyjnym pochodzą **z kodu** (import lub interpolacja ze stałych), nie z przepisania — dowód: zmiana stałej zmienia treść Pomocy.
- **Golden F-1 (1 044 400 zł) nietknięty**; zero zmian w F-4, F-7, F-12, workerze, szablonie operatu i schemacie bazy (brak migracji DDL).
- Smoke E2E i testy RTL bez regresji; CI zielone.
- **S7 wykonany** — krok o Pomocy dopisany do `references/docs-update-checklist.md` w skillu `build-slice` (wiki repo).

## Zamrożone (frozen)

`packages/shared`, `apps/worker/**`, `apps/web/src/domain/kcs.ts` **poza** mechanicznym wyodrębnieniem stałych zaokrągleń (fala 2, patrz niżej), `apps/web/src/db/**` i wszystkie migracje, generator dokumentu i szablon operatu, etykiety przycisków objęte smoke (byte-identical).

---

## Architektura

### Trasy i ochrona

```
apps/web/src/app/pomoc/
├── layout.tsx          → export { AppShellLayout as default }   (wzorzec z valuations/profile)
├── page.tsx            → spis treści obu drzew + pole wyszukiwarki
└── [slug]/page.tsx     → renderuje stronę z manifestu; getSession() + redirect gdy brak sesji
```

Ochrona per strona (`getSession()` + `redirect`), zgodnie z tym, co robią `valuations` i `profile` — `AppShellLayout` sam nie blokuje, tylko nie renderuje Topbara bez sesji.

### Treść

```
apps/web/src/content/pomoc/
├── manifest.ts                    → drzewo, kolejność, tytuły, tagi, lazy import treści
├── jak-korzystac/*.mdx            → fala 1 (9 stron)
└── metodyka/*.mdx                 → fala 2 (6 stron)
```

`manifest.ts` jest jedynym źródłem struktury nawigacji: dla każdej strony `slug`, `title`, `tree`, `order`, `tags` oraz `load: () => import("./…mdx")`. Jawna mapa importów zamiast dynamicznego sklejania ścieżki — bundler musi widzieć cele statycznie.

MDX przez `@next/mdx` (+ `@mdx-js/loader`, `@mdx-js/react`) w `next.config.ts`. Strony MDX **nie są trasami** — `pageExtensions` zostaje bez zmian, treść jest importowana przez `[slug]/page.tsx`.

Wartości z kodu wstawiane w MDX przez import stałych — to jest sedno wymogu evidence-based i powód wyboru MDX zamiast czystego markdownu.

### Wyszukiwarka

Skrypt `apps/web/scripts/build-help-index.ts` (uruchamiany przez `tsx`, już obecny w repo — używa go `pnpm seed`), podpięty jako `prebuild` i `predev` w `apps/web/package.json`, czyta pliki MDX z `src/content/pomoc/**`, usuwa składnię (fence'y, znaczniki, importy) i zapisuje `apps/web/src/content/pomoc/search-index.json` w kształcie `{ slug, title, tree, tags, text }[]`. Plik jest **generowany i gitignorowany** — build zawsze go odtwarza, więc nie może się zestarzeć. Skrypt przerywa build, jeśli plik MDX nie ma wpisu w manifeście albo manifest wymienia stronę bez pliku (tania ochrona przed stroną-widmem w wynikach wyszukiwania).

Funkcje czyste (`stripMdx`, `normalize`, `searchIndex`) mieszkają w `apps/web/src/lib/help-search.ts` — **jedno źródło dla skryptu budującego, komponentu wyszukiwarki i testów**. Skrypt jest w TypeScripcie, a nie w `.mjs`, właśnie po to: plik `.mjs` importowany z testu `.ts` przechodzi w vitest, ale wywraca `pnpm typecheck` na braku deklaracji.

Wyszukiwanie po stronie klienta: proste dopasowanie podciągów bez uwzględniania wielkości liter i polskich znaków diakrytycznych, z podświetleniem trafienia i nazwą drzewa. Treść jest rzędu kilkudziesięciu kilobajtów — indeks pełnotekstowy w pamięci wystarcza, żadnej biblioteki ani backendu.

### Wejścia

1. **Menu pod awatarem** → pozycja „Pomoc" (miejsce istnieje od Slice'a 12).
2. **Znak zapytania w nagłówku kroku kreatora** → `/pomoc/krok-N-…`. Komponent nagłówka kroku (`StepHeader`, Slice 12) dostaje opcjonalny slug; ikona renderuje się tylko, gdy slug podano — zasada **zero martwych linków** ze Slice'a 12.
3. **Wyszukiwarka** na `/pomoc`.

### Zrzuty ekranu

Robione ze **stagingu** przez sterowaną przeglądarkę (MCP), zapisywane w `apps/web/public/pomoc/`, osadzane w MDX. Nazewnictwo `krok-N-<co>.png`. Kompresja do rozsądnej wagi; stała szerokość viewportu dla spójności kadrów. Świeżość zapewnia rytuał S6 (patrz niżej), nie automat w CI.

---

## Fala 1 — szkielet + instrukcja obsługi

Konfiguracja MDX, trasa `/pomoc` z ochroną, `manifest.ts`, renderer stron, nawigacja po obu drzewach (referencyjne widoczne jako puste/„wkrótce"), wyszukiwarka, trzy wejścia, zrzuty ze stagingu.

Strony (9): `pierwsze-kroki` (konto, lista wycen, tworzenie wyceny), `krok-1-przedmiot`, `krok-2-ogledziny`, `krok-3-proba`, `krok-4-cechy`, `krok-5-kalkulacja`, `krok-6-opisy`, `krok-7-operat`, `po-zatwierdzeniu` (podpis, pobieranie DOCX/PDF, niezmienność).

**⛔ CHECKPOINT:** ocena fali 1 na stagingu przed pisaniem treści metodycznej.

## Fala 2 — metodyka

Strony (6): `metoda-kcs` (wzór, konwencja zaokrągleń, dlaczego 1 044 400 a nie 1 043 900), `dobor-proby-rcn` (rejestr RCN, wielkość puli, pasmo metrażu, okno dat, filtr sanity dat, IQR-trim, próg 12 transakcji), `zrodla-danych-przedmiotu` (geokoder, EGiB, MPZP, przypadek braku planu), `ekstrakcja-kw-akt` (co czytamy z dokumentów, czego nie), `zasady-zatwierdzania` (prowenancja, co blokuje zatwierdzenie), `operat-i-niezmiennosc` (struktura dokumentu, audyt, podpis).

**Jedyna zmiana w kodzie domeny w całym slice'ie:** wyodrębnienie literałów zaokrągleń z `computeKcs` do nazwanych, eksportowanych stałych (dziś `roundTo(csr, 2)` itd. plus opis w komentarzu JSDoc). Zmiana czysto mechaniczna, chroniona goldenem F-1 — jeśli cokolwiek się przesunie, test padnie.

Stałe workera (`POOL_N`, `AREA_BAND_PCT`, `DATE_WINDOW_MONTHS`, adresy rejestrów) są w Pythonie, więc do MDX trafiają jako wartości utrzymywane po stronie web. **Rozjazd między nimi a workerem nie jest pilnowany automatem** — patrz Ryzyka.

---

## Poza zakresem (świadomie)

| Wykluczone                                                   | Powód                                                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-13 jako bramka w CI** (test parytetu stałych web↔worker) | Zastąpione rytuałem S6. Uzasadnienie empiryczne: w tym projekcie rytuał docs-loop wykonano 9/9 razy, a cotygodniowy lint 0/12 — mechanizm wpięty w pętlę dostarczania trzyma, osobna dyscyplina nie |
| Zrzuty generowane przez Playwright w CI                      | Instalacja przewyższa wartość; zrzuty robione przez przeglądarkę, odświeżane w S6                                                                                                                   |
| Publiczna Pomoc przed logowaniem                             | Decyzja usera — Pomoc za logowaniem                                                                                                                                                                 |
| Wersjonowanie treści per wydanie, tłumaczenia                | YAGNI                                                                                                                                                                                               |
| Staging jako osobne środowisko, skrypt zakładania kont       | Bezprzedmiotowe — środowisko robocze (`wyceny-mu`) **jest** stagingiem; produkcja pojawi się po pierwszym etapie z klientem i będzie wdrażana ręcznie                                               |
| Prowenancja per pole, panel „Skąd te dane"                   | Wykreślone z roadmapy 2026-07-27; potrzebę „skąd to wiemy" przejmuje ten slice                                                                                                                      |

## S7 — obowiązkowy (nie opcjonalny)

Do `references/docs-update-checklist.md` w skillu `build-slice` (wiki repo) dochodzi krok: _„Czy ten slice zmienił coś, co opisuje moduł Pomoc (ekrany, przepływy, stałe, źródła danych)? Jeśli tak — zaktualizuj odpowiednie strony MDX, odśwież dotknięte zrzuty i wypisz zmienione strony w raporcie."_

To jest **jedyny mechanizm anty-dryfowy** tego slice'a i dlatego S7 nie jest opcjonalny.

## Ryzyka i kwestie otwarte

| #   | Ryzyko                                                                                                                 | Mitygacja / status                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Stałe workera (Python) rozjadą się z wartościami w MDX                                                                 | Świadomie przyjęte. Mitygacja procesowa: krok S6. Jeśli rozjazd wystąpi realnie — wracamy do F-13 jako testu parytetu                                                                                                                            |
| R2  | Treść metodyczna opisuje reguły bez liczb (IQR-trim, przecięcia MPZP, vision LLM), których nie da się zacytować z kodu | Ceiling przyjęty: te fragmenty są prozą pisaną z odczytu kodu; przy zmianie algorytmu wyłapuje je krok S6                                                                                                                                        |
| R3  | Zrzuty zestarzeją się po slice'ie zmieniającym UI                                                                      | Krok S6 obejmuje odświeżenie zrzutów; wariant automatyczny (Playwright) świadomie odrzucony                                                                                                                                                      |
| R4  | Konto testowe (`@junatrans.pl`) może nie mieć dostępu do aplikacji wycen                                               | **Rozwiązane:** `apps/web/scripts/seed.ts` (`pnpm seed`) już zakłada konta idempotentnie przez wewnętrzny adapter Better Auth z tym samym hasherem co `signUpEmail`. Jeśli podane konto nie zadziała — zasiew konta testowego, bez pytania usera |
| R5  | Objętość: 15 stron treści to najwięcej pisania w dotychczasowych slice'ach                                             | Podział na fale z checkpointem; korekta kierunku po fali 1, zanim powstanie treść metodyczna                                                                                                                                                     |

**Nazewnictwo:** od tego slice'a środowisko `wyceny-mu.vercel.app` opisujemy w dokumentacji jako **staging**, nie „produkcja". Wcześniejsze slice'y (0–12) używają starego nazewnictwa — nie zmieniamy wstecz.

**Cruft do sprzątnięcia (poza slice'em):** projekt Vercel `wyceny-app` (założony 14 dni temu, preset „Services", brak komendy builda) wygląda na pomyłkę — kandydat do usunięcia.
