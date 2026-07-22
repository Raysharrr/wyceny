# Slice 10 — Oględziny: zdjęcia + notatka (FR-2) — design

Data: 2026-07-22 · Status: zaakceptowany na checkpoincie (a) · Poprzednik: Slice 9 (mapy WMS)
Źródła: wiki `roadmap.md` (NOW), wiki `topics/tech/obrazy-w-operacie-koncepcja.md` §5.2,
badanie 10 referencyjnych operatów Anety (raw/documents, 2026-07-22), brainstorm 2026-07-22
(7 rozstrzygnięć usera + benchmark oryginału).

## Opis produktowy — co budujemy z perspektywy użytkownika

Oględziny to jedyny z założenia ręczny krok w AI-first przepływie wyceny: rzeczoznawca musi
pojechać, obejrzeć i sfotografować. Dziś aplikacja nie ma gdzie tych zdjęć przyjąć — sekcja
fotograficzna operatu to stub „zostanie uzupełniona po oględzinach", który w zatwierdzonym
dokumencie po prostu wisi. Ten slice domyka pętlę: zdjęcia z telefonu trafiają do operatu
dokładnie tam, gdzie kładzie je Aneta w prawdziwych operatach.

Rzeczoznawca po oględzinach otwiera **szkic operatu** i widzi nową kartę **„Oględziny"**
z trzema sekcjami zdjęć — **otoczenie i droga dojazdowa**, **budynek z zewnątrz**,
**wnętrza** — oraz polem na **notatkę z oględzin**. Wrzuca zdjęcia wprost z telefonu
(iPhone sam odda JPEG-i); każde zdjęcie jest od razu pomniejszane i czyszczone z metadanych
(GPS, model urządzenia — RODO), po czym ląduje na stałe przy wycenie. Miniatury widać od
razu, pomyłkę usuwa się jednym kliknięciem. Limity są policzone z realnych operatów Anety
(2–26 zdjęć na blok, ~42 łącznie w Kościelnej): **do 50 zdjęć na wycenę**, bez sztywnych
kwot per sekcja.

W wygenerowanym operacie zdjęcia pojawiają się **wiernie jak w oryginale**: blok drogi
dojazdowej i otoczenia w §8.1 (za mapami), blok budynku po „Opisie budynku" w §8.3, blok
wnętrz po „Opisie lokalu" w §8.3 — każdy wprowadzony stałym zdaniem Anety („Poniżej
przedstawiono dokumentację fotograficzną…"), bez podpisów pod pojedynczymi zdjęciami,
bo oryginały ich nie mają. Notatka renderuje się jako krótki blok „Uwagi z oględzin"
w §8.3. Operat **bez** zdjęć nie wybucha i niczego nie udaje: puste bloki po prostu się
nie renderują (stub znika z szablonu na dobre), a formularz uczciwie ostrzega na
pomarańczowo, że dokumentacji fotograficznej brak. Zdjęcia to własna praca rzeczoznawcy —
żadnego „potwierdź swoje zdjęcia" nie ma; sam upload jest aktem decyzji.

**Pod maską:** plik idzie z przeglądarki wprost do workera (wzorzec KW ze Slice 6 — token
HMAC, limit Vercela ominięty), worker robi transpozycję orientacji EXIF → resize do 1200 px
→ re-encode JPEG q85 (re-encode z natury gubi wszystkie metadane), przetworzone bajty
wracają i są zapisywane do tej samej tabeli co mapy i dokumenty; manifest kluczy żyje we
write-once `inputs`, więc zatwierdzenie i podpis renderują z dokładnie tych samych bajtów
(determinizm map ze Slice 9 rozszerzony na zdjęcia za darmo). Zero migracji DDL, zero
nowych sekretów; jedna nowa zależność workera (Pillow).

## Outcome / DoD

**Outcome:** 3 sekcje zdjęć z realnym uploadem + notatka z oględzin; sekcja foto operatu
przestaje być stubem. `Must-Viable`.

**DoD (z roadmapy):** operat na prodzie ze zdjęciami z realnego uploadu; EXIF strip
dowiedziony testem; F-1 (golden 1 044 400) / F-7 (triggery) / F-12 nietknięte poza
rozszerzeniem nogi medialnej.

## Rozstrzygnięcia brainstormu (user, 2026-07-22)

1. **Limity:** cap **łączny 50 zdjęć** na wycenę, bez limitów per sekcja (benchmark:
   oryginał Kościelnej 2/14/26 = 42; pozostałe operaty 38–57 mediów). Plik wejściowy
   ≤ 10 MB, JPEG/PNG.
