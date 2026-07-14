# Design: Slice 2 — auto-fetch próby z RCN („adres → próba pobiera się sama")

**Data:** 2026-07-14 · **Status:** zatwierdzony (checkpoint zakresu z userem 2026-07-14) ·
**Roadmap:** wiki `wiki/roadmap.md` 🟢 NOW („Dane przedmiotu + próba") — **chunk: tylko próba
(geokoder+RCN)**; EGiB/MPZP wydzielone (patrz Backlog).

## TLDR

Rzeczoznawca podaje adres i powierzchnię → klik **„Pobierz próbę z RCN"** → worker (za ACL)
geokoduje, pobiera transakcje z żywego WFS GUGiK, robi selekcję v2 (sanity dat + pasmo metrażu

- IQR-trim) i zwraca ≥12 kandydatek → formularz wypełnia się propozycją (edytowalną; ręczny
  wpis zostaje jako fallback) → snapshot `inputs` zapisuje transakcje **z prowenancją** (write-once).
  Podejście udowodnione dwoma spike'ami: 2026-05-14 (5/5) i **2026-07-14 (re-walidacja: PASS,
  Kościelna +6,5%, Meissnera +2,1% vs operaty)**.

## Fundament: spike'i (zasada spike-first)

Wiki-repo `tools/spike/2026-07-14-rcn-live-revalidation/` (RAPORT.md — pełne wnioski):

- API żywe: ~5000 rekordów / 10,7 MB / 3,6–4,8 s; schema pól 100%; geocode 0,1–0,6 s.
- Parametry produkcyjne: `count=5000`, `sortBy=dok_data D`, kolumna **`lok_cena_brutto`**,
  filtr `lok_funkcja='mieszkalna'`, BBOX 4×4 km (±0.018°lat, ±0.029°lon).
- **🔴 Odkrycie: RCN ma transakcje z datami z przyszłości (`5201-07`, `2913-04`)** — literówki
  rejestru; `sortBy` DESC wciąga je na szczyt. **Filtr sanity dat jest OBOWIĄZKOWY.**
- **Selekcja v2** (heurystyka produkcyjna, zbieżna z krokiem 3 makiety „19 → 12, odrzucenia:
  cena skrajna / metraż poza pasmem"):
  1. `lok_funkcja == 'mieszkalna'` i `cena_per_m2 > 0`
  2. sanity dat: `dziś-24mies ≤ dok_data ≤ dziś`
  3. pasmo metrażu: `pow_uzyt ∈ [0.7·P, 1.3·P]` przedmiotu
  4. IQR-trim cen jednostkowych: odrzuć poza `[Q1−1.5·IQR, Q3+1.5·IQR]` (gdy pula ≥8)
  5. sort `dok_data` DESC → pula 19 → **12 najnowszych** do próby
- Wynik selekcji vs operaty referencyjne: **+6,52% / +2,12%** — pasmo ±10% potwierdzone.

## Architektura

### Worker (FastAPI, Python — TYM RAZEM SIĘ ZMIENIA → deploy na Railway)

- Nowy moduł `apps/worker/app/rcn.py` — port pipeline'u ze spike'a, rozdzielony na:
  - `geocode(address) -> (lat, lon)` — Nominatim, strukturalne query (street/city), User-Agent,
    fallback `q=`; **wołane ≤1 req/s** (MVP: 1 wycena/min — wystarczy; cache = backlog).
  - `fetch_rcn(bbox, count=5000, sort="dok_data D") -> str` — WFS GetFeature `ms:lokale`,
    timeout 30 s (spike: p95 «15 s).
  - `parse_gml(gml) -> list[Transaction]` — regex jak w spike'u (`lok_cena_brutto`,
    `lok_pow_uzyt`, `dok_data`, `lok_funkcja`, `gml:pos`, `tran_lokalny_id_iip`).
  - `select_sample(transactions, subject_area, today) -> list[Transaction]` — **czysta** selekcja
    v2 (pure, testowalna offline; `today` jako parametr — determinizm testów).
- Nowy endpoint `POST /sample-proposal` `{address: str, area: float}` →
  `{transactions: [{date, area, pricePerM2, transactionId}], meta: {lat, lon, fetchedAt,
source: "rcn-wfs-gugik", query: {bbox, count, sort}}}`; błędy → HTTP 502/422 z polskim
  komunikatem w `detail`. **Endpoint NIE zwraca WR (F-11 nietknięte).**
- Testy pytest **bez sieci**: parser na nagranym fixture GML (mały, ~10 rekordów, **w tym rekord
  ze śmieciową datą 5201-07** — pin odkrycia spike'a); selekcja na danych syntetycznych (sanity
  dat, pasmo, IQR, pool→12); endpoint przez TestClient z monkeypatch geocode/fetch. Ruff czysty.

### Web (Next 16)

- Nowy port `apps/web/src/ports/sample.ts` — `PortSampleProposal.fetchProposal(address, area)`;
  adapter HTTP w `adapters/` (ten sam wzorzec co worker-http; F-10 pilnuje granic).
