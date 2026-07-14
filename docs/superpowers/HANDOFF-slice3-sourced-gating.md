# Handoff — Slice 3: Sourced<T> E2E + brama gatingu (F-4) — start od brainstormu

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille). Uwaga: inaczej niż przy Slice 2, **spec i plan jeszcze NIE istnieją** — sesja zaczyna od S1 (brainstorm) i S2 (writing-plans), z checkpointami usera przy zakresie i planie.

---

Poprowadź **Slice 3 — Prowenancja `Sourced<T>` E2E + brama gatingu (F-4)** przez pełny cykl `/build-slice` od S1: brainstorm zakresu (⛔ checkpoint user) → `superpowers:writing-plans` (⛔ checkpoint user) → `superpowers:subagent-driven-development` (świeży implementer + niezależny reviewer per task, commit+push per task, ledger `.superpowers/sdd/progress.md`, briefy `srcd-task-N-*.md`) → CI/fitness → deploy (⛔) → wiki S6 (PR).

**ITEM ROADMAPY (🟢 NOW, promowany decyzją usera 2026-07-14):** wiki `wiki/roadmap.md` — outcome: każda wartość wejściowa niesie prowenancję (`confirmed`/`to_verify`/`none`), **brama gatingu blokuje zatwierdzenie operatu** dopóki cokolwiek jest `to_verify`/`none` (**F-4**, AC-3). `Must-Legal` (pre-mortem #1). Ten slice domyka też **twardy próg ≥12 transakcji** (dziś miękkie amber ostrzeżenie).

**NAJPIERW PRZECZYTAJ (kontekst, w tej kolejności):**

- `wiki/roadmap.md` (wiki repo) — wpis NOW + DONE Slice 2 (fundament)
- `wiki/topics/tech/rcn-sample-fetch-slice.md` (wiki repo) — co już jest w snapshotcie (`source`/`transactionId`/`sampleMeta`) + backlog slice'a
- `wiki/decisions/ADR-010-sourced-provenance-shared-kernel.md` + `ADR-012-gating-synchronous-process-manager.md` (wiki repo) — zapadnięte decyzje architektoniczne dla tego slice'a
- `packages/shared/src/sourced.ts` (app repo) — istniejące prymitywy `Sourced<T>`/`isBlocking()` ze Slice 0 (dotąd niewpięte w domenę)
- `.superpowers/sdd/progress.md` (app repo) — ledger Slice 0-2 (konwencje, carry-forwardy, backlog)

**KLUCZOWE ZASADY (utrwalone też w auto-memory):**

- Kod/commity = ANGIELSKI (conventional commits, lefthook aktywny); UI copy = POLSKI (pełne diakrytyki).
- **Bez spike'a** — slice nie dotyka nowych zewnętrznych API (czysta domena/UI/snapshot); zasada spike-first nie triggeruje.
- Żadnych wywołań sieciowych w testach/CI. F-11 nietknięte. **F-4 wchodzi do CI tym slice'em** (+ twardy próg ≥12 w zod).
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run watch --exit-status`. Worker raczej nietknięty (jeśli jednak: `uv run pytest -q` + ruff).
- Framework API (Next/RHF/zod): weryfikuj przez context7/skille vercel — nie z pamięci.
- **CodeGraph**: app-repo zaindeksowane — `codegraph explore "<pytanie>"` PRZED grep/czytaniem plików (sekcja w CLAUDE.md app-repo).

**STAN INFRA (zweryfikowany 2026-07-14, po Slice 2):**

- App repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, commit+push wprost. CI: joby `ci` + `e2e`.
- Wiki repo `make-it-simple-rayshar/wyceny` — main CHRONIONY (PR + podpisane commity; branch dla S6: NOWY z origin/main). PR #4 (docs Slice 2) zmergowany.
- Prod: web https://wyceny-mu.vercel.app (`vercel deploy --prod` Z KORZENIA monorepo), worker **https://worker-v2-production.up.railway.app** (serwis `worker-v2`, region EU; deploy `railway up ./apps/worker --path-as-root --service worker-v2` — config-as-code w `apps/worker/railway.json`). Demo: aneta@wyceny.test/Admin123!, zenon@wyceny.test/Rzeczoznawca123! (strona logowania ma przyciski demo — bez wpisywania haseł).
- Railway plan Free (limit na NOWE projekty); stary serwis `worker` — sprawdź w ledgerze, czy już wygaszony.

**CHECKPOINTY (pauzuj, pytaj usera):** (a) zakres/outcome po brainstormie, (b) akceptacja planu, (c) deploye/sekrety w S5, (d) merge wiki-PR robi user. Między checkpointami działaj autonomicznie.

**START:** przeczytaj konteksty z listy, potem `superpowers:brainstorming` dla zakresu slice'a (m.in. do rozstrzygnięcia: które pola formularza dostają prowenancję w tym slice'u — wszystkie czy tylko próba+adres; UX bramy gatingu — gdzie widać `to_verify`; czy „zatwierdzenie" = istniejący zapis czy nowy krok statusu).
