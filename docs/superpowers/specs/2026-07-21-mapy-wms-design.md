# Slice 9 — Obrazy w operacie: mapy z WMS GUGiK — design

Data: 2026-07-21 · Status: zaakceptowany na checkpoincie (a) · Poprzednik: Slice 8 (F-7)
Źródła: wiki `roadmap.md` (NOW), wiki `topics/tech/obrazy-w-operacie-koncepcja.md`, spike
wiki-repo `tools/spike/2026-07-21-mapy-wms/` (PASS 4/4), brainstorm 2026-07-21
(6 rozstrzygnięć usera).

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś sekcja 8.1 operatu („Stan otoczenia") kończy się zdaniem „Dokumentacja fotograficzna
i kartograficzna zostanie uzupełniona po oględzinach" — mapa, którą każdy referencyjny operat
osadza jako integralną treść opisu nieruchomości, w naszym dokumencie w ogóle nie istnieje.
Ten slice sprawia, że operat sam ilustruje się mapami — bez jednego kliknięcia rzeczoznawcy.

Po auto-pobraniu danych przedmiotu (istniejący krok „Pobierz dane") rzeczoznawca widzi
w formularzu **podgląd dwóch map** wygenerowanych z geometrii jego działki: **mapę
ewidencyjną** (granice i numery działek, obrysy budynków — z państwowej ewidencji gruntów)
oraz **ortofotomapę** (zdjęcie lotnicze okolicy). Patrzy i wie, że wycinek pokazuje właściwą
nieruchomość — to jego wizualna weryfikacja, żadnego „potwierdź mapę" nie ma, bo mapa to
tylko obraz danych działki, które już potwierdził.

Przy **zatwierdzeniu operatu** aplikacja pobiera obie mapy raz jeszcze — z państwowego
geoportalu, na moment zatwierdzenia — i **zamraża je na zawsze** razem z dokumentem. W §8.1
operatu, zamiast stubu, pojawiają się: mapa ewidencyjna i ortofotomapa, każda z podpisem
„Źródło: Geoportal.gov.pl, dane pobrane {data zatwierdzenia}" (wymóg licencyjny darmowego
użycia danych GUGiK — i jednocześnie dokładnie ta data, w której dokument został utrwalony).
Podpisanie operatu (Slice 8) re-renderuje dokument z tych samych zamrożonych bajtów — treść
i mapy nie mają prawa drgnąć między zatwierdzeniem a podpisem.

Gdy państwowa usługa map akurat nie działa (zdarza się — udokumentowaliśmy to empirycznie)
albo działka nie ma geometrii (adres poza dzisiejszym pokryciem), zatwierdzenie nie wybucha
i nie blokuje pracy: rzeczoznawca dostaje wybór — **ponów pobranie** albo **świadomie
zatwierdź bez map**. Druga ścieżka zostawia w operacie uczciwy stub „do uzupełnienia",
a w dzienniku zdarzeń ślad, że to była jego decyzja — brak map w dokumencie prawnym nigdy
nie jest cichy.

**Pod maską:** mapy pobiera worker (ten sam, który już rozmawia z GUGiK o dane działki) przez
darmowe, bezautoryzacyjne WMS: ortofotomapa PZGiK + ewidencja KIEG, wycinek liczony
z geometrii działki (ULDK), z automatycznym ponawianiem, bo usługa ORTO losowo zwraca 404;
web osadza obrazy w tym samym renderze DOCX co tekst (moduł image zwalidowany w Slice 8,
rozmiar per-tag); bajty map zamrażane są w tej samej tabeli co dokumenty; a rozszerzony
strażnik integralności pilnuje, że obrazy naprawdę są w pliku — plus operat z mapami waży
_mniej_ niż dzisiejszy bez map, bo przy okazji włączamy kompresję DOCX z backlogu Slice 4.

## Outcome / DoD

**Outcome:** §8.1 operatu na prodzie osadza automatycznie pobrane mapy (ewidencyjna + orto)
na żywych danych; podgląd map w formularzu; determinizm approve↔sign obejmuje media.

**DoD (z roadmapy):** operat na prodzie z dwiema mapami w §8.1 na żywych danych; F-12
rozszerzone o tagi map (noga medialna); F-11 nietknięte (worker tylko pobiera, nie renderuje
dokumentu); F-1 golden 1 044 400 nietknięty.

## Rozstrzygnięcia brainstormu (user, 2026-07-21)

1. **Determinizm:** hybryda — podgląd live w UI (nieutrwalany) + jedno zamrożenie bajtów przy
   approve; sign czyta wyłącznie zamrożone. Rozbieżność podgląd↔freeze akceptowana z definicji.
2. **Zakres:** 2 mapy (ewidencyjna + orto). Korekta do 3–4 po odpowiedzi Anety na H4 = nowe
   tagi + BBOX, mechanizm bez zmian.
3. **Cytowanie:** „Źródło: Geoportal.gov.pl, dane pobrane {data}", data = data zatwierdzenia
   (zero nowych pól). Korekta stylistyczna po M5 od Anety = zmiana w szablonie.
4. **Fallback:** „potwierdź brak map" (wzorzec MPZP) — ponów albo świadome zatwierdzenie bez
   map ze stubem w §8.1 i śladem w audycie. Nigdy twardy blocker, nigdy cicha utrata map.
5. **Prowenancja:** mapy poza modelem prowenancji — artefakt pochodny potwierdzonych danych
   działki; weryfikacja wizualna w podglądzie.
6. **DEFLATE:** wchodzi w ten slice (0,88 MB z mapami < 1,24 MB dziś bez map).

## Architektura (Opcja A z koncepcji, potwierdzona spikiem)

### Worker — nowy endpoint `POST /map-proposal`

Wzorzec `/subject-proposal` (`apps/worker/app/main.py`): body `{address}`, sync handler,
bez auth (jak subject/convert), CORS jak dziś. Łańcuch:

1. `geocode_address` (UUG, istnieje) → `(x, y)` EPSG:2180 + gate pokrycia (Poznań, jak subject).
2. `fetch_parcel_by_xy` → id działki; `fetch_parcel_wkt(id, 2180)` (istnieje) → shapely
   `.bounds` → BBOX 4:3 wokół centrum: ewidencyjna half-width `max(125 m, 1.5×span)`,
   orto 2× ewidencyjna (stałe strojone w jednym miejscu).
3. 2× WMS `GetMap` 1800×1350 px: KIEG (`dzialki,numery_dzialek,budynki,obreby`, PNG) i ORTO
   (`Raster`, **JPEG** — 6× mniejszy od PNG dla fotografii).
4. Response JSON: `{ewidencyjna: base64 PNG, orto: base64 JPEG, parcelId}` (spójne z JSON-owym
   wzorcem subject-proposal; rozmiar ~1 MB base64 — akceptowalny).

**Kontrakty sieciowe (empiryczne, spike):** retry do 5 prób × 2 s backoff na 404/5xx (ORTO
losowo zwraca 404, ~12–30%, więcej pod burstem); `follow_redirects` (KIEG 302 na mirrory
`integracja01/02`); WMS 1.3.0 + EPSG:2180: `BBOX=minN,minE,maxN,maxE`, `WIDTH`=oś easting;
WKT ULDK ma pary `(easting northing)`. Brak nowych sekretów (WMS bezautoryzacyjny).

**F-11:** endpoint nie zwraca żadnej wartości rynkowej — tylko obrazy i id działki.

### Web — podgląd (sekcja przedmiotu)

Po udanym auto-fetchu przedmiotu web woła `/map-proposal` i pokazuje obie mapy
(`<img src="data:...">`, bez zapisu). Błąd/timeout podglądu = nieinwazyjny komunikat
(„podgląd map niedostępny") — podgląd nie jest bramką niczego.

### Web — approve (zamrożenie) i sign (odczyt)

**`approve-valuation.ts`:** przed renderem woła worker `/map-proposal` → bajty do tabeli
`document` (istniejąca, `content_bytes` bytea): klucze **`mapa-ewidencyjna-{valuationId}`**,
**`mapa-orto-{valuationId}`** → render z `opts.maps = {ewidencyjna, orto}` → dalej jak dziś
(pliki najpierw, status na końcu — ADR-012). Fetch map FAIL → akcja zwraca błąd z dwiema
opcjami w UI: „Ponów" / „Zatwierdź bez map (świadomie)"; druga ścieżka = approve z flagą,
ślad w audycie (istniejąca akcja approve; szczegół — czy metadane wpisu, czy nowa akcja
w zamkniętej liście `AUDIT_ACTIONS` — rozstrzyga plan po przejrzeniu domeny F-7).

**`sign-valuation.ts`:** czyta oba klucze z `document`; zero kontaktu z WMS. Brak kluczy
(operat zatwierdzony bez map) → render bez map — deterministycznie ta sama treść co przy
approve.

**`docx-render.ts`:** `renderOperatDocx(model, opts?: { signature?, maps? })`. Model dostaje
markery-stringi (kontrakt Slice 8: wartość tagu MUSI być stringiem): `mapa_ewidencyjna`,
`mapa_orto`, `mapy_data` oraz `mapy` (bool sekcji warunkowej). `getImage(tagValue, tagName)`
i `getSize(..., tagName)` dispatchują po tagName: mapy **600×450 px**, podpis 170×57
(potwierdzone empirycznie w spike'u). `generate({compression: "DEFLATE"})`.

### Szablon — nowy etap `build_template.py` (F-12)

Wyłącznie przez `build_template.py` (wiki-repo, `tools/spike/2026-07-15-template-koscielna/`),
nowy etap za etapem 11, z asercją `hits==1` na kotwicy „Charakterystyka bezpośredniego
otoczenia zostanie uzupełniona po oględzinach." Za akapitem kotwicy sekcja warunkowa:

- `{#mapy}` nagłówek „Mapa ewidencyjna:" + akapit `{%mapa_ewidencyjna}` + podpis źródła
  - „Ortofotomapa:" + `{%mapa_orto}` + podpis źródła `{/mapy}`
- `{^mapy}` stub „Dokumentacja kartograficzna zostanie uzupełniona." `{/mapy}`

Akapity nagłówków i map z `keepNext` (spike: podpis źródła spłynął na następną stronę).
Tagi obrazów w osobnych akapitach — NIGDY w jednym `w:t` z tagami sekcji (lekcja Slice 8:
`Raw tag not in paragraph`). Diff szablonu → wiki przy S6.

### F-12 — nowa noga medialna + strażnik dryfu

1. **Noga medialna** (wzór: PoC `assertMediaLeg` ze spike'a): po renderze z mapami
   `word/media/image_generated_*` — liczba zgodna z wariantem (approve z mapami: 2; signed: 3;
   bez map: 0), bajty niepuste, magic bytes ∈ {PNG, JPEG}, każdy `Target` w
   `word/_rels/document.xml.rels` się rozwiązuje. Dowiedzione w spike'u, że test tekstowy jest
   ślepy na obrazy — noga medialna jest jedyną bramą.
2. **Strażnik dryfu approve↔sign rozszerzony o media:** bajty map w signed identyczne
   z approved (podpis dodaje dokładnie jedno medium).
3. **DEFLATE:** test rozmiaru (operat z mapami < progu, np. 1,2 MB) jako kanarek regresji
   kompresji.

**Znany quirk (świadoma akceptacja):** moduł image hardcoduje nazwę medium
`image_generated_N.png` — bajty JPEG orto lądują w pliku o rozszerzeniu .png. Word/LibreOffice
sniffują magic bytes; konwersja do PDF zweryfikowana w spike'u. Alternatywa (konwersja do PNG
w workerze) = 6× rozmiar — odrzucona.

## Bezpieczeństwo / compliance

- Licencja GUGiK: „Brak opłat" w GetCapabilities obu usług; jedno zapytanie per zatwierdzenie
  to nie harvesting; wymóg cytowania spełnia podpis źródła z datą (koncepcja §2.3).
- RODO: mapy nie zawierają danych osobowych (orto 10–25 cm GSD, ewidencja to dane publiczne).
- F-7 nietknięte: żadnych zmian triggerów; approve-bez-map audytowane w tx jak każda mutacja.
- F-9: fixture'y testowe map syntetyczne (wygenerowane PNG/JPEG), zero realnych adresów poza
  golden case; KW wyłącznie `PO1P/1/6`.

## Poza zakresem

Mapy miasto/dzielnica (H4), wycinek MPZP jako obraz, zdjęcia z oględzin (FR-2), podziałka
skali, EGiB/geometria poza Poznaniem, wyróżnienie działki na mapie (obrys/marker), kompresja
starych dokumentów (zamrożone — nietykalne).

## Ryzyka

- **Flaky ORTO** — retry 5×/2 s (empirycznie skuteczny); resztkowa awaria → ścieżka
  „potwierdź brak" (z definicji nieblokująca).
- **Latencja approve** rośnie o łańcuch map (~3–9 s z retry) — akceptowalne dla akcji
  wykonywanej raz na wycenę; timeout web→worker do przejrzenia w planie.
- Staleness `docxtemplater-image-module-free@1.1.1` (xmldom CVE-2021-21366) — bez zmian od
  Slice 8: parsowany XML to nasz szablon, nie wejście atakującego.
