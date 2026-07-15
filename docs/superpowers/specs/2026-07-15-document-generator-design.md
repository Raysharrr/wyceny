# Spec — Slice 4: Generator dokumentu operatu (DOCX→PDF, F-12)

> Data: 2026-07-15 · Status: projekt zatwierdzony przez usera (brainstorm S1, checkpoint a); spec do recenzji
> Item roadmapy: wiki `wiki/roadmap.md` 🟢 NOW (promowany 2026-07-15) · `Must-Legal` (KSWN, AC-2)
> ADR-y wiążące: ADR-008 (maskowanie tajemnicy jako warstwa ACL), ADR-009 (ciężkie natywne operacje
> po stronie workera — tu: LibreOffice), ADR-010/012 (dokument tylko z wyceny po bramie F-4)
> Spike'i: `2026-06-05-dokument-path` (CLOSED), `2026-06-05-operat-e2e` (19/19 sekcji),
> **`2026-07-15-template-koscielna` (PASS z ograniczeniami — wiki-repo `tools/spike/`)** — szablon
> z REALNEGO operatu Anety działa: pętla 12 wierszy transakcji, komórki scalone (143 gridSpan /
> 12 vMerge) nietknięte, warunek `{#kredyt}` działa, wierność wizualna wysoka (render 28 vs 30 stron,
> czysty reflow LibreOffice, Calibri→Carlito).

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś po zatwierdzeniu wyceny rzeczoznawca dostaje pięciolinijkowy tekstowy stub — atrapę dokumentu.
Po tym slice dostaje **prawdziwy operat szacunkowy**, wyglądający jak dotychczasowe operaty Anety
(ten sam układ, tabele, klauzule — szablon powstał z jej realnego dokumentu).

Jak to wygląda w praktyce:

1. **Formularz wyceny** ma cztery nowe pola: cel wyceny (lista: sprzedaż / zabezpieczenie kredytu /
   informacyjny), numer KW, klient i data oględzin. To dane, które do tej pory nie były nigdzie
   zbierane, a bez których operat nie może powstać (trafiają m.in. na stronę tytułową). Wypełnione
   ręcznie = od razu „potwierdzone" w modelu prowenancji — jak dotąd.
2. **Klik „Zatwierdź"** działa jak dziś (brama F-4 sprawdza, czy wszystko potwierdzone i czy próba
   ma ≥12 transakcji), ale dodatkowo pilnuje nowych pól — jeśli czegoś brakuje, użytkownik widzi
   po polsku listę braków. Gdy wszystko gra, system w ~3 sekundy składa dokument i wycena staje
   się zatwierdzona. Zasada: **nie ma zatwierdzonej wyceny bez gotowego operatu** — jak generowanie
   zawiedzie (np. awaria konwertera), zatwierdzenie się nie udaje i można po prostu kliknąć ponownie.
3. **Na stronie wyceny** pojawia się podgląd PDF wprost w przeglądarce oraz przycisk pobrania DOCX.
   PDF służy do czytania i wysyłki, DOCX to zawór bezpieczeństwa: rzeczoznawca może dokument
   otworzyć w Wordzie i ręcznie poprawić — ale wtedy bierze to na swoją odpowiedzialność zawodową,
   bo system gwarantuje tylko to, co sam wygenerował z potwierdzonych danych.
4. **Szkic nie ma żadnego dokumentu.** Dokument to artefakt zatwierdzonych danych — jak wynik
   builda z kodu. Chcesz inny operat → zmieniasz dane i zatwierdzasz; nie edytujesz dokumentu
   w aplikacji (edytora webowego świadomie nie budujemy — rozjechałby dokument z danymi
   i unieważnił gwarancje bramy F-4).
5. **Tajemnica zawodowa jest maskowana automatycznie**: tabela transakcji porównawczych pokazuje
   tylko miesiąc (nie pełną datę), ulicę bez numeru, powierzchnię i cenę jednostkową — dokładnie
   tak, jak robi to Aneta ręcznie, zgodnie z wyrokiem SN. Pilnuje tego test w CI (F-12), więc
   regresja się nie prześlizgnie.
6. Sekcje, na które nie mamy jeszcze danych (proza o stanie technicznym, zdjęcia z oględzin,
   pełny stan prawny z KW), dostają neutralny tekst szablonowy — operat jest kompletny
   strukturalnie (≥19 sekcji), a te fragmenty wypełnią kolejne slice'y (oględziny, OCR KW, LLM).

