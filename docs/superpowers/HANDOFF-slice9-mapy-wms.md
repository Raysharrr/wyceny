# Handoff — Slice 9: Obrazy w operacie — mapy z WMS GUGiK — start od SPIKE + S1

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille). Handoff STARTOWY: slice ma gotową KONCEPCJĘ (wiki), ale nie ma spike'a WMS, brainstormu, specu ani planu — sesja prowadzi pełny cykl.

---

Poprowadź **Slice 9 — Obrazy w operacie: mapy z WMS GUGiK** przez pełny cykl `/build-slice`: SPIKE (obowiązkowy PRZED planem, patrz niżej) → S1 brainstorm (⛔ checkpoint zakresu) → S2 spec+plan (⛔ checkpoint planu) → S3 `superpowers:subagent-driven-development` (świeży implementer + niezależny reviewer per task, commit+push per task, ledger `.superpowers/sdd/progress.md` — NOWA sekcja `# SLICE 9`, briefy `mapy-task-N-brief.md`/`-report.md`) → S4 CI/fitness → S5 deploy (⛔) → S6 wiki docs (PR, merge robi user).

**NAJPIERW:** potwierdź, że wiki-PR **#13** jest ZMERGOWANY i `wiki/roadmap.md` NOW = „Obrazy w operacie: mapy z WMS GUGiK" (stan na 2026-07-21). Jeśli PR wisi albo user wybrał przy merge „Oględziny FR-2" — STOP, zapytaj usera.

**KONTEKST DO PRZECZYTANIA (w tej kolejności):**

1. `wiki/roadmap.md` — blok NOW (outcome: §8.1 osadza auto-pobrane mapy — orto + ewidencyjna — zamiast stubu; `Must-Viable`; decyzja usera 2026-07-19: obrazy WYMAGANE w MVP).
2. `wiki/topics/tech/obrazy-w-operacie-koncepcja.md` — **RDZEŃ**: inwentarz 4 obrazów §8.1 z operatów referencyjnych, endpointy WMS zweryfikowane GetCapabilities (ORTO StandardResolution layer `Raster`; KIEG layery `dzialki`+`numery_dzialek`+`budynki`+`obreby`; EPSG:2180; max 4096×4096; Fees „Brak opłat"), licencja + wymóg cytowania („Źródło: Geoportal.gov.pl, dane pobrane {data}"), architektura Opcja A (worker pobiera → web osadza), plan spike'a §6.
3. `wiki/topics/tech/immutability-audit-sign-slice.md` (Slice 8) — **moduł image jest już PRODUKCYJNY**: `docxtemplater-image-module-free@1.1.1` × docxtemplater 3.69 + expressions parser działa na realnym szablonie. Kontrakt load-bearing: **wartość tagu MUSI być stringiem** (Buffer = crash), `null` renderuje pusto, tag NIE może sąsiadować z tagami sekcji w jednym `w:t`, rozmiar stały z `getSize`. To ZAMYKA główne ryzyko spike'a z koncepcji (koegzystencja z angular-expressions) — spike Slice 9 się zwęża (patrz niżej).
4. `wiki/topics/tech/document-generator-slice.md` — jeden autor DOCX (web render), PDF wyłącznie przez worker `/convert-to-pdf`, F-12 = brama integralności; DOCX nieskompresowany ~1,24 MB (backlog `compression: "DEFLATE"` — z obrazami może stać się pilny).
5. `wiki/topics/tech/subject-data-egib-mpzp-slice.md` — worker `/subject-proposal` już pobiera GEOMETRIĘ działki (shapely) — **REUSE do BBOX map** (nie liczyć od zera); wzorzec endpointu do skopiowania dla `/map-proposal`.
6. Spike Slice 8: `tools/spike/2026-07-19-podpis-image-render/RAPORT.md` (wiki repo) — pełny kontrakt użycia modułu image, 3 iteracje FAIL→PASS.
7. App-repo `~/Development/wyceny-app`: `apps/web/src/adapters/docx-render.ts` (moduł image już wpięty — sygnatura `renderOperatDocx(model, opts?)`; mapy = drugi obraz obok podpisu, przemyśl rozszerzenie opts), `apps/web/src/app/actions/approve-valuation.ts` + `sign-valuation.ts` (dwa renderowania!), `apps/worker/` (wzorce endpointów), `tools/spike/2026-07-15-template-koscielna/build_template.py` (wiki repo — etapy 1-11; mapy = nowy etap z tagami w §8.1).

