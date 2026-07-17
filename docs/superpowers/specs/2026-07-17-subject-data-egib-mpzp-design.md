# Spec — Slice 5: Dane przedmiotu z EGiB/MPZP (auto-fetch przez worker)

Data: 2026-07-17 · Status: zatwierdzony po brainstormie · Poprzedza: plan implementacyjny
Spike walidacyjny: wiki-repo `tools/spike/2026-07-17-egib-mpzp/` (PASS, re-walidacja 6/6 z 2026-06-05)

## Opis produktowy — co budujemy z perspektywy użytkownika

Dziś rzeczoznawca wpisuje wszystko o przedmiocie wyceny ręcznie, a sekcje operatu o ewidencji
i planie miejscowym (8.2 „Stan prawny i ewidencyjny", 9 „Przeznaczenie w dokumentacji
planistycznej") to boilerplate z szablonu — niezależnie od tego, jaką nieruchomość wycenia.

Po tym slice: **rzeczoznawca wpisuje adres i dane przedmiotu pobierają się same**. W kilka sekund
po opuszczeniu pola adresu aplikacja dociąga z publicznych rejestrów (GEOPOZ/GUGiK, darmowe, bez
auth): obręb, arkusz, numer działki, powierzchnię ewidencyjną i użytek z ewidencji gruntów; rodzaj
budynku i liczby kondygnacji z ewidencji budynków; symbol przeznaczenia, nazwę planu, numer uchwały,
datę i publikator z MPZP. Widzi pasek stanu („Pobieram… / Pobrano — do potwierdzenia / Nie udało
się — spróbuj ponownie"), a każde pobrane pole nosi prowenancję `to_verify` — **brama zatwierdzenia
(F-4) wymusza, żeby człowiek potwierdził dane zanim powstanie operat** (AI-first: maszyna robi,
rzeczoznawca potwierdza i odpowiada zawodowo).

Efekt w dokumencie: sekcje 8.2 i 9 wygenerowanego operatu **przechodzą ze stubu na dane
rzeczywiste** konkretnej nieruchomości. Aplikacja jest przy tym uczciwa wobec granic danych
publicznych:

- **~połowa Poznania nie ma MPZP** — wtedy sekcja 9 dostaje wariant „brak obowiązującego planu",
  a formularz odsłania ręczne pole „przeznaczenie wg studium/decyzji WZ". Pusta odpowiedź z rejestru
  to informacja, nie błąd.
- **Roku budowy nie ma w żadnym publicznym API** (zweryfikowane spike'iem, pełny zrzut pól) —
  zostaje polem ręcznym; niewypełniony renderuje się w operacie jako „b.d. — brak w publicznej
  ewidencji", żeby dokument jawnie dokumentował lukę źródła, a nie ją ukrywał.
- **Zasięg MVP to Poznań** (komplet: działka+budynek+MPZP z GEOPOZ). Architektura jest jednak
  projektowana pod całą Polskę: fetch siedzi za portem niezależnym od źródła, więc dołożenie
  ogólnopolskiego KIEG (działki w każdym powiecie) to wymiana adaptera, nie przebudowa. Adres poza
  Poznaniem dostaje czytelny komunikat i pełnoprawny wpis ręczny.

Co świadomie się NIE zmienia: próba RCN zostaje osobnym przyciskiem (ciężka, świadoma operacja),
sekcja KW czeka na slice upload+OCR, proza opisowa (8.1/8.3/11) czeka na slice LLM.

**Miara sukcesu:** na produkcji, dla Kościelnej 33, po wpisaniu adresu formularz sam pokazuje
Jeżyce / arkusz 10 / działka 161 / 0,0772 ha / 4MW/U / uchwała VII/84/VIII/2019 — dokładnie to, co
Aneta przepisywała ręcznie do realnego operatu — a wygenerowany PDF ma te dane w sekcjach 8.2 i 9.

## Decyzje z brainstormu (2026-07-17, z userem)

1. **Zasięg:** Poznań-only (GEOPOZ) w tym slice; port źródło-agnostyczny, KIEG = przyszły adapter
   (switch po TERYT/gminie). User potwierdził: „na potrzeby MVP może być Poznań, ale switch musi
   być prosty — dokładnie adapter".
2. **UX:** auto-fetch na blur/walidacji pola adresu + obowiązkowy indykator; merge-policy „nie
   nadpisuj pól dotkniętych przez usera"; retry = fallback ręczny. RCN bez zmian (przycisk).
3. **Brak MPZP:** adnotacja automatyczna + opcjonalne ręczne pole „przeznaczenie wg studium/WZ"
   (ręczne = `confirmed`); szablon renderuje wariant sekcji 9.
4. **Rok budowy:** tylko ręczne, opcjonalne; brak wartości → „b.d." w operacie (wymóg usera:
   udokumentować, że może go nie być). Bez styku z cechami/F-6 (poza zakresem).

## Architektura (lustro wzorca RCN — Slice 2/3)

```
adres (blur) → server action getSubjectData (session-gated)
  → PortSubjectData → adapter HTTP → worker POST /subject-proposal   [ADR-009, ACL]
      worker: geokoder UUG → ULDK (id działki + geometria)
              → GEOPOZ WMS dzialki + budynki (XML)
              → GEOPOZ WFS mpzp_funkcje (GeoJSON, wybór funkcji: max przecięcie z działką, shapely)
              → poznan.pl warstwa planów (GeoJSON, PIP centroidu; cache in-memory TTL — request ~1 s)
  ← { parcel, building, mpzp | mpzpAbsent: true, meta } — dane, nigdy WR   [F-11]
→ formularz: sekcja „Dane przedmiotu" wypełniona, prowenancja ewidencja/mpzp + to_verify  [ACL nadaje status]
→ zapis: inputs.subject + inputs.subjectMeta (write-once jsonb, ZERO migracji DDL)   [ADR-011]
→ strona operatu: badge + bulk „Potwierdź dane przedmiotu" → F-4 → zatwierdzenie
→ buildDocumentModel: nowe pola → placeholdery sekcji 8.2 i 9   [F-12]
```

- **Worker:** czysty rdzeń `apps/worker/app/subject.py` (parsery: XML GEOPOZ dialekt `<TAG>`,
  GeoJSON WFS, PIP/przecięcia poligonów) + cienki endpoint w `main.py`. Błędy → 502 z polskim
  `detail` (wzorzec `/sample-proposal`); adres poza Poznaniem (TERYT gminy z geokodera nie zaczyna się
  od `3064`) → 502 „Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie". Nowa zależność workera: `shapely`
  (algorytm max-przecięcia udowodniony w spike'u `mpzp_resolver.py`: Kościelna → 4MW/U = 100%).
- **Web:** port + adapter z klasyfikacją błędów `WORKER_RESPONDED_PREFIX`; server action;
  auto-trigger z debounce na blur adresu; komponent paska stanu.
- **Deploy bez migracji:** kolejność worker → web (nowy endpoint najpierw).

## Model danych i prowenancja

- `inputs.subject`: `{ parcelId, obreb, arkusz, nrDzialki, powEwidHa, uzytek, budynekRodzaj,
kondygnacjeNadziemne, kondygnacjePodziemne, rokBudowy?, mpzp: { symbol, nazwaPlanu, uchwala,
dataUchwaly, publikator } | null, przeznaczenieStudium? }` — nazwy finalizuje plan; write-once
  ze snapshotem wyceny.
- `inputs.subjectMeta`: `{ fetchedAt, sources: [geokoder, uldk, geopoz_egib, geopoz_mpzp],
mpzpAbsent: boolean, query: {...} }` — reprodukowalność (wzorzec `sampleMeta`, F-3/F-5).
- Prowenancja: istniejące wartości kernela `ewidencja` i `mpzp` (`packages/shared/src/sourced.ts` —
  bez zmian w enumie), status `to_verify` nadawany wyłącznie na granicy ACL web
  (`assign-provenance`); pola ręczne = `confirmed` (jak dotąd).
- **Pola opcjonalne puste (rok budowy, przeznaczenie wg studium) nie wchodzą do mapy prowenancji**
  — nie generują blockera `none`; brak roku budowy jest legalnym stanem.
- Blockery F-4 (`apps/web/src/domain/provenance.ts`): rozszerzone o pola przedmiotu — wszystko co
  auto-pobrane musi być `confirmed` przed zatwierdzeniem; stan MPZP musi być świadomy (dane planu
  potwierdzone ALBO potwierdzony stan „brak planu").

## UI (formularz + strona operatu)

- Nowa sekcja formularza „Dane przedmiotu" (RSC + `"use client"` dla interakcji, jak sekcje Próba/
  Cechy): pola auto-wypełniane, edytowalne; rok budowy z hintem „brak w publicznej ewidencji —
  uzupełnij z dokumentacji/oględzin"; przy `mpzpAbsent` pole „przeznaczenie wg studium/decyzji WZ".
- Pasek stanu fetchu: `⏳ Pobieram dane działki i MPZP…` → `✓ Pobrano: {obręb, dz., symbol} — do
potwierdzenia` → `⚠ Nie udało się pobrać — [Spróbuj ponownie]`. Amber, nieblokujący.
- Merge-policy: re-fetch (zmiana adresu) nadpisuje tylko pola nietknięte przez usera lub wciąż
  `to_verify`; dotknięte/`confirmed` zostają.
- Strona operatu: badge prowenancji per pole (istniejący wzorzec) + bulk „Potwierdź dane
  przedmiotu" (wzorzec „Potwierdź próbę z RCN", owner-only).

## Szablon i generator (F-12)

- Placeholdery sekcji **8.2** (obręb, arkusz, nr działki, pow. ewidencyjna, użytek, rodzaj budynku,
  kondygnacje, rok budowy z fallbackiem „b.d. — brak w publicznej ewidencji") i **9** (wariant
  warunkowy docxtemplater: `{#hasMpzp}` symbol/nazwa/uchwała/data/publikator `{/hasMpzp}` /
  `{^hasMpzp}` adnotacja „brak obowiązującego MPZP" + przeznaczenie wg studium/WZ `{/hasMpzp}`).
- Szablon regenerowany WYŁĄCZNIE przez `build_template.py` (wiki-repo
  `tools/spike/2026-07-15-template-koscielna/`) — rozbudowa pipeline'u kotwiczenia + regeneracja
  `apps/web/src/domain/operat-sections.ts`. Nigdy ręczna edycja .docx.
- `buildDocumentModel` (`apps/web/src/domain/document-model.ts`): nowe pola modelu w bijekcji
  z placeholderami; formaty PL (nbsp jako escape ` ` — lekcja Slice 4).
- **F-12 rozszerzone (wszystkie 3 nogi):** integralność szablonu (komplet nowych placeholderów,
  anty-literały z operatu źródłowego dla sekcji 8.2/9), maskowanie (bez zmian — dane przedmiotu są
  jawne w operacie), kompletność renderu **dla obu wariantów MPZP** (plan / brak planu).

## Testy / CI (zero sieci — F-9)

- Worker pytest offline: fixture'y z realnych odpowiedzi spike'a 2026-07-17 (XML GEOPOZ działki+
  budynki, GeoJSON WFS funkcje, wycinek warstwy planów poznan.pl; przeskanowane pod PII — spike już
  to zrobił: odpowiedzi EGiB nie zawierały danych osobowych, `check-no-pii.sh` pilnuje w CI).
  Przypadki: happy path Kościelna, brak MPZP (Głogowska 40), adres poza Poznaniem, błąd upstreamu.
- Web vitest: merge-policy, blockery F-4 z polami przedmiotu, `buildDocumentModel` oba warianty,
  schema formularza.
- Playwright smoke: bez sieci — auto-fetch przy niedostępnym workerze degraduje się do amber+wpis
  ręczny, ścieżka ręczna przechodzi jak dotąd (graceful degradation jest częścią kontraktu).

## Definition of Done

1. Prod: adres Kościelna 33 → auto-fetch → Jeżyce / AR 10 / dz. 161 / 0,0772 ha / 4MW/U /
   VII/84/VIII/2019 jako `to_verify` → potwierdź → zatwierdź → PDF z sekcjami 8.2 i 9 z danych.
2. Prod: adres bez MPZP → wariant „brak planu" + pole studium/WZ → poprawny operat.
3. F-4/F-9/F-11/F-12 zielone w CI; zero wywołań sieciowych w testach; F-10 (rdzeń `subject.py`
   i `document-model.ts` czyste).
4. Deploy worker → web (bez migracji); weryfikacja live na prodzie.
5. Wiki S6: log, timeline, strona tech slice'a, roadmapa NOW→DONE + promocja (PR).

## Poza zakresem (świadome odroczenia)

- KIEG jako adapter ogólnopolski (działki poza Poznaniem) — osobny slice; port już na to gotowy.
- Auto-fetch studium/WZ; KW/akt (upload+OCR — szczyt NEXT); proza 8.1/8.3/11 (LLM).
- Styk roku budowy z cechami/filtrami próby (F-6).
- Auth/rate-limit endpointów workera — backlog od Slice 2, dotyczy też `/subject-proposal`
  (odnotować w ledgerze jako carry-forward).

## Referencje

- Spike: wiki-repo `tools/spike/2026-07-17-egib-mpzp/` (RAPORT.md — endpointy, pola verbatim,
  latencje) + `tools/spike/2026-06-05-zrodla-danych-przedmiotu/` (mpzp_resolver.py).
- Wzorce: `apps/worker/app/rcn.py`, `/sample-proposal`, `sampleMeta`, `assign-provenance`,
  `approvalGate`, `documentFieldBlockers`, `build_template.py`.
- ADR-009 (fetch w workerze/ACL), ADR-010/012 (Sourced + gating), ADR-011 (write-once inputs).
- Wiki: `wiki/topics/tech/zrodla-danych-przedmiotu-api.md`, `rcn-sample-fetch-slice.md`,
  `sourced-gating-slice.md`, `document-generator-slice.md`.