2. **Obróbka:** resize do **1200 px** dłuższy bok (tylko downscale), wyjście **zawsze
   JPEG q85** (PNG z alfą spłaszczany na białym); ~150–250 KB/szt → operat z 42 zdjęciami
   ≈ 7–10 MB.
3. **EXIF:** strip zawsze, worker-side, przez re-encode (Pillow gubi metadane z natury);
   `ImageOps.exif_transpose` PRZED stripem (inaczej zdjęcia z telefonu leżą na boku).
   Bez pillow-heif — formaty bramkuje `accept="image/jpeg,image/png"` (iOS Safari sam
   transkoduje HEIC→JPEG przy takim accept).
4. **Prowenancja:** bez bramki F-4 — zdjęcia i notatka to ręczny wkład = `confirmed`
   z automatu (jak każdy ręczny wpis; potwierdzanie własnych zdjęć byłoby ceremonią).
5. **Miejsce w operacie:** wiernie jak oryginał — otoczenie → §8.1 po mapach; budynek →
   §8.3 po opisie budynku; wnętrza → §8.3 po opisie lokalu; stałe zdania wprowadzające,
   zero podpisów per zdjęcie; notatka jako warunkowy blok „Uwagi z oględzin" w §8.3.
6. **Brak zdjęć:** uczciwa cisza + amber hint w formularzu (wzorzec próby <12); stub
   „Dokumentacja fotograficzna…" znika z szablonu; zero blockera (`inspectionDate` już
   dziś pilnuje, że oględziny się odbyły).
7. **Task 0:** oba follow-upy Slice 9 — guard `mapSeq` na podglądzie map + dedup zdania
   stubu w §8.1 (realizuje się naturalnie przez usunięcie `STUB_FOTO`).

## Model danych (definiuje ten slice)

```
inputs.inspection = {
  note: string | null,
  photos: {
    otoczenie:   string[],   // klucze w tabeli document, kolejność = kolejność uploadu
    budynekZewn: string[],
    wnetrza:     string[],
  },
} | null   // null = sekcja nietknięta (wzorzec inputs.subject / inputs.kw — zero DDL)
```

- **Klucz zdjęcia:** `ogledziny-{sekcja}-{uuid}-{valuationId}.jpg` — stabilny per zdjęcie
  (usunięcie ze środka nie przenumerowuje; lekcja osieroconych kluczy ze Slice 9).
- **Manifest jest load-bearing:** `PortStorage` ma tylko `put/get/delete` (bez listowania) —
  komplet kluczy MUSI pochodzić z `inputs.inspection`; sign czyta manifest z zamrożonych
  `inputs` i pobiera bajty per klucz.
- **Wersjonowanie (Slice 8):** „Utwórz nową wersję" kopiuje `inputs` z manifestem —
  odziedziczone zdjęcia wskazują klucze STAREJ wyceny. Usunięcie odziedziczonego zdjęcia
  w v2 usuwa tylko wpis z manifestu; `storage.delete` wykonujemy **wyłącznie dla własnych
  kluczy** (klucz zawiera `valuationId`). Podpisana v1 nietknięta (jej artefakty i tak są
  wyrenderowane i zamrożone).

## Architektura

### Worker — nowy endpoint `POST /photo-process`

Wzorzec `/kw-extract` (`main.py:367`): multipart `file` + `token` (HMAC `verify_token`
z `kw.py`, sekret `WORKER_SHARED_SECRET`, TTL 300 s). Kody: 401 zły/wygasły token,
415 content-type ∉ {image/jpeg, image/png} (oraz Pillow decompression-bomb guard →
415/422), 413 > 10 MB. Obróbka (Pillow — **nowa zależność**, manylinux wheel, Dockerfile
bez zmian): `Image.open` → `ImageOps.exif_transpose` → downscale do max 1200 px dłuższy
bok (nigdy upscale) → RGB (alpha na białym) → `save(JPEG, quality=85)` bez exif.
Response JSON `{photo: base64 JPEG, width, height}` (wzorzec `/map-proposal`). Plik nigdy
nie persystowany (wzorzec KW). **F-11:** endpoint nie zwraca żadnej wartości rynkowej.

### Web — server actions (owner-only, draft-only, audit w tx)

- `addInspectionPhoto(valuationId, section, bytes)` — walidacja trust-boundary (patrz
  Bezpieczeństwo), cap 50 z manifestu → `storage.put` → tx: append do
  `inputs.inspection.photos` + audit; fail tx → kompensacyjny `storage.delete`.
