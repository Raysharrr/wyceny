# Dev-Infra Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the missing delivery gates — prettier, eslint in `packages/shared`, lefthook+commitlint, ruff, one Playwright smoke E2E — so every commit of the upcoming KCS slice passes through them.

**Architecture:** All gates run twice: locally via lefthook (fast, staged-files-only) and in CI (authoritative, whole repo). Playwright gets its own CI job (needs a built app + live Postgres + worker). No app behavior changes in this plan.

**Tech Stack:** prettier 3, eslint 9 (flat config, typescript-eslint), lefthook, @commitlint/{cli,config-conventional}, ruff (uv dev group), @playwright/test.

**Spec:** `docs/superpowers/specs/2026-07-02-dev-infra-foundations-design.md`

## Global Constraints

- Code/comments/commit messages in **English**; UI copy stays **Polish** (NFR-10).
- Conventional commits (this plan introduces the gate — use them from Task 1 on).
- Fast-moving tool APIs: if a config below fails against the installed version, check current docs via `context7` — do not invent syntax.
- Monorepo root: `~/Development/wyceny-app`. Package manager: pnpm 10 (workspace). Node 22.
- Never commit real secrets; CI uses the dummy env pattern already present in `.github/workflows/ci.yml:9-17`.

---

### Task 1: Prettier — config, repo-wide format, CI gate

**Files:**

- Create: `.prettierrc.json`, `.prettierignore`
- Modify: `package.json` (root — devDeps + scripts), `.github/workflows/ci.yml` (new step after "Install dependencies")

**Interfaces:**

- Produces: root scripts `format` (`prettier --write .`) and `format:check` (`prettier --check .`) — Task 3's lefthook and CI rely on `format:check`; the whole repo is prettier-clean after this task.

- [ ] **Step 1: Install prettier at the workspace root**

```bash
pnpm add -D -w prettier
```

- [ ] **Step 2: Create `.prettierrc.json`**

```json
{
  "printWidth": 100,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

(Matches the dominant style already in the repo — double quotes, semicolons, ~100-col lines — so the format commit stays small.)

- [ ] **Step 3: Create `.prettierignore`**

```
node_modules
.next
.turbo
dist
build
pnpm-lock.yaml
apps/web/src/db/migrations
apps/worker
.superpowers
```

(`apps/worker` is Python — ruff owns it, Task 4. Drizzle migrations are generated SQL/JSON.)

- [ ] **Step 4: Add root scripts**

In root `package.json` `"scripts"`, add:

```json
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 5: RED — verify the gate catches the unformatted repo**

Run: `pnpm format:check`
Expected: FAIL (non-zero exit) listing files with style issues. If it unexpectedly PASSES, the repo is already clean — skip Step 7's separate commit.

- [ ] **Step 6: Commit the config (before the noise)**

```bash
git add .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: add prettier config and format scripts"
```

- [ ] **Step 7: Format the repo — separate, mechanical commit**

```bash
pnpm format
pnpm format:check   # expected: PASS
pnpm turbo lint typecheck test --env-mode=loose   # expected: PASS — formatting must not change behavior
git add -A
git commit -m "style: format repo with prettier"
```

- [ ] **Step 8: Add the CI gate**

In `.github/workflows/ci.yml`, after the "Install dependencies" step (line 51-52), insert:

```yaml
- name: Format check (prettier)
  run: pnpm format:check
```

- [ ] **Step 9: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add prettier format gate"
```

---

### Task 2: Real eslint in `packages/shared`

**Files:**

- Create: `packages/shared/eslint.config.mjs`
- Modify: `packages/shared/package.json` (devDeps + `lint` script — currently `echo "no lint configured yet"`)

**Interfaces:**

- Consumes: nothing new.
- Produces: `pnpm turbo lint` now actually lints `packages/shared` (plain TS, no React). CI's existing "Lint, typecheck, test, build (turbo)" step (`ci.yml:72-73`) picks it up with no CI change.

- [ ] **Step 1: Install eslint + typescript-eslint in the package**

```bash
pnpm --filter shared add -D eslint typescript-eslint
```

- [ ] **Step 2: Create `packages/shared/eslint.config.mjs`**

```js
import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["dist/**"] }, ...tseslint.configs.recommended);
```

- [ ] **Step 3: Point the `lint` script at eslint**

In `packages/shared/package.json`, replace:

```json
"lint": "echo \"no lint configured yet\""
```

with:

```json
"lint": "eslint src"
```

- [ ] **Step 4: RED→GREEN — run it, fix findings**

Run: `pnpm --filter shared lint`
Expected: exits 0 (the package is one small `sourced.ts` + test). If findings appear, fix them (they are real); do not blanket-disable rules — a targeted `// eslint-disable-next-line <rule>` with a one-line reason is acceptable only for false positives.

Then run the full pipeline to make sure nothing else regressed:

Run: `pnpm turbo lint typecheck test --env-mode=loose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "chore: wire real eslint for packages/shared"
```

---

### Task 3: lefthook + commitlint — local gates

**Files:**

- Create: `lefthook.yml`, `commitlint.config.mjs`
- Modify: root `package.json` (devDeps + `prepare` script)

**Interfaces:**

- Consumes: `format:check`-style prettier binary from Task 1 (runs `prettier --check` on staged files directly).
- Produces: git hooks active for every later task and slice — non-conventional commit messages and unformatted staged files are rejected locally. CI unchanged (it is the authoritative gate already).

- [ ] **Step 1: Install**

```bash
pnpm add -D -w lefthook @commitlint/cli @commitlint/config-conventional
```

- [ ] **Step 2: Create `commitlint.config.mjs`**

```js
export default { extends: ["@commitlint/config-conventional"] };
```

- [ ] **Step 3: Create `lefthook.yml`**

```yaml
# Local gates. Staged-files-only for speed; CI runs the full, authoritative
# versions of these checks. eslint intentionally stays CI-only (per-package
# flat-config resolution across the monorepo makes staged-file eslint
# unreliable; `turbo lint` covers it).
pre-commit:
  jobs:
    - name: prettier
      run: pnpm exec prettier --check {staged_files}
      glob: "*.{ts,tsx,js,mjs,cjs,json,md,yml,yaml,css}"

commit-msg:
  jobs:
    - name: commitlint
      run: pnpm exec commitlint --edit {1}
```

- [ ] **Step 4: Register hooks via `prepare`**

In root `package.json` `"scripts"`, add:

```json
"prepare": "lefthook install"
```

Run: `pnpm exec lefthook install`
Expected: `.git/hooks/pre-commit` and `.git/hooks/commit-msg` now exist (lefthook-managed).

- [ ] **Step 5: RED — prove both gates reject**

```bash
# Bad message must be rejected:
git commit --allow-empty -m "bad message no type"
```

Expected: FAIL with commitlint error (`subject may not be empty` / `type may not be empty`).

```bash
# Unformatted staged file must be rejected:
printf 'const  x=1;;\nexport default x\n' > /tmp/lefthook-probe.ts && cp /tmp/lefthook-probe.ts packages/shared/src/lefthook-probe.ts
git add packages/shared/src/lefthook-probe.ts
git commit -m "chore: probe"
```

Expected: FAIL on the prettier job.

```bash
# Clean up the probe:
git restore --staged packages/shared/src/lefthook-probe.ts && rm packages/shared/src/lefthook-probe.ts
```

- [ ] **Step 6: GREEN — a well-formed commit passes**

```bash
git add lefthook.yml commitlint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: add lefthook with prettier pre-commit and commitlint gates"
```

Expected: hooks run and the commit succeeds.

---

### Task 4: ruff for the worker — lint + format gate in CI

**Files:**

- Modify: `apps/worker/pyproject.toml` (dev group + `[tool.ruff]`), `.github/workflows/ci.yml` (step before "Worker tests (F-11)")

**Interfaces:**

- Produces: `uv run ruff check .` and `uv run ruff format --check .` clean in `apps/worker`; CI enforces both.

- [ ] **Step 1: Add ruff to the dev group**

```bash
cd apps/worker && uv add --dev ruff
```

- [ ] **Step 2: Configure in `apps/worker/pyproject.toml`**

Append:

```toml
[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 3: RED→GREEN — run and fix**

```bash
cd apps/worker && uv run ruff check . && uv run ruff format --check .
```

Expected: likely a handful of findings/reformat diffs in `app/` + `tests/`. Apply fixes:

```bash
uv run ruff check --fix . && uv run ruff format .
uv run pytest -q   # expected: PASS — formatting must not change behavior
```

- [ ] **Step 4: Add CI steps**

In `.github/workflows/ci.yml`, after "Set up Python + uv" (line 81-85) and **before** "Worker tests (F-11)", insert:

```yaml
- name: Worker lint (ruff)
  working-directory: apps/worker
  run: uv run ruff check . && uv run ruff format --check .
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker .github/workflows/ci.yml
git commit -m "chore: add ruff lint and format gate for worker"
```

---

### Task 5: Playwright smoke E2E + CI job

**Files:**

- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`
- Modify: `apps/web/package.json` (devDep + `e2e` script), `.github/workflows/ci.yml` (new `e2e` job), `apps/web/.gitignore` (playwright artifacts)

**Interfaces:**

- Consumes: seeded demo user from `apps/web/scripts/seed.ts` (`aneta@wyceny.test` / `Admin123!`); login form ids `#email`/`#password`, button text `Zaloguj się` (`apps/web/src/app/(auth)/login/login-form.tsx:41-54`); new-valuation form ids `#address`/`#area`, button `Utwórz wycenę` (`new-valuation-form.tsx`).
- Produces: `pnpm --filter web e2e` runs 1 smoke test against a production build. **NOTE for the KCS slice:** when próba/cechy become required form fields, `e2e/smoke.spec.ts` MUST be extended in the same task that changes the form.