Pod maską: dane wyceny są mapowane na model dokumentu i maskowane w web-aplikacji, dokument DOCX
składa sprawdzona w spike'ach biblioteka szablonów, a konwersję do PDF robi worker na Railway
(tam, gdzie może działać LibreOffice). Pliki lądują w bazie obok danych wyceny i są serwowane
z tą samą autoryzacją właściciela co dziś.

## 1. Outcome i Definition of Done

Z **zatwierdzonej** wyceny (po bramie F-4) powstaje kompletny operat szacunkowy (≥19 sekcji wg KSWN)
na bazie szablonu skonwertowanego z realnego operatu Anety (Kościelna): **PDF do podglądu
w przeglądarce + DOCX do pobrania**. Koniec stubu tekstowego. **F-12 wchodzi do CI.**

**DoD:**

- zatwierdzenie generuje DOCX+PDF **synchronicznie** i zapisuje w storage; niezmiennik:
  **zatwierdzony ⇔ ma operat** (błąd generowania = zatwierdzenie się nie udaje, wolno ponowić),
- strona wyceny: podgląd PDF inline (`<iframe>`) + link pobrania DOCX; autoryzacja właściciela
  jak dziś (`/api/docs/[key]`, F-8, ten sam 404 dla „nie ma" i „nie twoje"),
- formularz + 4 nowe pola: **cel wyceny** (select), **nr KW**, **klient**, **data oględzin** —
  ręczne = provenance `confirmed` (AI-first); brak któregokolwiek = blocker zatwierdzenia
  (pokrywa też stare szkice sprzed migracji),
- stub tekstowy znika z `createValuation` (create przestaje wołać workera); legacy dokumenty
  i ich URL-e działają bez zmian,
- F-12 w CI (sekcje + słownie + maskowanie — patrz §6), F-11 nienaruszone,
- deploy: worker z LibreOffice na Railway, web na Vercelu; weryfikacja live na danych Kościelnej
  (zatwierdzenie → prawdziwy PDF operatu).

## 2. Model produktowy

**Dane w formularzach = źródło prawdy. Dokument = generowany artefakt** (jak wynik builda):
zmiana treści operatu = zmiana danych + regeneracja, nigdy edycja artefaktu. Żadnego edytora
webowego dokumentu. Zawór bezpieczeństwa: rzeczoznawca pobiera DOCX i poprawia w Wordzie —
poza gwarancjami systemu, na własną odpowiedzialność zawodową (zgodne z „rzeczoznawca potwierdza
i podpisuje"). Szkic nie ma żadnego dokumentu (podgląd szkicu z watermarkiem — poza zakresem).
Po Slice 3 dane zatwierdzonej wyceny są zamrożone (`assertDraft`), więc dokument z momentu
zatwierdzenia nigdy się nie dezaktualizuje — regeneracja nie jest potrzebna.

## 3. Architektura przepływu

```
approve (server action, web)
  ├─ brama F-4 ✓ (bez zmian) + nowe blockery: brak celu / nr KW / klienta / daty oględzin
  ├─ buildDocumentModel(snapshot)        ← domain/, czysta funkcja TS:
  │     computeKcs(inputs) + maskowanie tajemnicy + mapowanie na model sekcji szablonu
  ├─ słownie: worker POST /amount-in-words     (istniejący endpoint; F-11 bez zmian)
  ├─ render DOCX: docxtemplater + angular-expressions     (adapter w web; czysty JS)
  ├─ PDF: worker POST /convert-to-pdf          (NOWY; soffice --headless w kontenerze Railway)
  └─ storage.put(pdf) + storage.put(docx) → status 'approved' + approved_at
```

- Granice F-10: model dokumentu i maskowanie w `apps/web/src/domain/`; docxtemplater, HTTP
  do workera i storage w `apps/web/src/adapters/`.
- Kolejność zapisu: najpierw oba pliki w storage, na końcu flip statusu (jak dziś, w akcji);
  częściowy zapis przy błędzie jest nieszkodliwy (klucze per wycena, nadpisywane przy ponowieniu).
- Czas: render ~0,2 s + konwersja ~1–3 s — mieści się w akcji serwerowej; w planie sprawdzić
  `maxDuration` funkcji Vercel dla akcji zatwierdzenia (ustawić z zapasem, np. 60 s).

## 4. Dane i storage

- `valuation` +4 kolumny: `purpose` (enum tekstowy, na start: `sprzedaz` | `zabezpieczenie_kredytu` |
  `informacyjny` — Kościelna to `sprzedaz`, więc weryfikacja live pokrywa tę ścieżkę),
  `kw_number` text, `client` text, `inspection_date` date — **migracja 0008, addytywna, nullable**
  (zero-downtime; najpierw migracja, potem deploy). Pola wymagane w formularzu create; dla starych
  szkiców ich brak = blocker zatwierdzenia (lista blockerów, nie wyjątek).
- `purpose = zabezpieczenie_kredytu` steruje warunkiem `{#kredyt}` (klauzula kredytowa) —
  mechanizm sprawdzony w spike'u.
- **Storage zostaje w Postgresie**: `document` + kolumny `content_bytes` (bytea, nullable)
  i `content_type` text; stare stuby zostają w `content` (text). Port `put/get` bez zmian dla
  wywołujących (Buffer już jest w sygnaturze). Vercel Blob świadomie odłożony — furtka portowa
  zostaje (docstring portu aktualny). Skala: ~100–500 KB/plik, dwa pliki na wycenę.
- Wycena dostaje dwa dokumenty: `doc_url` = PDF (główny, podgląd), nowa kolumna `docx_url` = DOCX
  (pobranie). Route `/api/docs/[key]` serwuje wg `content_type` (PDF → `inline`, DOCX →
  `attachment`, legacy `text/plain` bez zmian).
- `amountInWords` przestaje być zasilane przy create (słownie pobierane w momencie generowania);
  kolumna do wygaszenia przy następnej migracji reshape razem z rename `stub_wr`→`wr` (backlog).

## 5. Szablon produkcyjny

Punkt wyjścia: szablon ze spike'a `2026-07-15-template-koscielna` (skonwertowany
`operat-koscielna.docx`). Do produkcji szablon przechodzi **scrubbing i dokończenie parametryzacji**
(skryptowo, wg wzorca `convert.py` ze spike'a — kotwiczenie pozycyjne, NIE globalny find-replace,
bo te same literały pełnią różne role; wynik = commitowany artefakt `.docx` w app-repo):