- `removeInspectionPhoto(valuationId, section, key)` — tx: usunięcie z manifestu + audit;
  `storage.delete` tylko gdy klucz własny.
- `saveInspectionNote(valuationId, note)` — tx: `inputs.inspection.note` + audit.

**Audyt:** jedna nowa akcja w zamkniętej liście `AUDIT_ACTIONS`: **`inspection_updated`**
z `meta {op: photo_added|photo_removed|note_updated, section?, total?}` — żadna istniejąca
akcja nie pasuje (F-7: każda mutacja w tx z audytem); triggery NIETKNIĘTE. Do walidacji
w advisor-review planu.

### Web — UI: karta „Oględziny" na stronie operatu (szkic, właściciel)

Trzy pod-sekcje z `<input type="file" multiple accept="image/jpeg,image/png">`; per plik:
mint token (wzorzec `mint-kw-token.ts`) → POST `/photo-process` → server action; upload
sekwencyjny z progresem. Miniatury z istniejącego `/api/docs/{key}` (autoryzacja
właściciela z Slice 0), usuń per zdjęcie, licznik X/50, textarea notatki z zapisem.
Amber hint „operat bez dokumentacji fotograficznej" przy 0 zdjęć. Kill-switch
`NEXT_PUBLIC_PHOTO_UPLOAD !== "off"` chowa upload (notatka zostaje — nie wymaga workera).
Karta widoczna tylko w szkicu; po zatwierdzeniu zdjęcia są w dokumencie.

### Render — approve i sign

- **`docx-render.ts`:** `opts` rozszerzone o `photos?: {otoczenie: Buffer[]; budynekZewn:
Buffer[]; wnetrza: Buffer[]} | null`. Model dostaje pętle obiektów-markerów
  (`foto_otoczenie: [{img: "foto-otoczenie-0"}, …]` — kontrakt Slice 8: wartość tagu MUSI
  być stringiem) + `uwagi_ogledzin`. `getImage` dispatchuje po tagValue (mapa
  marker→Buffer); **`getSize` liczy wymiary z nagłówka JPEG (SOF) i skaluje
  z zachowaniem proporcji do max boxa 600×450** — telefonowe portrety nie mogą być
  rozciągnięte jak stałe boxy map.
- **`approve-valuation.ts`:** czyta manifest → `storage.get` per klucz → render z `photos`;
  brak klucza przy approve = twardy błąd (niespójność manifestu — delete utrzymuje
  manifest, więc nie powinna wystąpić).
- **`sign-valuation.ts`:** manifest z zamrożonych `inputs`; `StorageNotFoundError` dla
  klucza z manifestu = **abort podpisu** (świadoma różnica vs mapy: mapy mogły legalnie
  nie istnieć — skipMaps; zdjęcie w manifeście MUSI się rozwiązywać). Zero kontaktu
  z workerem przy sign.

### Szablon — nowy etap `build_template.py` (wiki-repo, F-12)

Nowy etap za etapem map (Stage 12), kotwice pozycyjne z asercją `hits==1` per blok:

- **§8.1** (kotwica: akapit `STUB_FOTO`): `{#ma_foto_otoczenie}` zdanie „Poniżej
  dokumentacja fotograficzna drogi dojazdowej oraz bezpośredniego otoczenia, wg stanu
  aktualnego:" + pętla `{#foto_otoczenie}{%img}{/foto_otoczenie}` `{/ma_foto_otoczenie}`.
  `STUB_FOTO` usunięty (naprawia też duplikat z `MAP_STUB` — task 0b; stub kartograficzny
  `{^mapy}` zostaje, decyzja Slice 9).
- **§8.3 budynek** i **§8.3 wnętrza**: analogiczne bloki za prozą „Opis budynku" /
  „Opis lokalu", ze stałymi zdaniami Anety.
- **Uwagi z oględzin:** `{#ma_uwagi}` „Uwagi z oględzin:" + `{uwagi_ogledzin}` `{/ma_uwagi}`
  po bloku wnętrz.
- Reguły twarde: tagi sekcji w OSOBNYCH akapitach; `{%img}` NIGDY w jednym `w:t` z tagami
  sekcji (lekcja Slice 8); `keepNext` na zdaniach wprowadzających; NBSP przez Python I/O;
  zmiana szablonu UNCOMMITTED do S6 PR.

### F-12 — noga medialna rozszerzona