- Server Action `getSampleProposal` (nowa akcja obok createValuation): walidacja adres+pow →
  worker → wynik. Sesja wymagana.
- **UI (sekcja Próba, krok 3 makiety w wersji minimum):** przycisk **„Pobierz próbę z RCN"**
  (obok „Dodaj transakcję"); po sukcesie propozycje **zastępują** wiersze fieldArray (user dalej
  edytuje/usuwa/dodaje — istniejący mechanizm = „toggle" w wersji minimum); stan ładowania
  („Pobieranie…"), błąd po polsku pod przyciskiem; metadane pobrania trzymane w stanie formularza.
  Ostrzeżenie (amber, jak wagi) gdy transakcji **< 12**.
- **Ręczny wpis zostaje pełnoprawnym fallbackiem** (RCN może być niedostępne) — zod bazowo
  nadal ≥3; próg 12 egzekwowany miękko (ostrzeżenie) do czasu slice'a gatingu F-4.

### Dane / snapshot (F-5) — BEZ migracji DDL

`inputs` (jsonb) już jest write-once snapshotem — rozszerzamy jego kształt (zod + typy TS):

- `comparables[i]` dostaje opcjonalne pola prowenancji: `source: "rcn" | "manual"`,
  `transactionId?: string`;
- nowe pole `inputs.sampleMeta?: {lat, lon, fetchedAt, source, query}` — zapisywane gdy próba
  z RCN.
  Kolumna jsonb łyka to bez migracji; walidacja w zod (akcja) — nie w DB.

### Fitness functions tego slice'a

- **F-5 (nowa, w CI):** (a) test selekcji na fixture GML — zwraca **≥12** transakcji i odrzuca
  rekord ze śmieciową datą; (b) test integracyjny: wycena zapisana z próbą RCN → odczyt →
  `inputs.comparables.length ≥ 12` i każdy wiersz ma `source`, a `sampleMeta.fetchedAt` istnieje.
- **F-11 nietknięte** (worker zwraca transakcje, nigdy WR) — istniejący pytest rozszerzony
  o asercję na nowym endpoincie.
- F-1/F-2/F-3 bez zmian (golden na fixture; silnik nietknięty).
- **CI/e2e bez sieci zewnętrznej:** smoke Playwright zostaje na ręcznym wpisie; przepływ
  „Pobierz z RCN" weryfikowany na prodzie (QA przeglądarkowe) — CI nie może zależeć od GUGiK.

## Definition of Done

- Prod: adres `ul. Kościelna 33A, Poznań` + pow 71,63 → klik „Pobierz próbę z RCN" → formularz
  wypełniony **≥12 żywymi transakcjami** → zatwierdzenie → WR policzone ze snapshotu;
  **kryterium pasma (uzgodnione):** WR w ±10% od operatu referencyjnego (spike: +6,5%),
  NIE exact-golden (żywe dane ≠ próba PDF; WFS niedeterministyczny — snapshot to leczy).
- F-5 zielone w CI; pytest workera offline; ruff czysty; oba joby CI zielone.
- Worker wdrożony na Railway, web na Vercel; QA przeglądarkowe przepływu fetch (w tym błąd
  przy złym adresie) + aktualizacja wiki (S6).

## Non-goals → BACKLOG (udokumentowane, zasada „wracalne w świeżej sesji")

1. **EGiB/MPZP (dane przedmiotu: działka, obręb, przeznaczenie)** — wydzielone z bulletu
   roadmapy decyzją usera 2026-07-14. **Zasada spike-first: przed slice'em wymagany spike** —
   zbadać: dostępność WFS/API EGiB (usługa `KIEG`?) i MPZP (usługa krajowa/gminne), auth,
   pola, pokrycie Poznania, latencję. Wpisać jako NEXT w roadmapie przy S6.
2. **Pełne `Sourced<T>` + brama gatingu (F-4)** — osobny slice (roadmap NEXT); ten slice kładzie
   fundament (`source`/`sampleMeta` w snapshotcie).
3. **AI-powody odrzuceń, modal transakcji, mapa/Street View** (krok 3 makiety w pełni) — slice
   UX-owy później; obecna wersja minimum: propozycje → edytowalne wiersze.
4. **Paginacja WFS > 5000 (gęste dzielnice: Jeżyce/Golęcin)** — teraz: czytelny polski błąd gdy
   pula po filtrach < 12 („zawęź adres / wpisz ręcznie"); pełna paginacja BBOX = backlog.
5. **Cache/alternatywa geokodera** (Nominatim limit 1 req/s; polityka wymaga UA) — wystarcza
   dla MVP; przy skali → cache adresów lub geokoder GUGiK.
6. **Twardy próg ≥12 tx w zod** — po slice'u gatingu F-4 (teraz ostrzeżenie miękkie).
7. **E2E live-fetch w CI** — wymagałby stuba GUGiK w jobie e2e; strategia stub-serwera = razem
   z przyszłym slice'em EGiB (wspólna infrastruktura stubów).