**SPIKE (obowiązkowy przed planem, konwencja `tools/spike/RRRR-MM-DD-mapy-wms/` w wiki repo).** Zwężony względem koncepcji §6, bo moduł image już dowiedziony:

1. Żywy `GetMap` dla Kościelnej 33/36 (golden case): ortofoto + ewidencyjna, BBOX z geometrii działki + margines, EPSG:2180, PNG — jakość/DPI/czytelność przy druku (render do szablonu → LibreOffice PDF → ocena wizualna).
2. Rozmiar wynikowego DOCX/PDF z 2 mapami (czy DEFLATE staje się pilne).
3. PoC nogi F-12: asercja że media obrazów istnieją w `word/media/` + relationships się rozwiązują (dzisiejszy test tekstowy NIE widzi niewyrenderowanego obrazu).
4. Skalowanie: mapy są większe niż podpis (170×57 px) — `getSize` per tag (moduł dostaje tagName jako 2. argument `getImage`/3. `getSize` — sprawdź w spike'u czy per-tag sizing działa).

**CO JUŻ ISTNIEJE (nie wyważać otwartych drzwi):** moduł image produkcyjny (Slice 8, kontrakt znany); worker→GUGiK wzorzec (Slice 2/5) + geometria działki w `/subject-proposal`; geokoding+EPSG:2180 (Slice 2); zamrażanie dokumentów + hash + niezmienność (Slice 8); data zatwierdzenia w modelu (cytowanie „dane pobrane {data}" = zero nowych pól). **CZEGO NIE MA:** fetch WMS GetMap (żaden endpoint), tagi map w szablonie (nowy etap `build_template.py`), noga F-12 na media, przechowywanie bajtów map, sekcja §8.1 ma stub tekstowy.

**ROZSTRZYGNIĘCIA DO BRAINSTORMU (S1, z userem — jedna kwestia na raz):**

1. **KRYTYCZNE — determinizm: kiedy mapy są pobierane i gdzie zamrażane?** Sign (Slice 8) RE-RENDERUJE dokument z zamrożonych `inputs` i ma test równości treści approve↔sign. Mapy pobierane żywcem przy każdym renderze = dryf (WMS się zmienia między approve a sign) + złamany strażnik. Opcje: (a) fetch przy auto-fetchu przedmiotu → bajty zamrożone (gdzie? `document` table z kluczami `mapa-*`? `inputs` to jsonb — bajty tam nie pasują), (b) fetch raz przy approve → zapis do `document` → sign czyta zamrożone bajty. Rekomendacja do przemyślenia: (b) + klucze w modelu. Test równości musi objąć media.
2. **Zakres map MVP**: 2 (ortofoto + ewidencyjna — rekomendacja koncepcji) vs 4 (miasto/dzielnica/lokalizacja/ortofoto jak referencje)? Pytanie H4 do Anety NIEodpowiedziane — decyzja usera „na dziś", korekta po sesji z Anetą.
3. **Cytowanie źródła** pod mapą: „Geoportal.gov.pl + data pobrania" (M5 do Anety nieodpowiedziane — jedziemy z rekomendacją koncepcji?).
4. **Fallback gdy WMS padnie / brak geometrii działki** (adres poza Poznaniem, `subject=null`): blocker zatwierdzenia? uczciwa cisza (operat bez map)? wzorzec „potwierdź brak" jak MPZP?
5. **Prowenancja map**: nowe źródło `mapa`/`to_verify` pod bramę F-4 (rzeczoznawca potwierdza, że wycinek pokazuje właściwą działkę!) czy mapy poza modelem prowenancji?
6. **Kształt nogi F-12** + czy `compression: DEFLATE` wchodzi w ten slice (wynik spike'a #2).

**KLUCZOWE ZASADY (jak w poprzednich slice'ach):**

- Kod/commity = ANGIELSKI (conventional, ≤100 znaków, lowercase, bez atrybucji); UI/operat = POLSKI (pełne diakrytyki).
- **F-1 NIETYKALNE**: golden 1 044 400; `computeKcs` bez zmian. **F-9**: syntetyczne fixture'y; KW TYLKO krótki środek (`PO1P/1/6` — regex skanera `[A-Z]{2}[0-9][A-Z]/[0-9]{8}/[0-9]` złapał plan Slice 8!); zero 11-cyfrowych ciągów. **F-12**: szablon WYŁĄCZNIE przez `build_template.py` (diff buildera NIEkommitowany w wiki do S6 PR); NBSP przez Python I/O. **F-11**: worker BĘDZIE dotknięty (nowy endpoint map) — nie zwraca WR, wzorzec `/subject-proposal`.
- **F-7 NIETYKALNE (nowe od Slice 8)**: triggery DB, audit_log w tx z każdą mutacją, CAS — każda nowa mutacja MUSI dostać wpis audytu (zamknięta lista `AUDIT_ACTIONS` w domenie) i CAS; podpisanych wycen nie ruszać.
- Spec (S2) MUSI otwierać się sekcją „Opis produktowy — co budujemy z perspektywy użytkownika".
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'` → `gh run watch <id> --exit-status`. Focused: `pnpm --filter web exec vitest run <path>`. Prettier na pre-commit: `pnpm exec prettier --write`.
- RTL: pragma `// @vitest-environment jsdom` + preambuła z `rtl-kw-section.test.tsx`. CodeGraph przed grepem. Framework API przez context7.
- Migracje: `railway run --service Postgres -- sh -c '... DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm exec drizzle-kit migrate'` (działa, Slice 8); kolejność migrate→worker→web gdy DDL+worker.
- Advisor-review planu przed checkpointem (b) — łapał CRITICALe w Slice 6, 7 i 8 (w tym: sam plik planu łamiący F-9).
- QA przeglądarkowe: claude-in-chrome może stracić attach w trakcie — **fallback: chrome-devtools MCP** (inna instancja Chrome, sesja cookie nie przechodzi, stan serwerowy tak). Subagent z idle-notification bez raportu → SendMessage z prośbą o raport.

**STAN INFRA (2026-07-21):** app repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, HEAD `301cca3`; CI joby `ci`+`e2e` (flagi off dla autofetch/kw-upload). Wiki repo `make-it-simple-rayshar/wyceny`, main CHRONIONY (PR, merge user); **PR #13 (Slice 8 docs) — sprawdź czy zmergowany**. Prod: web https://wyceny-mu.vercel.app (deployment `wyceny-d6dp79bu0`), worker `worker-v2` Railway (NIE dostał deployu od Slice 6 — Slice 9 go dotknie: `railway up`, builder DOCKERFILE, startCommand BEZ shella), Postgres Railway (ostatnia migracja **0009**: audit_log+triggery F-7). Demo: aneta=admin, zenon=rzeczoznawca; **zenon ma skan podpisu w profilu**. Na prodzie wyceny QA — w tym PODPISANA `5faecc25-...` (Kościelna, WR 529 100, nie da się jej zmienić — triggery) i jej wersja-2 draft `e2cac945-...` — NIE kasować.

**KONTEKST RÓWNOLEGŁY:** pytania do Anety w `wiki/deliverables/pytania-do-anety.md` (10 pozycji; H4 i M5 dotyczą TEGO slice'a — decyzje „na dziś" w brainstormie, korekta po sesji z Anetą); przy S6 promocja NEXT→NOW — kandydaci: „Oględziny FR-2" (naturalny następny — zdjęcia dopełnią obrazy) vs „UI wizard FR-13" — DECYZJA USERA przy merge.

**CHECKPOINTY:** (a) zakres po brainstormie, (b) plan (po advisor-review), (c) deploy GO (⚠️ worker deploy pierwszy raz od Slice 6; sekrety: żadnych nowych — WMS bezautoryzacyjny), (d) merge wiki-PR, (e) commity w wiki repo za zgodą. Między checkpointami — w pełni autonomicznie.

**START:** potwierdź merge PR #13 i NOW w roadmapie → przeczytaj konteksty (1-7) → SPIKE (wyniki → checkpoint przed S1 jeśli FAIL) → `superpowers:brainstorming` (S1) — pytania jedna na raz, zaczynając od rozstrzygnięcia 1 (determinizm/zamrażanie map).
