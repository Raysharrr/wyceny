# Handoff — Slice 2: auto-fetch próby z RCN (wykonanie)

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille), żeby wykonać zatwierdzony plan w trybie subagent-driven.

---

Wykonaj plan **Slice 2 — auto-fetch próby z RCN** w trybie `superpowers:subagent-driven-development` (świeży implementer subagent per task → niezależny reviewer → fix loop → commit+push per task; ledger w `.superpowers/sdd/progress.md` app-repo — dopisuj, nazewnictwo briefów `rcn-task-N-*.md`).

**PLAN (zatwierdzony):** `~/Development/wyceny-app/docs/superpowers/plans/2026-07-14-rcn-sample-fetch.md` — 6 tasków (5 kodowych + deploy/QA/wiki).
**SPEC:** `~/Development/wyceny-app/docs/superpowers/specs/2026-07-14-rcn-sample-fetch-design.md`.

**NAJPIERW PRZECZYTAJ (kontekst, w tej kolejności):**

- spec + plan (jw.)
- `tools/spike/2026-07-14-rcn-live-revalidation/RAPORT.md` (wiki repo) — re-walidacja: parametry produkcyjne, selekcja v2, **odkrycie śmieciowych dat w RCN**
- `tools/spike/2026-05-14-kcs/spike.py` (wiki repo) — źródło portowanego kodu (parser GML, geocode, fetch; stałe `WFS_URL`/`NOMINATIM`/`USER_AGENT` kopiuj stamtąd VERBATIM)
- `.superpowers/sdd/progress.md` (app repo) — ledger Slice 1 (konwencje, carry-forwardy)
- `.claude/skills/build-slice/` (wiki repo) — rytm; jesteśmy na S3 (S0-S2 zamknięte: chunk zatwierdzony przez usera 2026-07-14, spike PASS, spec+plan zatwierdzone)

**KLUCZOWE ZASADY (utrwalone też w auto-memory):**

- Kod/commity = ANGIELSKI (conventional commits, lefthook aktywny: prettier staged + commitlint); UI copy = POLSKI (pełne diakrytyki).
- **Spike-first**: parametrów RCN i selekcji v2 NIE ulepszać — są przypięte spike'ami (plan: Global Constraints). Filtr sanity dat jest OBOWIĄZKOWY (RCN ma daty typu 5201-07).
- **Żadnych wywołań sieciowych w testach/CI** (GUGiK/Nominatim tylko w kodzie produkcyjnym; testy = monkeypatch/mock).
- F-11: worker NIGDY nie zwraca WR. F-5 wchodzi w CI tym slice'em.
- Per task: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` (web) / `uv run pytest -q` + ruff (worker) → commit → push → `gh run watch --exit-status`.
- Framework API (Next/RHF/zod/FastAPI): weryfikuj przez context7/skille vercel — nie z pamięci.

**STAN INFRA (zweryfikowany 2026-07-13/14):**

- App repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, commit+push wprost. CI: joby `ci` + `e2e` (oba muszą być zielone).
- Wiki repo `make-it-simple-rayshar/wyceny` — main CHRONIONY (PR + **podpisane commity**; klucz `~/.ssh/wyceny_signing` skonfigurowany, commit.gpgsign=true; branch dla S6: NOWY z origin/main!).
- Prod: web https://wyceny-mu.vercel.app (Vercel team make-it-simple, projekt `wyceny`, deploy `vercel deploy --prod` Z KORZENIA monorepo), worker https://worker-production-c672.up.railway.app (Railway projekt `wyceny`; deploy `railway up` — Task 6, checkpoint z userem). Demo: aneta@wyceny.test/Admin123!, zenon@wyceny.test/Rzeczoznawca123!.
- Gałąź wiki `slice2-prep` (spike) — PR czeka/zmergowany; sprawdź `gh pr list --repo make-it-simple-rayshar/wyceny`.

**CHECKPOINTY (pauzuj, pytaj usera):** Task 6 — deploy workera na Railway i weba na Vercel (każdy krok z sekretami/infra); merge wiki-PR robi user. Między checkpointami działaj autonomicznie (review+fix loop = bramka jakości).

**LIVE-DoD (uzgodnione z userem):** Kościelna przez „Pobierz próbę z RCN" → ≥12 żywych transakcji → WR w **paśmie ±10%** od 1 044 400 (spike: +6,5%) — NIE exact-golden. Golden co do złotówki zostaje na fixture (F-1).

**START:** Task 1 (worker pure core — bez sieci, bezpieczny start). Odpal `superpowers:subagent-driven-development` na planie i lecimy.