- [ ] **Step 1: Install**

```bash
pnpm --filter web add -D @playwright/test
pnpm --filter web exec playwright install chromium
```

- [ ] **Step 2: Create `apps/web/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

// Smoke E2E against a real production build (`next start`), real Postgres and
// real worker — mirrors CI. Assumes DB is migrated+seeded and WORKER_URL is
// live before `pnpm e2e` runs (see the `e2e` job in .github/workflows/ci.yml).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Create `apps/web/e2e/smoke.spec.ts` (RED first — read it as the failing spec)**

```ts
import { expect, test } from "@playwright/test";

// The one smoke path: login → create valuation → detail shows WR.
// Demo credentials come from scripts/seed.ts (local/dev only, not secrets).
test("login → create valuation → detail shows WR", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("aneta@wyceny.test");
  await page.locator("#password").fill("Admin123!");
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await page.waitForURL("**/valuations");

  await page.goto("/valuations/new");
  await page.locator("#address").fill("ul. Testowa 1, Poznań");
  await page.locator("#area").fill("54.3");
  await page.getByRole("button", { name: "Utwórz wycenę" }).click();

  await page.waitForURL(/\/valuations\/[0-9a-f-]{36}/);
  await expect(page.getByText("Wartość rynkowa (WR)")).toBeVisible();
  await expect(page.getByText("zł")).toBeVisible();
});
```

- [ ] **Step 4: Add the script + gitignore entries**

In `apps/web/package.json` `"scripts"`, add:

```json
"e2e": "playwright test"
```

In `apps/web/.gitignore` (create if missing), append:

```
test-results/
playwright-report/
```

- [ ] **Step 5: GREEN — run locally**

Prereqs (one time): local Postgres up with migrations + seed applied, worker running:

```bash
cd apps/web && pnpm exec drizzle-kit migrate && pnpm seed && pnpm build
(cd ../worker && uv run uvicorn app.main:app --port 8000 &)
pnpm e2e
```

Expected: `1 passed`. Kill the background uvicorn afterwards.

- [ ] **Step 6: Add the `e2e` CI job**

In `.github/workflows/ci.yml`, add a second job after `ci` (same indentation level as `jobs.ci`). It reuses the same env/service pattern as the `ci` job — copy the `env:` block values exactly:

```yaml
e2e:
  runs-on: ubuntu-latest
  needs: ci
  env:
    DATABASE_URL: postgres://postgres:postgres@localhost:5432/wyceny
    BETTER_AUTH_SECRET: ci-dummy-secret-not-a-real-secret-0123456789abcdef
    BETTER_AUTH_URL: http://localhost:3000
    WORKER_URL: http://localhost:8000
    CI: "true"
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: wyceny
      ports:
        - 5432:5432
      options: >-
        --health-cmd "pg_isready -U postgres -d wyceny"
        --health-interval 5s
        --health-timeout 5s
        --health-retries 20
  steps:
    - name: Checkout
      uses: actions/checkout@v7
    - name: Set up pnpm
      uses: pnpm/action-setup@v6
    - name: Set up Node
      uses: actions/setup-node@v6
      with:
        node-version: "22"
        cache: "pnpm"
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    - name: Set up Python + uv
      uses: astral-sh/setup-uv@v8.2.0
      with:
        python-version: "3.12"
        enable-cache: true
    - name: Migrate + seed
      working-directory: apps/web
      run: pnpm exec drizzle-kit migrate && pnpm seed
    - name: Start worker
      working-directory: apps/worker
      run: uv run uvicorn app.main:app --port 8000 &
    - name: Build web
      run: pnpm turbo build --filter=web --env-mode=loose
    - name: Install Playwright browsers
      working-directory: apps/web
      run: pnpm exec playwright install --with-deps chromium
    - name: Smoke E2E
      working-directory: apps/web
      run: pnpm e2e
```

- [ ] **Step 7: Commit and push — verify CI green end-to-end**

```bash
git add apps/web .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "test: add playwright smoke e2e with dedicated ci job"
git push origin main
gh run watch --exit-status   # expected: both jobs (ci, e2e) green
```

---

## Definition of Done (mirrors the spec)

- [ ] Local commit with a non-conventional message or unformatted staged file is rejected by lefthook.
- [ ] CI gates green: prettier `format:check`, real eslint in `packages/shared` (via turbo), `ruff check` + `ruff format --check`, `e2e` job.
- [ ] Repo fully prettier-formatted in a dedicated `style:` commit.
- [ ] Smoke E2E passes in CI against real Postgres + worker.
