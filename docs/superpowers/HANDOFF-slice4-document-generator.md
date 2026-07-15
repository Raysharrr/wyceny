# Handoff — Slice 4: Generator dokumentu operatu (DOCX→PDF, F-12) — start od brainstormu

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille). Jak przy Slice 3: **spec i plan jeszcze NIE istnieją** — sesja zaczyna od S1 (brainstorm) i S2 (writing-plans), z checkpointami usera przy zakresie i planie.

---

Poprowadź **Slice 4 — Generator dokumentu operatu (DOCX→PDF, F-12)** przez pełny cykl `/build-slice` od S1: brainstorm zakresu (⛔ checkpoint user) → `superpowers:writing-plans` (⛔ checkpoint user) → `superpowers:subagent-driven-development` (świeży implementer + niezależny reviewer per task, commit+push per task, ledger `.superpowers/sdd/progress.md`, briefy `docgen-task-N-*.md`) → CI/fitness → deploy (⛔) → wiki S6 (PR).

**ITEM ROADMAPY (🟢 NOW, promowany decyzją usera 2026-07-15):** wiki `wiki/roadmap.md` — outcome: z **zatwierdzonej** wyceny powstaje kompletny operat szacunkowy (≥19 sekcji wg KSWN) jako DOCX→PDF — koniec stubu tekstowego. **Maskowanie tajemnicy = F-12 w CI.** `Must-Legal` (KSWN).

**NAJPIERW PRZECZYTAJ (kontekst, w tej kolejności):**

- `wiki/roadmap.md` (wiki repo) — wpis NOW + DONE Slice 3 (fundament: dokument generuje się z operatu, który przeszedł bramę F-4)
- `wiki/topics/tech/spike-2026-06-05-dokument-path.md` (wiki repo) — spike ZAMKNIĘTY: num2words PLN + docxtemplater + DOCX→PDF odtwarza operat Kościelnej (kod w `tools/spike/`)
- `wiki/topics/tech/operat-content-mapping.md` (wiki repo) — content audit per-sekcja per-pole (12 źródeł danych, template blueprint)
- `wiki/topics/tech/sourced-gating-slice.md` (wiki repo) — co dał Slice 3 (cykl szkic→zatwierdzony, prowenancja w snapshotcie) + backlog
- `.superpowers/sdd/progress.md` (app repo) — ledger Slice 0-3 (konwencje, carry-forwardy, backlog; sekcja SLICE 3 na końcu)

**KLUCZOWE ZASADY (utrwalone też w auto-memory):**

- Kod/commity = ANGIELSKI (conventional commits, lefthook, commitlint limit 100 znaków nagłówka); UI copy i TREŚĆ OPERATU = POLSKI (pełne diakrytyki).
- **Bez nowego spike'a** — ścieżka dokumentu ma spike CLOSED (2026-06-05); jeśli brainstorm odkryje NOWE niezwalidowane API (np. konwersja DOCX→PDF w chmurze), wtedy spike-first.
- Żadnych wywołań sieciowych w testach/CI. **F-11 nietknięte** (worker składa dokument, ale NIGDY nie zwraca WR — WR idzie DO workera jako dana). **F-12 wchodzi do CI tym slice'em** (maskowanie tajemnicy).
- Składanie dokumentu po stronie **workera** (ADR-009, OHS/ACL): docxtemplater to biblioteka JS — brainstorm musi rozstrzygnąć, czy składanie jednak w web (Node), czy worker dostaje inny mechanizm (python-docx-template?); spike używał docxtemplater w Node — NIE zakładaj z pamięci, sprawdź `tools/spike/` i raport spike'a.
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run watch --exit-status`. Worker (jeśli dotykany): `uv run pytest -q` + ruff.
- Framework API (Next/RHF/zod/docxtemplater): weryfikuj przez context7 — nie z pamięci.
- **CodeGraph**: app-repo zaindeksowane — `codegraph explore "<pytanie>"` PRZED grep/czytaniem plików.

**STAN INFRA (zweryfikowany 2026-07-15, po Slice 3):**

- App repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, commit+push wprost, HEAD `e562bf9`. CI: joby `ci` + `e2e`.
- Wiki repo `make-it-simple-rayshar/wyceny` — main CHRONIONY (PR + podpisane commity; branch dla S6: NOWY z origin/main). PR #5 (docs Slice 3) — sprawdź, czy zmergowany.
- Prod: web https://wyceny-mu.vercel.app (`vercel deploy --prod` Z KORZENIA monorepo), worker https://worker-v2-production.up.railway.app (`railway up ./apps/worker --path-as-root --service worker-v2`). Demo: przyciski na stronie logowania (aneta=admin, zenon=rzeczoznawca).
- **Prod DB / sekrety**: `DATABASE_URL` w Vercelu jest _sensitive_ (`vercel env pull` daje pustkę!) — wzorzec: `railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" <cmd>'` (sekret nie materializuje się). Migracje: NAJPIERW migracja, POTEM deploy; backfillu z 0007 nigdy nie re-runować.
- Stan danych: cykl szkic→zatwierdzony żywy; dokument = stub tekstowy w storage (`/api/docs/<key>` z autoryzacją właściciela — punkt zaczepienia dla PDF).

**DO ROZSTRZYGNIĘCIA W BRAINSTORMIE (m.in.):** gdzie składa się DOCX (web/Node z docxtemplater jak w spike'u vs worker/Python) i gdzie konwersja PDF; kiedy generować (przy zatwierdzeniu? na żądanie?); co dokładnie maskuje F-12 i jak to testować w CI; czy stub-dokument znika czy zostaje dla szkiców; skąd brakujące sekcje operatu (≥19 wg KSWN) przy dzisiejszym zakresie danych — co stubem, co realne.

**CHECKPOINTY (pauzuj, pytaj usera):** (a) zakres/outcome po brainstormie, (b) akceptacja planu, (c) deploye/sekrety w S5, (d) merge wiki-PR robi user. Między checkpointami działaj autonomicznie.

**START:** przeczytaj konteksty z listy, potem `superpowers:brainstorming` dla zakresu slice'a.