Warianty: bez zdjęć (media jak dziś: 2 mapy / 3 signed / 0 bez map) i z N zdjęciami
(media = mapy + N (+1 signed)); bajty niepuste, magic bytes JPEG/PNG, relacje w
`document.xml.rels` się rozwiązują, `Buffer.equals` approve↔sign dla zdjęć. Test tekstowy
jest ślepy na obrazy — noga medialna pozostaje jedyną bramą. Strukturalny strażnik XML
(wzorzec Slice 7): tagi pętli foto w osobnych `<w:p>`, asercje w builderze.

## Bezpieczeństwo / compliance

- **Trust boundary — nowość vs mapy:** przetworzone bajty przychodzą od KLIENTA (nie
  z serwera), więc server action MUSI walidować serwerowo: magic bytes JPEG (FF D8 FF),
  **brak segmentu APP1/EXIF** (skan markerów do SOS — gwarancja RODO niezależna od
  klienta), rozmiar ≤ 2 MB po obróbce, wymiary ≤ 1200 px (ten sam util SOF co `getSize`).
  Złośliwy klient nie może wstrzyknąć zdjęcia z GPS do operatu.
- **RODO:** EXIF strip zawsze; zdjęcia wnętrz mogą być daną osobową — bajty wyłącznie
  w Postgresie (wzorzec skanu podpisu); zero retencji plików w workerze.
- **F-9:** zdjęcia testowe WYŁĄCZNIE syntetyczne, generowane w locie (Pillow/mały bufor
  JPEG w teście) — zero realnych fotografii, zero literałów base64 w fixture'ach
  (11-cyfrowe ciągi!); KW tylko `PO1P/1/6`.
- **F-7:** triggery bez zmian; wszystkie mutacje w tx z audytem.

## CI / e2e / deploy

- **Flaga:** `NEXT_PUBLIC_PHOTO_UPLOAD: "off"` w `ci.yml` (job e2e) i
  `playwright.config.ts` (wzorzec `NEXT_PUBLIC_KW_UPLOAD`) — e2e network-free.
- **Worker:** `uv add pillow` (uv.lock; Dockerfile bez zmian), pytest: EXIF strip
  (syntetyczny JPEG z GPS → wynik bez APP1), orientacja (Orientation=6 → swap wymiarów),
  resize/no-upscale, PNG alpha → białe tło, 401/413/415. Deploy:
  `railway up ./apps/worker --path-as-root --service worker-v2`.
- **Web:** vitest akcji (cap, ownership przy delete, draft-only, odrzuty trust-boundary),
  render (proporcje portretu, sekcje warunkowe, abort przy braku klucza), RTL karty
  (pragma jsdom, harness `rtl-kw-section`, `.findLast()` na mock.calls). Zero nowych
  sekretów, zero DDL. Per task: `pnpm turbo lint typecheck test build --env-mode=loose
&& pnpm depcruise`.

## Task 0 — follow-upy Slice 9

1. Guard `mapSeq` na fire-and-forget podglądu map (`new-valuation-form.tsx:258-265`) —
   wzorzec `fetchSeq`/`kwSeq` z tego samego pliku (stale-last-wins pokazuje mapy
   poprzedniego adresu).
2. Dedup zdania stubu §8.1 — realizowany przez usunięcie `STUB_FOTO` w etapie foto.

## Poza zakresem

Podpisy/opisy per zdjęcie (oryginały ich nie mają), surowy HEIC (pillow-heif), zmiana
kolejności zdjęć (kolejność = upload; usuń+wrzuć ponownie), galeria/lightbox, edycja
zdjęć po zatwierdzeniu, upload w `/valuations/new` (persist wymaga `valuationId`),
osobna sekcja miejsca postojowego (mieści się we wnętrzach), UI wizard (FR-13 — NEXT).

## Ryzyka

- **Rozmiar operatu:** 42 zdjęcia ≈ 7–10 MB DOCX — konwersja PDF (LibreOffice) wolniejsza;
  timeout `/convert-to-pdf` do przejrzenia w planie (dziś ~0,7 s dla 15 stron bez zdjęć).
- **Serial upload:** 40 zdjęć = 40 roundtripów browser→worker→action — sekwencyjnie
  z progresem; akceptowalne MVP (oględziny to czynność raz na wycenę).
- **Latencja approve:** odczyt ~50×250 KB z Postgresa + większy render — do zmierzenia
  w QA; bez wpływu na sign (te same bajty).
- **Moduł image (free):** media nazywane `image_generated_N.png` niezależnie od typu —
  quirk znany i zaakceptowany w Slice 9 (Word/LibreOffice sniffują magic bytes).
