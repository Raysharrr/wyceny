# Handoff — Slice 5: Dane przedmiotu EGiB/MPZP (SPIKE-FIRST) — start od spike'a, potem brainstorm

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille). UWAGA — inaczej niż Slice 3/4: ten slice zaczyna się od **OBOWIĄZKOWEGO SPIKE'A** (roadmapa: „wymaga SPIKE-FIRST"), dopiero werdykt spike'a otwiera S1 (brainstorm). Spec i plan NIE istnieją.

---

Poprowadź **Slice 5 — Dane przedmiotu: EGiB/MPZP (spike-first)** przez cykl `/build-slice` z przedsionkiem spike'owym: **SPIKE re-walidacyjny (⛔ checkpoint user: werdykt)** → S1 brainstorm zakresu (⛔ checkpoint) → `superpowers:writing-plans` (⛔ checkpoint) → `superpowers:subagent-driven-development` (świeży implementer + niezależny reviewer per task, commit+push per task, ledger `.superpowers/sdd/progress.md`, briefy `egib-task-N-*.md`) → CI/fitness → deploy (⛔) → wiki S6 (PR).

**ITEM ROADMAPY (🟢 NOW, promowany 2026-07-17):** wiki `wiki/roadmap.md` — outcome: sekcje operatu o przedmiocie wyceny (ewidencja, działka, budynek, MPZP — dziś boilerplate/stub w szablonie) wypełniają się automatycznie z publicznych źródeł po adresie, z prowenancją `to_verify` per pole (brama F-4 wymusza potwierdzenie — AI-first). `Must-Viable`.

**KROK 0 — SPIKE (zanim cokolwiek innego):** konwencja `tools/spike/RRRR-MM-DD-egib-mpzp/` (wiki-repo; spike.py + RAPORT.md + results). Zbadać NA ŻYWO: dostępność WFS/API **EGiB** (usługa `KIEG`? auth? pola: obręb/działka/użytek/pow. działki), **kartoteka budynków** (rok budowy? kondygnacje?), **MPZP** (usługa krajowa vs GEOPOZ per gmina; przeznaczenie+nazwa planu+data uchwały), pokrycie Poznania, latencja z EU (worker jest w europe-west4). Punkt wyjścia i poprzeczka: `wiki/topics/tech/zrodla-danych-przedmiotu-api.md` (spike 2026-06-05, 6/6 PASS — GUGiK+GEOPOZ odtworzyły Kościelną 1:1; re-walidacja obowiązkowa jak przy RCN: żywe API potrafią się zmienić). Werdykt PASS/FAIL per źródło → checkpoint z userem → dopiero brainstorm.

**NAJPIERW PRZECZYTAJ (kontekst, w tej kolejności):**

- `wiki/roadmap.md` (wiki repo) — wpis NOW + DONE Slice 4 + NEXT (KW/akt podniesiony — NIE wciągać w zakres; granica: EGiB/MPZP = dane publiczne po adresie, KW/akt = upload+OCR, osobny slice)
- `wiki/topics/tech/zrodla-danych-przedmiotu-api.md` (wiki repo) — stary spike źródeł 6/6 PASS (endpointy, pola, kod referencyjny)
- `wiki/topics/tech/document-generator-slice.md` (wiki repo) — stan po Slice 4: które sekcje operatu są stubem (8.1 położenie, sekcja KW, zdjęcia) i JAK działa szablon (placeholdery, kontrakt, pipeline regeneracji)
- `wiki/topics/tech/rcn-sample-fetch-slice.md` (wiki repo) — WZORZEC tego slice'a: worker fetch po adresie → prowenancja `to_verify` → potwierdzenie (Slice 2+3 zrobiły dokładnie to dla próby RCN)
- `.superpowers/sdd/progress.md` (app repo) — ledger Slice 0-4 (konwencje, carry-forwardy, backlog; sekcja SLICE 4 + FINAL REVIEW + S5 DEPLOY na końcu)

**KLUCZOWE ZASADY (utrwalone też w auto-memory):**

