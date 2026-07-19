# Handoff — Slice 8: Niezmienność + audit_log + podpis (F-7) — start od S1 brainstorm

Wklej poniższy blok w **nowej sesji Claude Code** uruchomionej w `/Users/michalczekala/Development/wyceny` (wiki repo — CLAUDE.md kontrakt + skille). To handoff STARTOWY — slice nie ma jeszcze brainstormu, specu ani planu; sesja prowadzi pełny cykl od S1.

---

Poprowadź **Slice 8 — Niezmienność + audit_log + podpis (F-7)** przez pełny cykl `/build-slice`: S1 brainstorm (⛔ checkpoint zakresu) → S2 spec+plan (⛔ checkpoint planu) → S3 `superpowers:subagent-driven-development` (świeży implementer + niezależny reviewer per task, commit+push per task, ledger `.superpowers/sdd/progress.md` — NOWA sekcja `# SLICE 8`, briefy `f7-task-N-brief.md`/`f7-task-N-report.md`) → S4 CI/fitness → S5 deploy (⛔) → S6 wiki docs (PR, merge robi user).

**NAJPIERW:** potwierdź, że `wiki/roadmap.md` NOW = „Niezmienność + audit_log + podpis (F-7)" (stan na 2026-07-19, wiki main `82fd186`). Jeśli nie — STOP, zapytaj usera.

**KONTEKST DO PRZECZYTANIA (w tej kolejności):**

