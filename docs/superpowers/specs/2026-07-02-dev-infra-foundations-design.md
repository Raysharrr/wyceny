# Design: dev-infra foundations (mini-slice przed silnikiem KCS)

**Data:** 2026-07-02 · **Status:** zatwierdzony (brainstorm 2026-07-01/02) · **Wykonanie:** PRZED slice'em KCS

## TLDR

Audyt po Slice 0 wykazał braki fundamentów dev-infra: brak git hooks (lefthook/commitlint),
brak prettiera, pusty skrypt lint w `apps/web` (`echo "no lint configured yet"`), brak E2E
(playwright), brak lintera Pythona w CI. Ten mini-slice domyka bramki, żeby wszystkie commity
kolejnych slice'ów (począwszy od KCS) przechodziły przez nie od pierwszego dnia.

## Stan zastany (audyt 2026-07-01)

| Element | Stan |
|---|---|
| CI (GitHub Actions) | ✅ turbo lint+typecheck+test+build, F-9 (PII), F-10 (depcruise), pytest workera, migracje Drizzle |
| vitest (web, shared) | ✅ jest |
| eslint | ⚠️ `apps/web/eslint.config.mjs` istnieje, ale skrypt `lint` = `echo` — bramka pusta |
| prettier | ❌ brak |
| lefthook + commitlint | ❌ brak hooks |
| playwright (E2E) | ❌ brak |
| ruff (worker Python) | ❌ brak w CI |

## Zakres

1. **lefthook** (dev-dependency w root, config `lefthook.yml`):
   - `pre-commit`: prettier check + eslint na staged plikach (tylko zmienione — szybkie)
   - `commit-msg`: commitlint z presetem conventional commits
2. **prettier**: config w root (jeden dla monorepo), skrypt `format` / `format:check`,
   **jednorazowe sformatowanie całego repo jako osobny commit** (`style: format repo with prettier`),
   krok `format:check` w CI.
3. **eslint w `apps/web`**: podpiąć realny `eslint` pod skrypt `lint` (config już istnieje);
   naprawić ewentualne findings lub jawnie je wyciszyć z uzasadnieniem.
4. **playwright**: `@playwright/test` w `apps/web`, **jeden smoke E2E** pokrywający krytyczną
   ścieżkę obecnej appki: login → utwórz wycenę (adres+pow) → strona szczegółów pokazuje WR.
   Osobny job w CI (postgres service + migracje + build + `next start` + worker FastAPI przez
   `uv run uvicorn` w tle). Suita rośnie per slice — tu tylko szkielet + 1 test.
5. **ruff** dla `apps/worker`: konfiguracja w `pyproject.toml`, krok `uv run ruff check` w CI.

**Konwencja wersji API:** dokładne wersje/składnię configów (lefthook, commitlint, playwright,
ruff) implementer pobiera z `context7`/oficjalnych docs w momencie wykonania — nie utrwalamy
składni w tym specu (fast-moving APIs).

## Non-goals (YAGNI)

- semantic-release / changelog automation
- coverage thresholds, mutation testing
- więcej niż 1 test E2E (suita rośnie z feature'ami)
- pre-push hooks (CI jest bramką)
- migracja historii commitów do conventional (od teraz w przód)

## Piramida testów po tym slice

```
        E2E: playwright — 1 smoke (login→create→detail)     [CI]
   Integration: vitest (repo/RLS/storage/worker-contract)   [CI, istnieje]
 Unit: vitest (domain, shared) + pytest (worker)            [CI, istnieje]
```

## Definition of Done

- Lokalny commit z błędnym formatem/lint/nie-conventional message jest **blokowany** przez lefthook.
- CI ma bramki: `format:check`, realny eslint, `ruff check`, job playwright — wszystkie zielone.
- Repo w całości sformatowane prettierem (osobny commit).
- Smoke E2E przechodzi w CI na realnym Postgresie i workerze.