- Kod/commity = ANGIELSKI (conventional commits, commitlint ≤100 znaków, lowercase-leading subject); UI copy i TREŚĆ OPERATU = POLSKI (pełne diakrytyki).
- **Spec MUSI otwierać się sekcją produktową** („Opis produktowy — co budujemy z perspektywy użytkownika") — wymaganie usera, wpisane w skill build-slice S1.
- Żadnych wywołań sieciowych w testach/CI (fixture'y z GML/JSON ze spike'a — wzorzec rcn.py). **F-11 nietknięte** (worker zwraca dane/pliki, nigdy WR). Fetch po stronie WORKERA (ADR-009, wzorzec `/sample-proposal`).
- **F-9 UWAGA przy EGiB**: dane ewidencji mogą zawierać właścicieli/PESEL-e — do aplikacji wchodzą TYLKO pola przedmiotowe (działka/obręb/pow./rok budowy), żadnych danych osobowych; fixture'y w repo przeskanuje check-no-pii.sh.
- **Szablon operatu regeneruje się WYŁĄCZNIE skryptem** `build_template.py` (wiki-repo `tools/spike/2026-07-15-template-koscielna/`) — jeśli slice dodaje placeholdery do sekcji 8.x/9, to przez rozbudowę pipeline'u + regenerację `operat-sections.ts` + rozszerzenie testu integralności (F-12). Nigdy ręczna edycja .docx.
- Niewidoczne znaki w kodzie zawsze jako escape (` `) — lekcja skorelowanego buga NBSP.
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run watch --exit-status`. Worker: `uv run pytest -q` + ruff (lokalnie z `SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice` jeśli testy konwersji).
- Framework API przez context7, nie z pamięci. **CodeGraph** w app-repo: `codegraph explore "<pytanie>"` PRZED grep/czytaniem.

**STAN INFRA (zweryfikowany 2026-07-17, po Slice 4):**

- App repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, commit+push wprost, HEAD `6318ae8`. CI: joby `ci` + `e2e` (LibreOffice na runnerze przez krok „Ensure LibreOffice + Carlito").
- Wiki repo `make-it-simple-rayshar/wyceny` — main CHRONIONY (PR + podpisane commity; branch dla S6 NOWY z origin/main). **Sprawdź, czy PR #7 (docs Slice 4 + promocja NOW) jest zmergowany — jeśli nie, to blokada startu (roadmapa NOW nieoficjalna).**
- Prod: web https://wyceny-mu.vercel.app (`vercel deploy --prod` Z KORZENIA monorepo; `.codegraph` w `.vercelignore` — nie usuwać), worker https://worker-v2-production.up.railway.app (builder **DOCKERFILE** z LibreOffice+Carlito; deploy `railway up ./apps/worker --path-as-root --service worker-v2`; **UWAGA: startCommand w railway.json wykonuje się BEZ shella — żadnych `$VAR`, CMD z `sh -c` w Dockerfile rządzi**). Demo: przyciski na stronie logowania (aneta=admin, zenon=rzeczoznawca).
- **Prod DB / sekrety**: wzorzec `railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" <cmd>'` (Vercel `DATABASE_URL`=sensitive, pull daje pustkę). Migracje: NAJPIERW migracja, POTEM deploy; przy tym slice kolejność deployu **migracja → worker → web** jeśli worker dostaje nowy endpoint. Zastosowane migracje: 0000-0008.
- Stan danych: pełny cykl żywy (szkic → potwierdź → zatwierdź → **operat PDF+DOCX generuje się na prodzie**, klucze `operat-<id>.pdf/.docx` w tabeli `document`, bytea). Formularz ma pola: adres, powierzchnia, cel, nr KW, zamawiający, data oględzin + próba + cechy/wagi.

**DO ROZSTRZYGNIĘCIA (spike → brainstorm), m.in.:** które źródła przeszły re-walidację i co realnie dają (EGiB vs kartoteka budynków vs MPZP — możliwe cięcie zakresu do podzbioru PASS); gdzie lądują dane (rozszerzenie `inputs` jsonb jak sampleMeta vs nowe kolumny); prowenancja per pole (`ewidencja`/`mpzp` już w enumie kernela); kiedy fetch (przy tworzeniu? przycisk jak „Pobierz próbę z RCN"?); które placeholdery/sekcje szablonu przechodzą ze stubu na dane (rozbudowa build_template.py + F-12); fallback ręczny; czy rok budowy wchodzi do cech/filtrów próby (styk z F-6 z NEXT — nie wciągać całego F-6).

**CHECKPOINTY (pauzuj, pytaj usera):** (a) werdykt spike'a, (b) zakres/outcome po brainstormie, (c) akceptacja planu, (d) deploye/sekrety w S5, (e) merge wiki-PR robi user. Między checkpointami działaj autonomicznie.

**START:** sprawdź merge PR #7 → przeczytaj konteksty z listy → SPIKE (krok 0) → checkpoint werdyktu → `superpowers:brainstorming`.