1. `wiki/roadmap.md` — pozycja NOW (outcome: operat write-once po podpisie, ślad dowodowy; `Must-Legal`; status `signed` zarezerwowany od Slice 3).
2. `wiki/decisions/ADR-011-reprodukowalnosc-write-once-snapshot.md` — definicja F-7 jako fitness function ADVERSARIAL: „edycja podpisanego = odrzucona" (checkbox wciąż otwarty — ten slice go domyka).
3. `wiki/deliverables/2026-06-30-prd-mvp-wyceny.md` — **FR-12** (audit_log każdego etapu), **NFR-1** (operat podpisywany uprawnieniami rzeczoznawcy, OC, aplikacja = narzędzie), **NFR-3** (niezmienność po podpisaniu; zmiany = nowa wersja z audytem), encja „Profil rzeczoznawcy" z `dane do podpisu`, statusy domenowe „w toku / gotowy do podpisu / podpisany", sekcja Observability („audit_log wymagany prawnie", instrumentacja od dnia 1 pod metryki rubber-stamp).
4. `wiki/topics/product/mvp-gap-analysis-2026-07-18.md` — item 2 listy NOW (F-7 „domyka wszystkie" NFR-3/NFR-6; audit z FR-12 → F-7).
5. `wiki/topics/tech/sourced-gating-slice.md` — fundamenty ze Slice 3: enum statusów z ZAREZERWOWANYM `signed`, `assertDraft`/`assertNotSigned` (do konsolidacji w tym slice), backlog „CAS status-guard w UPDATE WHERE", „niezmienność DB-level → slice F-7", zakaz re-run backfill UPDATE.
6. `wiki/topics/tech/document-generator-slice.md` — jak działa zamrażanie: approve generuje DOCX+PDF i zapisuje BAJTY w Postgres (bytea) w tym samym UPDATE co flip statusu; route `/api/docs/[key]` serwuje wyłącznie `storage.get` (niezmienność zatwierdzonych EMPIRYCZNIE potwierdzona w QA Slice 7 — stary operat = stare bajty co do bajta).
7. App-repo `~/Development/wyceny-app`: `apps/web/src/domain/valuation.ts` (cykl statusów, guardy), `apps/web/src/adapters/valuation-drizzle.ts` (approve/confirm*), `apps/web/src/db/schema.ts` + `drizzle/` (ostatnia migracja **0008**).

**CO JUŻ ISTNIEJE (brainstorm nie wyważa otwartych drzwi):** zamrożone bajty dokumentów przy approve + serwowanie ze storage; statusy `in_progress`/`approved` + zarezerwowany `signed`; `assertDraft`/`assertNotSigned`; ownership/RLS (F-8); write-once `inputs`. **CZEGO NIE MA:** audit_log (zero), pola/akt podpisu, hash dokumentu, DB-level guard przed UPDATE po podpisie (CAS z backlogu Slice 3 nietknięty), wersjonowanie.

**ROZSTRZYGNIĘCIA DO BRAINSTORMU (S1, z userem — jedna kwestia na raz):**

1. **Czym jest „podpis" w MVP** — formalny akt w aplikacji (przejście `approved → signed` przez uprawnionego rzeczoznawcę + audyt + hash)? obraz podpisu/pieczęci w DOCX (uwaga: szablon TYLKO przez `build_template.py`)? podpis kwalifikowany (zewnętrzny dostawca ⇒ **spike-first obowiązkowy**, raczej LATER)? PRD: „dane do podpisu" w profilu rzeczoznawcy.
2. **Model audit_log** — jakie zdarzenia (FR-12 mówi „każdego etapu": create/fetch/confirm/approve/sign/download?), kształt tabeli, **PIERWSZA migracja DDL od 0008** (kolejność deployu: migrate → web — lekcja Slice 3), append-only jak `wiki/log.md`.
3. **Niezmienność DB-level** — trigger/constraint blokujący UPDATE/DELETE po `signed`, CAS status-guard w adapterze (backlog Slice 3), czy oba (defense-in-depth)?
4. **Hash/integralność** — SHA-256 bajtów DOCX/PDF w audit_log przy podpisie (tani ślad dowodowy)?
5. **Wersjonowanie** (NFR-3 „zmiany = nowa wersja z audytem") — w MVP (np. nowa wycena jako kopia z linkiem) czy świadome cięcie do LATER?
6. **Kształt testu F-7 w CI** (ADR-011): adversarial — próba edycji podpisanego odrzucona na WSZYSTKICH ścieżkach (action, repo, raw SQL-symulacja?); wzorzec: F-4 gate testy ze Slice 3.

**KLUCZOWE ZASADY (jak w poprzednich slice'ach):**

- Kod/commity = ANGIELSKI (conventional, ≤100 znaków, lowercase-leading, bez atrybucji); UI copy i treść operatu = POLSKI (pełne diakrytyki).
- **F-1 NIETYKALNE**: golden 1 044 400 zł; `computeKcs` bez zmian. **F-9**: syntetyczne fixture'y, zero 11-cyfrowych ciągów. **F-12**: szablon DOCX WYŁĄCZNIE przez wiki-repo `tools/spike/2026-07-15-template-koscielna/build_template.py` (diff buildera NIEskommitowany w wiki do S6 PR); NBSP przez Python I/O. Worker: nieruszany, chyba że decyzja brainstormu wymaga (np. PDF z podpisem) — wtedy F-11 pilnować.
- Spec (S2) MUSI otwierać się sekcją produktową „Opis produktowy — co budujemy z perspektywy użytkownika" (wymóg usera 2026-07-15).
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'` → `gh run watch <id> --exit-status`. Focused: `pnpm --filter web exec vitest run <path>` (`-- <pattern>` NIE filtruje). Lefthook/prettier na pre-commit: przy „Code style issues" → `pnpm exec prettier --write`.
- RTL: pragma `// @vitest-environment jsdom` + preambuła z `rtl-kw-section.test.tsx`. CodeGraph przed grepem (`codegraph explore`). Framework API przez context7. Migracje: wzorzec `railway run` / DATABASE_PUBLIC_URL (Slice 3/4).
- Advisor-review planu przed checkpointem (b) — złapał CRITICALe w Slice 6 i 7 (m.in. plan łamiący F-9, niewykonalne asercje).

**STAN INFRA (2026-07-19):** app repo `Raysharrr/wyceny` (`~/Development/wyceny-app`), main NIEchroniony, HEAD `8f258e1`; CI joby `ci`+`e2e` (e2e z `NEXT_PUBLIC_SUBJECT_AUTOFETCH=off`, `NEXT_PUBLIC_KW_UPLOAD=off`). Wiki repo `make-it-simple-rayshar/wyceny`, main CHRONIONY (PR, merge user), HEAD `82fd186`. Prod: web https://wyceny-mu.vercel.app (deployment `wyceny-1ke30typ9`), worker `worker-v2` Railway, Postgres Railway (ostatnia migracja 0008). Demo: aneta=admin, zenon=rzeczoznawca. Na prodzie są wyceny QA („QA S7 …") — nie kasować bez zgody usera.

**KONTEKST RÓWNOLEGŁY (nie blokuje, ale pamiętaj):** pytania do Anety zbierane w `wiki/deliverables/pytania-do-anety.md` — NOWE pytania z tego slice'a dopisuj tam (S6 PR); przy S6 promocja NEXT→NOW — kandydaci: „Obrazy w operacie — mapy WMS GUGiK" (rekomendowany, koncepcja gotowa w [[topics/tech/obrazy-w-operacie-koncepcja]]) vs „Oględziny FR-2" — DECYZJA USERA przy merge.

**CHECKPOINTY:** (a) zakres po brainstormie, (b) plan, (c) deploy GO (⚠️ ten slice ma DDL — kolejność migrate→web; sekrety: żadnych nowych, chyba że decyzja z S1), (d) merge wiki-PR, (e) commity w wiki repo za zgodą. Między checkpointami — w pełni autonomicznie.

**START:** przeczytaj konteksty (1-7) → `superpowers:brainstorming` (S1) — pytania do usera jedna na raz, zaczynając od rozstrzygnięcia 1 (czym jest podpis w MVP).