- dokończyć placeholdery: **adres** (w spike'u pozostał literałem), dane rzeczoznawcy (PROF —
  z konta usera), daty, powierzchnia wszędzie tam, gdzie występuje w innych formatach,
- **PII precz**: dumpy eKW zawierają PESEL-e i nazwiska właścicieli — sekcja stanu prawnego
  zostaje zredukowana do bloku z `{nr_kw}` + neutralna adnotacja („pełny odpis KW — dokument
  źródłowy rzeczoznawcy"); **F-9 (skan PESEL w CI) automatycznie pilnuje**, że commitowany szablon
  jest czysty; nazwa pliku szablonu nie może wpaść w skan nazw F-9 (np. `operat-template.docx` —
  zweryfikować wzorce skryptu w planie),
- **usunąć zdanie o r²** z metodologii (silnik go nie liczy — nie deklarujemy, czego nie robimy;
  flaga compliance ze spike'a template-seed),
- usunąć zdjęcia property-specific (fotografie z oględzin, wycinki map — źródła OGL/MAP jeszcze
  nie istnieją); sekcje, które się na nie powołują, dostają neutralny tekst; dynamiczne obrazy =
  LATER (razem z oględzinami),
- 3 sekcje prozy (8.1 położenie, 8.3 stan techniczny, 11 analiza rynku): neutralny tekst
  szablonowy z dostępnych danych (LLM zaparkowany na LATER/P5),
- boilerplate (11 klauzul, metodologia KCS, opisy Poznania/obrębów, podstawy prawne) — z seedu
  spike'a template-seed; akty Dz.U. hardcode (aktualizacja = zmiana szablonu),
- techniczne (ze spike'a): placeholdery run-level tam gdzie się da (zachowują taby/pogrubienia),
  collapse tylko w prozie; nbsp jako separator tysięcy zachowywany; delimitery domyślne `{ }`
  bezpieczne; wyrównać `trHeight` wiersza-szablonu pętli transakcji.

## 6. Maskowanie tajemnicy i F-12 w CI

Definicja F-12 (architecture-recommendation, AC-2 §12.2): **≥19 wymaganych sekcji bez pustych
dziur + kwota słownie poprawna + maskowanie tajemnicy zawodowej** (wyrok SN II CSK 369/11).

Maskowanie — w `buildDocumentModel` (czysta funkcja, domain):

- data transakcji porównawczej → tylko **miesiąc** (`RRRR-MM`), pełna data nigdy nie opuszcza modelu,
- ulica **bez numeru** (gdy obecna w danych; próba z RCN dziś nie niesie ulicy — kolumna z tym,
  co mamy), `transactionId` z RCN nigdy w modelu dokumentu,
- w tabeli porównawczej wyłącznie: miesiąc, miasto, ulica bez numeru, powierzchnia, cena
  jednostkowa (dokładnie kształt Tabeli 1 realnego operatu).

Testy w CI (wszystkie bez sieci):

1. **Maskowanie** (vitest, unit): pełna data / `transactionId` / numer domu nie występują w modelu
   dokumentu dla danych syntetycznych z pełnymi datami i identyfikatorami.
2. **Kompletność sekcji** (vitest, integracja): render golden-danymi (docxtemplater w czystym JS)
   → unzip DOCX → kanoniczna lista ≥19 nagłówków sekcji obecna, żadna sekcja pusta.
3. **Anty-literał** (vitest): render danymi syntetycznymi ≠ Kościelna → literały Kościelnej
   (adres, nr KW, daty, WR, nazwisko klienta) NIE występują w tekście — łapie niedokończoną
   parametryzację szablonu (główna pułapka ze spike'a).
4. **Słownie**: golden num2words już w pytest workera (bez zmian); test renderu asseruje, że
   przekazane słownie ląduje w treści dokumentu.
5. **Konwersja PDF** (pytest, worker): `soffice` lokalnie w CI (runner ubuntu ma LibreOffice —
   zweryfikować w planie; jak nie, instalacja w jobie) — DOCX wejściowy → PDF niepusty, poprawny
   nagłówek `%PDF`.

## 7. Worker

- Nowy endpoint `POST /convert-to-pdf`: przyjmuje DOCX (multipart lub base64 — rozstrzygnięcie
  w planie), zwraca PDF. Jedna odpowiedzialność: `soffice --headless --convert-to pdf` (tempdir,
  timeout, sprzątanie).
- **F-11 nietknięte**: WR w treści przesyłanego dokumentu to dana wejściowa (jak `amount`
  w `/amount-in-words`); worker niczego nie liczy i nie zwraca żadnego pola WR. Istniejące testy
  F-11 bez zmian; test nowego endpointu: response to bajty PDF, nie JSON z danymi.
- Obraz Railway: LibreOffice + **fonty Carlito** (`fonts-crosextra-carlito` — substytut metryczny
  Calibri; bez tego layout się rozjedzie) — konfiguracja w `apps/worker` (nixpacks/Dockerfile,
  rozstrzygnięcie w planie).
- Hardening endpointów workera (rate-limit/shared-secret) — pozostaje w backlogu, bez zmian
  w tym slice (spójnie z istniejącymi endpointami).

## 8. UI

- Formularz create: 4 nowe pola (select celu + 3 pola tekstowe/date), walidacja zod, RHF —
  wzorce jak istniejące pola; provenance nadawane server-side na ACL (jak w Slice 3).
- Strona detalu wyceny: dla `approved` — `<iframe>` z PDF + link „Pobierz DOCX"; dla szkicu —
  bez sekcji dokumentu (znika dzisiejszy link do stubu); legacy zatwierdzone bez PDF pokazują
  to, co mają (stary link tekstowy).
- Lista blockerów zatwierdzenia rozszerzona o brakujące pola (copy po polsku, jak blockery F-4).

## 9. Poza zakresem (nie budować)

Edytor webowy dokumentu · podgląd szkicu z watermarkiem · LLM-proza (LATER/P5) · EGiB/MPZP
(NEXT, spike-first) · oględziny/cechy per typ + zdjęcia w dokumencie (NEXT/OGL) · OCR KW (P4) ·
Vercel Blob · wierność pixel-perfect z Wordem (reflow LibreOffice zaakceptowany) · regeneracja
dokumentu na żądanie · podpis/F-7 (kolumna `signed` zarezerwowana, bez zmian).

## 10. Ryzyka

| Ryzyko                                                                        | Mitygacja                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Niedokończona parametryzacja szablonu (literały Kościelnej w cudzym operacie) | test anty-literał w F-12 (§6.3)                                          |
| PESEL/PII w commitowanym szablonie                                            | scrubbing §5 + F-9 (skan PESEL) łapie w CI                               |
| soffice/fonty w kontenerze Railway inne niż lokalnie                          | task deployowy z weryfikacją E2E na prodzie; Carlito w obrazie           |
| czas generowania > limit akcji serwerowej                                     | `maxDuration` z zapasem + pomiar w weryfikacji live                      |
| LibreOffice w CI (GH runner) niedostępny/wolny                                | fallback: instalacja apt w jobie workera; test konwersji tylko tam       |
| duże pliki w Postgresie                                                       | świadomie zaakceptowane przy tej skali; furtka portowa na object storage |
