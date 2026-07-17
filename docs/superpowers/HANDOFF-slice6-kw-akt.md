# Handoff — Slice 6: KW/akt notarialny — upload + ekstrakcja (SPIKE-FIRST) — start od spike'a, potem brainstorm

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille). Jak przy Slice 5: ten slice zaczyna się od **OBOWIĄZKOWEGO SPIKE'A** (roadmapa: „wymaga SPIKE-FIRST"), dopiero werdykt spike'a otwiera S1 (brainstorm). Spec i plan NIE istnieją.

---

Poprowadź **Slice 6 — KW/akt notarialny: upload + ekstrakcja (spike-first)** przez cykl `/build-slice` z przedsionkiem spike'owym: **SPIKE ekstrakcji na realnych próbkach (⛔ checkpoint user: werdykt)** → S1 brainstorm zakresu (⛔ checkpoint) → `superpowers:writing-plans` (⛔ checkpoint) → `superpowers:subagent-driven-development` (świeży implementer + niezależny reviewer per task, commit+push per task, ledger `.superpowers/sdd/progress.md`, briefy `kw-task-N-*.md`) → CI/fitness → deploy (⛔) → wiki S6 (PR).

**ITEM ROADMAPY (🟢 NOW, promowany 2026-07-17 przy PR #8):** wiki `wiki/roadmap.md` — outcome: sekcja badania KW przechodzi ze stubu-adnotacji na realne dane (**jedyna luka Must-Legal kompletności dokumentu**); trzy ścieżki klienta: numer „z pamięci" (dzisiejsze pole = fallback) / upload aktu (praktyka akt-first) / upload odpisu. Model docelowy: **dwa sloty KW (lokal+grunt)** + wariant „brak KW lokalu (deweloper) → księga matka". `Must-Legal`.

**TRZY NOWOŚCI ARCHITEKTONICZNE NARAZ** (dlatego spike-first): (1) pierwszy upload plików użytkownika (wzorzec storage: Postgres bytea za portem już istnieje — tabela `document`); (2) pierwsza integracja vision/LLM (wybór narzędzia w spike'u; API przez skill `claude-api`/context7, nie z pamięci); (3) RODO na serio: akty zawierają **PESEL-e i dane osobowe** → design minimalizacji/retencji PRZED planem.

**KROK 0 — SPIKE ekstrakcji (zanim cokolwiek innego):** konwencja `tools/spike/RRRR-MM-DD-kw-ekstrakcja/` (wiki-repo; spike.py + RAPORT.md + results). Próbki: **`raw/documents/uzupełnienie/`** (wiki-repo, IMMUTABLE — 3 realne akty notarialne + odpis KW; wszystkie **skany**, empiria wstępna vision 2026-07-17 opisana w [[topics/tech/kw-pozyskiwanie-danych]] sekcja „Empiria"). Zbadać: skuteczność ekstrakcji pól per dokument (nr KW lokalu+gruntu, powierzchnia użytkowa, udział w nieruchomości wspólnej, dział II/III/IV z odpisu, sąd/wydział), koszt/latencja per strona, porównanie ścieżek (vision LLM vs OCR), stabilność na skanach. **F-9 KRYTYCZNE: do results.json/RAPORT NIE trafiają PESEL-e, nazwiska ani numery KW w pełnej formie** (check-no-pii.sh skanuje repo; wzorzec scrubbingu ze spike'a `2026-07-17-egib-mpzp/spike.py`). Surowe ekstrakty tylko w `.claude/research/` (gitignored). Werdykt PASS/FAIL per ścieżka → checkpoint z userem → dopiero brainstorm.

**NAJPIERW PRZECZYTAJ (kontekst, w tej kolejności):**

- `wiki/roadmap.md` (wiki repo) — wpis NOW + DONE Slice 5 + NEXT (cechy/wagi F-6 — NIE wciągać)
- `wiki/topics/tech/kw-pozyskiwanie-danych.md` (wiki repo) — CAŁA analiza KW: brak darmowego API, ścieżki płatne, RODO/PUODO, **sekcja „Empiria"** (3 akty: para KW lokal+grunt wszędzie, powierzchnia WPROST w 2/2 wtórnych, paradoks deweloperski, rekomendacja akt=primary input)
- `wiki/topics/tech/subject-data-egib-mpzp-slice.md` (wiki repo) — stan po Slice 5 + STYK: blok faktów 8.2 czeka na pow. użytkową z KW i udział; adnotacja „udział — wg odpisu KW" do zastąpienia danymi; known limitation wielodziałkowości (AC E2a) częściowo rozwiązywalna przez KW
- `wiki/topics/tech/document-generator-slice.md` (wiki repo) — jak działa szablon (build_template.py, F-12) i co jest stubem sekcji KW
- `.superpowers/sdd/progress.md` (app repo) — ledger Slice 0-5 (konwencje, carry-forwardy, backlog; sekcja SLICE 5 + FINAL REVIEW + S5 QA na końcu)

**KLUCZOWE ZASADY (utrwalone też w auto-memory):**

- Kod/commity = ANGIELSKI (conventional commits, ≤100 znaków, lowercase-leading); UI copy i TREŚĆ OPERATU = POLSKI (pełne diakrytyki).
- **Spec MUSI otwierać się sekcją produktową** („Opis produktowy — co budujemy z perspektywy użytkownika").
- Żadnych wywołań sieciowych/LLM w testach CI (fixture'y ZANONIMIZOWANE ze spike'a). **F-11 nietknięte** (worker zwraca dane, nigdy WR). **F-9**: żadnych PESEL-i/pełnych numerów KW w fixture'ach — syntetyczne dane.
- Szablon operatu regeneruje się WYŁĄCZNIE przez `build_template.py` (wiki-repo `tools/spike/2026-07-15-template-koscielna/`) + rozszerzenie F-12. Nigdy ręczna edycja .docx.
- Niewidoczne znaki jako escape (` `); **narzędzie Edit konwertuje escape w żywy NBSP — takie fragmenty pisać przez Python file I/O** (lekcja Slice 5).
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run watch --exit-status`. Worker: `uv run ruff check . && uv run ruff format --check . && uv run pytest -q` (format-check jest w CI — lekcja Slice 5). Focused testy: `pnpm --filter web exec vitest run <path>` (`-- <pattern>` NIE filtruje!).
- Framework API przez context7/skill claude-api, nie z pamięci. CodeGraph w app-repo przed grepem.
- **RTL/component-test infra ma podniesiony priorytet** (3 bugi Slice 5 chowały się w tej dziurze) — jeśli slice dotyka formularza, rozważ wprowadzenie infra jako task.

**STAN INFRA (zweryfikowany 2026-07-17 po Slice 5):**

- App repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, commit+push wprost, HEAD `5714b4f`. CI: joby `ci` + `e2e` (LibreOffice na runnerze; auto-fetch danych przedmiotu w e2e wyłączony `NEXT_PUBLIC_SUBJECT_AUTOFETCH=off`).
- Wiki repo `make-it-simple-rayshar/wyceny` — main CHRONIONY (PR + podpisane commity; branch dla S6 NOWY z origin/main). **Sprawdź, czy PR #8 (docs Slice 5 + promocja NOW=KW/akt) jest zmergowany — jeśli nie, blokada startu.**
- Prod: web https://wyceny-mu.vercel.app (`vercel deploy --prod` Z KORZENIA monorepo; `.vercelignore` zawiera: `.codegraph`, `apps/worker/.venv`, `.superpowers`, test-artefakty, `.turbo`, `apps/web/.next` — **limit Vercela = 100 MB POJEDYNCZEGO pliku**), worker https://worker-v2-production.up.railway.app (builder DOCKERFILE, LibreOffice+Carlito; deploy `railway up ./apps/worker --path-as-root --service worker-v2`; startCommand BEZ shella). Demo: przyciski na loginie (aneta=admin, zenon=rzeczoznawca).
- Prod DB / sekrety: `railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" <cmd>'`. Migracje: NAJPIERW migracja, potem deploy (kolejność migracja→worker→web). Zastosowane: 0000-0008 (Slice 5 bez migracji!). Upload plików będzie pewnie wymagał NOWEJ migracji (tabela/kolumny) — pierwsza od 0008.
- Stan danych: pełny cykl żywy (adres → auto-fetch EGiB/MPZP → próba RCN → potwierdzenia → zatwierdź → operat PDF+DOCX z sekcjami 8.2/9 z danych). Formularz ma: adres, powierzchnia, cel, **nr KW (jeden slot — do ewolucji w 2 sloty!)**, zamawiający, data oględzin, sekcja „Dane przedmiotu" (EGiB/MPZP + rok budowy ręczny), próba, cechy/wagi. QA-artefakty w prod DB: 3 wyceny `KW-QA-SLICE5*`.

**DO ROZSTRZYGNIĘCIA (spike → brainstorm), m.in.:** ekstraktor (vision LLM — który model/API? OCR lokalny? odpis EKW bywa czystym wydrukiem — może pdftotext wystarczy dla odpisów?); gdzie ekstrakcja (worker za portem — ADR-009 — czy web action?); model danych dwóch slotów KW + wariant deweloperski (księga matka) + migracja; które pola zasilają dokument (pow. użytkowa lokalu z KW! udział w nieruchomości wspólnej — adnotacja w 8.2 do zastąpienia; rozbieżność pow. KW↔formularz jak w makiecie?); prowenancja `odpis_kw`/`akt` (enum kernela JUŻ je ma) + brama F-4; RODO: co przechowujemy (plik? tylko ekstrakt? retencja? PESEL-e NIE wchodzą do aplikacji — F-9); UX uploadu (makieta v3-r4: KwSourcePicker akt/odpis/ręczny + banner deweloperski — obejrzyj klikalnie przez `python3 -m http.server` w katalogu makiety, file:// blokowane).

**CHECKPOINTY (pauzuj, pytaj usera):** (a) werdykt spike'a, (b) zakres/outcome po brainstormie, (c) akceptacja planu, (d) deploye/sekrety/migracja w S5, (e) merge wiki-PR robi user. Między checkpointami działaj autonomicznie.

**START:** sprawdź merge PR #8 → przeczytaj konteksty z listy → SPIKE (krok 0, próbki z `raw/documents/uzupełnienie/`, scrub PII!) → checkpoint werdyktu → `superpowers:brainstorming`.
