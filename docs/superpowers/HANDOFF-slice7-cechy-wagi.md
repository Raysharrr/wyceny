# Handoff — Slice 7: Cechy/oceny/wagi (F-6) — start od brainstormu (bez spike'a)

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille). Ten slice NIE jest spike-first (zero nowych integracji zewnętrznych — czysto domenowo-formularzowy), zaczyna się od S1 (brainstorm). Spec i plan NIE istnieją.

---

Poprowadź **Slice 7 — Cechy/oceny/wagi (F-6)** przez cykl `/build-slice`: S1 brainstorm zakresu (⛔ checkpoint) → `superpowers:writing-plans` (⛔ checkpoint) → `superpowers:subagent-driven-development` (świeży implementer + niezależny reviewer per task, commit+push per task, ledger `.superpowers/sdd/progress.md`, briefy `cechy-task-N-*.md`) → CI/fitness → deploy (⛔) → wiki S6-docs (PR, merge robi user).

**ITEM ROADMAPY (🟢 NOW, promowany 2026-07-18 przy PR #9):** wiki `wiki/roadmap.md` — outcome: worek cech per typ (lokal), **preset wag (F-6, ADR-006)**, skala ocen jako **edytowalne defaulty per wycena** (wzorzec z sądówki Gościejewko §9.1 + definicje empiryczne z Kościelnej; ekstrapolacja poza skalę wg NI pkt 6.4 do rozważenia — kandydat na YAGNI). _Zależność od Anety zdjęta decyzją 2026-07-15 — weryfikacja defaultów przy testach aplikacji._ `Must-Viable`. Dziś: 6 cech/wag **hardcodowanych w formularzu od Slice 1** (40/30/10/10/4/6, oceny gorsza/przeciętna/lepsza) — slice przenosi je do edytowalnego presetu z domenowym słownikiem.

**NAJPIERW PRZECZYTAJ (kontekst, w tej kolejności):**

- `wiki/roadmap.md` (wiki repo) — wpis NOW + DONE Slice 6 + NEXT (niezmienność/podpis F-7 — NIE wciągać)
- `wiki/decisions/ADR-006-wagi-cech-preset-nie-r2.md` (wiki repo) — DECYZJA: preset edytowalny + uczciwa proza („wagi przyjęte na podstawie doświadczenia"), NIE auto-r² (50% wag niemierzalnych z danych — walidacja KCS n=12); opcja C (r² jako podpowiedź) = późniejszy dodatek
- `wiki/topics/domain/operat-gosciejewko-sadowy.md` (wiki repo) — wzorzec skali ocen §9.1 (sądówka) + kanoniczna lista cech lokali (6+3)
- `wiki/topics/tech/spike-2026-06-30-wzor-wag-empiryczny.md` (wiki repo) — empiria wzoru `waga=r²/Σr²` i dlaczego odrzucony
- `wiki/topics/tech/kcs-engine-slice.md` (wiki repo) — jak dziś liczy się Ui/ΣUi (konwencja zaokrągleń!) i gdzie w formularzu siedzą hardcodowane cechy
- `wiki/topics/tech/kw-akt-ekstrakcja-slice.md` (wiki repo) — stan po Slice 6 (ostatnim)
- `.superpowers/sdd/progress.md` (app repo) — ledger Slice 0-6 (konwencje, carry-forwardy, backlog; sekcja SLICE 6 + S5 QA na końcu)

**KLUCZOWE ZASADY (utrwalone też w auto-memory):**

- Kod/commity = ANGIELSKI (conventional commits, ≤100 znaków, lowercase-leading); UI copy i TREŚĆ OPERATU = POLSKI (pełne diakrytyki).
- **Spec MUSI otwierać się sekcją produktową** („Opis produktowy — co budujemy z perspektywy użytkownika").
- **F-1/F-2/F-3 NIETKNIĘTE**: golden test Kościelnej (1 044 400 zł co do złotówki, konwencja zaokrągleń ΣUi→3 miejsca) musi przejść bez zmiany wartości — preset defaultowy MUSI odtwarzać dzisiejsze 6 wag. **F-11 nietknięte** (worker nigdy nie liczy WR — ten slice pewnie w ogóle nie dotyka workera). **F-9**: syntetyczne dane w fixture'ach.
- Jeśli operat dostaje sekcję definicji skali ocen (§9): szablon regeneruje się WYŁĄCZNIE przez `build_template.py` (wiki-repo `tools/spike/2026-07-15-template-koscielna/`) + rozszerzenie F-12. Nigdy ręczna edycja .docx.
- Niewidoczne znaki jako escape (` `); **narzędzie Edit konwertuje escape w żywy NBSP — takie fragmenty pisać przez Python file I/O** (lekcja Slice 5).
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'` → `gh run watch <id> --exit-status` (bare watch pada nieinteraktywnie). Focused testy: `pnpm --filter web exec vitest run <path>` (`-- <pattern>` NIE filtruje!).
- **RTL-infra JUŻ JEST** (od Slice 6): per-plik pragma `// @vitest-environment jsdom` (global zostaje "node") + `import "@testing-library/jest-dom/vitest"`; wzorzec w `rtl-kw-section.test.tsx`. Slice formularzowy = pisz testy komponentowe od początku.
- Framework API przez context7/skill claude-api, nie z pamięci. CodeGraph w app-repo przed grepem.

**STAN INFRA (zweryfikowany 2026-07-18 po Slice 6):**

- App repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, commit+push wprost, HEAD `a744595`. CI: joby `ci` + `e2e` (e2e jeździ z `NEXT_PUBLIC_SUBJECT_AUTOFETCH=off` i `NEXT_PUBLIC_KW_UPLOAD=off`).
- Wiki repo `make-it-simple-rayshar/wyceny` — main CHRONIONY (PR + podpisane commity; branch dla docs NOWY z origin/main). **Sprawdź, czy PR #9 (docs Slice 6 + promocja NOW=Cechy/wagi) jest zmergowany — jeśli nie, blokada startu.**
- Prod: web https://wyceny-mu.vercel.app (`vercel deploy --prod` Z KORZENIA monorepo; `.vercelignore` pilnuje limitu 100 MB POJEDYNCZEGO pliku), worker https://worker-v2-production.up.railway.app (builder DOCKERFILE; deploy `railway up ./apps/worker --path-as-root --service worker-v2 --ci`). Demo: przyciski na loginie (aneta=admin, zenon=rzeczoznawca).
- Prod DB: `railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-` → psql wprost (CLI zlinkowane do worker-v2; `railway run` env injection zawodne). Migracje zastosowane: 0000-0008 (Slice 5 i 6 bez DDL — snapshot `inputs` jsonb mieści nowe dane; preset per wycena pewnie też zmieści się w `inputs`, globalny preset może wymagać nowej tabeli → brainstorm).
- Sekrety prod (Slice 6): `WORKER_SHARED_SECRET` (Railway+Vercel), `ANTHROPIC_API_KEY` (Railway), `CORS_ALLOW_ORIGINS`, `NEXT_PUBLIC_WORKER_URL` — ten slice raczej ich nie dotyka.
- Stan danych: pełny cykl żywy (adres → EGiB/MPZP → KW/akt upload+ekstrakcja → próba RCN → potwierdzenia → zatwierdź → operat PDF+DOCX). QA-artefakty w prod DB: wyceny `KW-QA-SLICE5*` i `KW-QA-SLICE6*`.

**DO ROZSTRZYGNIĘCIA (brainstorm), m.in.:** model presetu (globalny słownik cech per typ obiektu — ADR-008 open/closed — vs kopiowany do wyceny; edycja per wycena = defaulty + nadpisania?); czy cechy są dodawalne/usuwalne czy tylko wagi edytowalne (Σ=100% walidacja już jest); definicje skali ocen (gorsza/przeciętna/lepsza — skąd tekst definicji do operatu §9: wzorzec Gościejewko + empiria Kościelnej; per cecha czy globalne?); ekstrapolacja poza skalę (NI pkt 6.4) — YAGNI-kandydat na LATER; kształt **F-6 w CI** (co dokładnie pilnuje: preset odtwarza golden? słownik cech kompletny?); zgodność wstecz (istniejące wyceny prod mają 6 hardcodowanych cech w `inputs` — write-once, nie ruszać); wpływ na szablon operatu (sekcja §9 — jeśli tak: build_template.py + F-12); prowenancja wag (ręczna edycja = `rzeczoznawca/confirmed` jak dziś? preset = jakie źródło?).

**CHECKPOINTY (pauzuj, pytaj usera):** (a) zakres/outcome po brainstormie, (b) akceptacja planu, (c) deploye/sekrety/ew. migracja w S5, (d) merge wiki-PR robi user. Między checkpointami działaj autonomicznie.

**START:** sprawdź merge PR #9 → przeczytaj konteksty z listy → `superpowers:brainstorming`.
