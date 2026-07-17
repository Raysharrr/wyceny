# Spec: Stan prawny (KW) — upload aktu/odpisu + ekstrakcja LLM (Slice 6)

- **Data:** 2026-07-17 · **Status:** zaakceptowany w brainstormie (checkpointy: werdykt spike'a ✅, zakres ✅, design 3 sekcje ✅)
- **Roadmapa:** 🟢 NOW „KW/akt notarialny: upload + ekstrakcja (spike-first)" — `Must-Legal`, jedyna luka Must-Legal kompletności dokumentu
- **Spike:** wiki-repo `tools/spike/2026-07-17-kw-ekstrakcja/` (RAPORT.md) — PASS: sonnet-5 (`thinking: disabled`) 4/4 na realnych próbkach; haiku FAIL; OCR-regex FAIL; pdftotext FAIL

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś rzeczoznawca wpisuje w formularzu wyceny jeden numer księgi wieczystej
„z pamięci" (najczęściej z kartki od klienta), a sekcja stanu prawnego
w gotowym operacie to numer plus adnotacja, że pełny odpis leży w dokumentacji
źródłowej. Tymczasem w praktyce klient najczęściej przynosi **akt notarialny**
(a czasem odpis księgi) — dokument, w którym są wszystkie dane, których operat
potrzebuje: numery obu ksiąg (lokalu i gruntu), powierzchnia użytkowa, udział
w nieruchomości wspólnej, sąd prowadzący księgi, a w odpisie dodatkowo stan
obciążeń (hipoteki, roszczenia).

Po tym slice'u rzeczoznawca w sekcji „Stan prawny (KW)" wybiera jedną z trzech
dróg: **wgrywa akt notarialny**, **wgrywa odpis księgi** albo — jak dotąd —
**wpisuje numer ręcznie**. Po wgraniu pliku system w kilkanaście sekund czyta
dokument (także skany i zdjęcia z telefonu — sprawdzone na realnych aktach)
i wypełnia formularz: dwa numery ksiąg, powierzchnię, udział, sąd, a z odpisu
także stan działów III i IV. Wszystko pojawia się jako **propozycje do
zweryfikowania** — z tym samym żółtym oznaczeniem, które rzeczoznawca zna
z próby RCN i danych ewidencyjnych — i niczego nie da się zatwierdzić, dopóki
człowiek tego nie potwierdzi. Jeśli w dokumencie jest inna powierzchnia niż
ta wpisana w formularzu, system pokaże obie i pozwoli wybrać.

Przypadek deweloperski system rozpoznaje sam: gdy lokal nie ma jeszcze własnej
księgi (kupno od dewelopera), formularz oznacza to jawnie — „lokal bez KW,
dane z księgi macierzystej" — zamiast zmuszać do wpisywania czegokolwiek na siłę.

W gotowym operacie sekcja badania stanu prawnego przestaje być stubem: zawiera
oba numery ksiąg, wynik badania działów III i IV (obciążenia hipoteczne
z nazwą banku i kwotą — bez danych osób prywatnych), a sekcja danych
ewidencyjnych zyskuje powierzchnię użytkową z dokumentu źródłowego i udział
w nieruchomości wspólnej w miejsce dotychczasowej adnotacji.

Ważna granica produktowa: **system nie przechowuje wgranego dokumentu**. Akt
zawiera PESEL-e i dane stron umowy — po odczytaniu pól plik jest odrzucany,
a do systemu trafia wyłącznie zminimalizowany wyciąg (numery, powierzchnia,
udział, instytucje). Dokumentacja źródłowa zostaje, jak dziś, w segregatorze
rzeczoznawcy.

Pod maską: przeglądarka wysyła plik bezpośrednio do workera (limit platformy
webowej nie przepuszcza realnych aktów — mają po kilkanaście MB), worker
za bramką HMAC woła model vision (Claude `sonnet-5`) ze schematem
wymuszającym kształt odpowiedzi bez pól na dane osobowe, scrubuje wynik
defensywnie i zwraca czysty ekstrakt; formularz nadaje mu prowenancję
`akt`/`odpis_kw` ze statusem `to_verify`, a brama zatwierdzenia (F-4) wymusza
ludzkie potwierdzenie jak dla każdego innego auto-pobranego pola.

## Outcome / Definition of Done

Sekcja badania KW przechodzi ze stubu-adnotacji na realne dane; trzy ścieżki
wejścia; model dwóch slotów KW + wariant deweloperski. DONE = na produkcji:

1. **Akt wtórny** (próbka Suchy Las): upload → ekstrakt (pow. 69,56, 3 KW,
   udział) → potwierdzenia → zatwierdzenie → operat z sekcją badania KW
   i pow./udziałem w 8.2.
2. **Akt deweloperski** (próbka 40-stronicowa, skan 150 DPI): upload →
   `kwLokalu=null` → banner „księga matka" w formularzu → wariant deweloperski
   w dokumencie.
3. **Odpis KW** (próbka merged I-O…IV): upload → działy III/IV z treścią
   wpisów (instytucje, bez osób) w operacie.
4. **Regresja:** wycena z ręcznym numerem KW działa jak dziś (fallback
   pełnoprawny); legacy operaty bez zmian.

Do prod DB nie trafia żaden PESEL ani nazwisko strony (weryfikacja SELECT-em
po QA).

## Zakres / poza zakresem

**W zakresie:** KwSourcePicker (3 źródła), endpoint ekstrakcji w workerze,
token HMAC web↔worker, model `inputs.kw`/`kwMeta` (zero DDL), prowenancja
grupy `kw` + blockery F-4, auto-fill powierzchni + warning rozbieżności,
banner deweloperski, sekcja badania KW + 8.2 w szablonie (F-12), RTL/component-test
infra, rozszerzenie F-9 o test scrubbingu.

**Poza zakresem (świadomie):** przechowywanie plików; per-pole badge/confirm
(makieta — later); panel rozbieżności KW↔EGiB (adnotacja wystarczy); płatne
API KW (KWAPI/Apify); wielodziałkowość EGiB (AC E2a — osobny styk); OCR
lokalny jako cross-check (opcja przyszłościowa, udokumentowana w spike'u);
limity budżetowe kosztu LLM.

## Architektura

```
Przeglądarka ── mintKwUploadToken() ──> web (server action, session-gated)
     │  <── token HMAC (TTL 5 min) ──┘
     │
     ├── POST /kw-extract (multipart: plik, token, expectedType) ──> worker (Railway)
     │        worker: verify HMAC → base64 PDF → Anthropic API
     │        (sonnet-5, thinking disabled, structured output)
     │        → scrub PII → JSON ekstrakt (plik odrzucony, zero zapisu)
     │  <── ekstrakt (zminimalizowany) ──┘
     │
     └── server action persist (zod) ──> inputs.kw + inputs.kwMeta (jsonb)
              prowenancja serwerowo: akt/odpis_kw → to_verify; ręczne → confirmed
              → strona operatu: bulk „Potwierdź dane KW" → F-4 → dokument
```

**Dlaczego upload wprost do workera:** Vercel ma twardy limit 4,5 MB na body
requestu; realne akty mają 11–15 MB. Railway limitu nie narzuca. Token HMAC
(`WORKER_SHARED_SECRET` w env web i workera; payload: exp + nonce; weryfikacja
stateless) domyka przy okazji backlogowy brak auth workera dla nowego
endpointu. ADR-009: integracja zewnętrzna (Anthropic API) żyje za ACL
w workerze, klucz `ANTHROPIC_API_KEY` wyłącznie w env workera. F-11
nietknięte: worker zwraca dane, nigdy WR.

Ekstrakt wraca przez klienta (nie server-side worker→web) — jest niezaufany
jak każdy input użytkownika, ale ląduje dokładnie tam, gdzie ręczny wpis:
walidacja zod + serwerowe nadanie prowenancji + brama F-4.

## Model danych (`inputs.kw`, write-once jsonb — wzorzec Slice 5, zero DDL)

```jsonc
"kw": {
  "source": "akt" | "odpis_kw" | "reczne",
  "kwLokalu": "PO1P/…/1" | null,     // null + deweloperski → księga matka
  "kwGruntu": "PO1P/…/4" | null,
  "kwInne": ["…"],                    // np. garaż
  "deweloperski": false,
  "powUzytkowaKw": 69.56 | null,
  "udzial": "14651/29359" | null,
  "sad": "Sąd Rejonowy …" | null,
  "wydzial": "VI Wydział Ksiąg Wieczystych" | null,
  "dataDokumentu": "2026-05-11" | null,
  "dzial3": { "wpisy": true, "tresc": ["…"] } | null,   // po scrubbingu
  "dzial4": { "wpisy": true, "tresc": ["…"] } | null
},
"kwMeta": { "model": "claude-sonnet-5", "extractedAt": "…",
            "docTypeDetected": "akt|odpis_kw", "docTypeDeclared": "…" }
```

- Kolumna `kw_number` zostaje (ścieżka ręczna, legacy); przy ekstrakcji
  synchronizowana na `kwLokalu ?? kwGruntu`.
- Prowenancja: grupa `kw` w `assignProvenance` (ACL: auto → `to_verify`,
  ręczne → `confirmed`) i w `approvalGate` (default-deny). Auto-fill
  powierzchni nadaje polu powierzchni źródło `akt`/`odpis_kw` + `to_verify`.
- Pusty ekstrakt normalizowany do `null` na granicy akcji (lekcja Slice 5 —
  fix pustego subjectu).

**Blockery F-4 (nowe):** grupa `kw` niepotwierdzona; przy
`source ∈ {akt, odpis_kw}`: brak `kwGruntu` = blocker; brak `kwLokalu`
= blocker, chyba że `deweloperski`.

## Ekstrakcja (worker)

- Model: **`claude-sonnet-5`**, `thinking: {type: "disabled"}` (spike: jakość
  identyczna z opusem, thinking zbędny; intro pricing $2/$10 do 2026-08-31),
  `max_tokens: 4096`, cały PDF jako base64 `document` block, structured output
  (pydantic) — schemat ze spike'a + `dzial3_tresc`/`dzial4_tresc`.
- Klasyfikacja typu przez model; rozjazd z deklaracją (przycisk) → flaga
  w odpowiedzi, UI ostrzega, dane wypełniane wg typu wykrytego.
- Koszt zmierzony: ~$0,04–0,21/dokument (dominuje input ~1620 tok/stronę
  skanu); latencja 5–24 s; timeout 60 s.
- Limity wejścia: PDF, ≤32 MB (limit API), walidacja typu MIME i rozmiaru
  po obu stronach.

## RODO / minimalizacja (trzy warstwy)

1. **Schemat bez pól na PII** — structured output nie ma pól na strony,
   nazwiska, PESEL-e; prompt: w treści wpisów działów III/IV podawać rodzaj
   wpisu i instytucję, pomijać osoby fizyczne.
2. **Defensywny scrub w workerze** na wolnych polach tekstowych (treść wpisów,
   sąd): regex 11 cyfr (PESEL), heurystyka imię+NAZWISKO w treści wpisów
   (lepiej wyciąć za dużo — rzeczoznawca weryfikuje z dokumentem w ręku).
   Scrub przed opuszczeniem procesu workera; nic niescrubowanego nie trafia
   do web/DB/logów.
3. **Plik efemeryczny** — przetwarzanie w pamięci, zero zapisu na dysk/DB,
   zero logowania treści; po odpowiedzi jedynym śladem jest ekstrakt.

Założenie formalne (odnotowane, nie blokujące MVP): dane dokumentu przechodzą
przez Anthropic API jako podprocesor (retencja API 30 dni); kierunek AI-first
przesądzony produktowo; umowa powierzenia do rozważenia przed komercjalizacją.

## UX

- **KwSourcePicker** (makieta v3-r4): „Wgraj akt notarialny" / „Wgraj odpis
  KW" / „Wpisz ręcznie"; zmiana źródła = twardy reset sekcji.
- Pasek stanów ⏳ (ekstrakcja) / ✓ (wypełniono) / ⚠ retry (502) / ℹ bez retry
  (422 „to nie wygląda na akt/odpis") — lustrzany do „Dane przedmiotu".
- Pola edytowalne po ekstrakcji; treść wpisów III/IV jako textarea.
- **Banner deweloperski**: auto przy `kwLokalu=null`; checkbox ręczny; pole KW
  lokalu wygaszone gdy aktywny.
- **Warning rozbieżności powierzchni**: obie wartości + „Użyj wartości
  z dokumentu"; rozbieżność KW↔EGiB → adnotacja w dokumencie (bez panelu).
- Strona operatu: badge grupy `kw` + bulk „Potwierdź dane KW" (bliźniak
  confirmSubject, strażniki F-7).
- e2e: upload wyłączony flagą `NEXT_PUBLIC_KW_UPLOAD=off` (wzorzec
  SUBJECT_AUTOFETCH); smoke pokrywa ścieżkę ręczną.

## Obsługa błędów

| Sytuacja                        | Worker          | UX                                                   |
| ------------------------------- | --------------- | ---------------------------------------------------- |
| Token nieważny/wygasły          | 401             | auto-mint nowego + retry raz, potem komunikat        |
| Za duży / nie-PDF               | 413 / 415       | inline przy pickerze                                 |
| Nierozpoznany dokument          | 422 (nie-retry) | ℹ „To nie wygląda na akt ani odpis" + ścieżka ręczna |
| Typ wykryty ≠ deklarowany       | 200 + flaga     | ostrzeżenie, dane wg typu wykrytego                  |
| Anthropic error/timeout/refusal | 502 (retry)     | ⚠ „Spróbuj ponownie"                                 |
| Ekstrakt bez obu KW             | 200, pola null  | F-4 wymusi uzupełnienie                              |

## Sekcja dokumentu (szablon + model)

- `build_template.py` (wiki-repo, jedyna droga regeneracji szablonu):
  sekcja badania KW — oba numery, sąd/wydział, data badania (= data
  zatwierdzenia), warianty `{#kw_deweloperski}` (księga matka) i standardowy;
  działy III/IV: `{#dzial3_wpisy}{tresc}{/}` / `{#dzial3_brak}` (analogicznie
  IV). 8.2: `{pow_uzytkowa_kw}` + `{udzial}` zastępują adnotację „udział — wg
  odpisu KW". Anty-literały numerów/wartości z próbek w teście integralności.
- `buildDocumentModel`: wzajemna wyłączność wariantów wymuszona strukturalnie
  (lekcja mpzp/mpzp_brak); legacy (brak `inputs.kw`) → sekcja jak dziś
  (numer + adnotacja) — zero regresji starych operatów.
- NBSP wyłącznie jako escape (lekcja Slice 5 — Edit tool konwertuje na żywy
  znak; edycje przez Python I/O).

## Testy / fitness functions (CI od pierwszego taska, zero sieci/LLM)

- **F-4**: testy nowych blockerów (grupa kw, komplet numerów, wariant
  deweloperski).
- **F-9**: test scrubbingu w workerze na syntetycznym fixture (adversarialny
  PESEL w treści wpisu dz. III → wycięty); fixture'y wyłącznie syntetyczne;
  `check-no-pii.sh` bez zmian.
- **F-12**: integralność szablonu (nowe placeholdery + anty-literały),
  maskowanie, kompletność renderu obu wariantów KW.
- Kontrakty web↔worker na fixture'ach; anthropic client mockowany
  (monkeypatch); testy mint/verify HMAC po obu stronach; roundtrip
  `inputs.kw` (wzorzec F-5).
- **RTL/component-testy** (nowa infra): KwSourcePicker, banner deweloperski,
  warning rozbieżności.
- Gates per task: web `pnpm turbo lint typecheck test build --env-mode=loose
&& pnpm depcruise`; worker `uv run ruff check . && uv run ruff format
--check . && uv run pytest -q`.

## Decyzje z brainstormu (2026-07-17, user)

1. Zakres: **pełny model** (akt + odpis + ręczny fallback + wariant
   deweloperski).
2. RODO: **tylko ekstrakt**, plik nie jest przechowywany.
3. Dokument: **badanie z treścią wpisów** działów III/IV (instytucje tak,
   osoby fizyczne scrubowane).
4. Powierzchnia: **auto-fill `to_verify` + warning rozbieżności**.
5. DoD: **3 przypadki E2E + regresja ręczna**.
6. Architektura: **podejście A** — upload wprost do workera z tokenem HMAC
   (Vercel 4,5 MB), ekstrakcja za portem (ADR-009).
7. Model: **sonnet-5 `thinking: disabled`** (dogrywka spike'a: 4/4; thinking
   ~3–4% kosztu bez wpływu na jakość; sonnet-4-6 bez przewagi).

## Ryzyka / zależności

- **Sekrety S5 (checkpoint user):** `ANTHROPIC_API_KEY` (Railway worker),
  `WORKER_SHARED_SECRET` (Railway + Vercel). Kolejność deployu: worker → web
  (bez migracji DDL).
- CORS workera dla uploadu z przeglądarki (origin prod + localhost).
- Jakość ekstrakcji na dokumentach spoza próbki (inne kancelarie/formaty) —
  mityguje brama F-4 + edytowalność pól; monitorować w użyciu.
- `maxDuration` akcji web nie dotyczy uploadu (idzie poza Vercel) — tylko
  mint tokenu i persist (szybkie).

## Podział na taski (orientacyjny, do planu)

1. RTL/component-test infra + pierwszy test
2. Worker: rdzeń `kw.py` (schemat + scrub, testy F-9)
3. Worker: `/kw-extract` + HMAC + adapter anthropic (mock) + błędy
4. Kernel/domena: `inputs.kw`, zod, prowenancja `kw`, blockery F-4
5. Web: mint tokenu + port/adapter + akcja persist
6. Web UI: KwSourcePicker + upload + banner + warning (RTL)
7. Strona operatu: badge + bulk confirm
   8–9. Szablon (wiki-repo `build_template.py`) + `buildDocumentModel` + F-12
   (jeden push, wzorzec S5 T7+T8)
8. Smoke/regresja + finalny whole-branch review
   S5: deploy (sekrety — checkpoint) + QA 3 przypadków; S6: wiki-PR (+ spike).

## Referencje

- Spike: wiki-repo `tools/spike/2026-07-17-kw-ekstrakcja/RAPORT.md`
- Wiki: `topics/tech/kw-pozyskiwanie-danych` (empiria, prawo, RODO),
  `topics/tech/subject-data-egib-mpzp-slice` (styk 8.2, wzorce),
  `topics/tech/document-generator-slice` (pipeline szablonu, F-12)
- Makieta: `raw/interactive-mockup/Wyceny - v2 - full code/` (v3-r4,
  KwSourcePicker)
- ADR-009 (worker/ACL), ADR-010/012 (gating), lekcje Slice 5 (ledger
  `.superpowers/sdd/progress.md`)
