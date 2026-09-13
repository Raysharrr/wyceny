# HANDOFF pairwise-s4-operat — Operat, prose and legacy signature

Status: D-ARCH/D-AUTO APPROVED2026-09-13. Await coordinator START only for dependency readiness; approval must not be requested again. Base: `origin/integration/pairwise-valuation`. Branch: `feature/pairwise-operat`. Dependency: S2 merged; parallel with S3.

Coordinator task: `01a09928-7929-7b71-ac87-01929eedf3b0`. Source repository `/Users/michalczekala/Development/wyceny-app`; coordinator worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-valuation`. Scope = this HANDOFF; report adjacent findings as follow-up, do not implement them.

## Start

1. Read this entire HANDOFF, `docs/superpowers/pairwise-valuation/SPEC.md`, `ARCHITECTURE.md`, `SOURCES.md`, and global constraints in `docs/superpowers/plans/2026-09-13-pairwise-valuation.md` from latest integration. Do not act on the historical plan's obsolete build-slice/worktree restrictions.
2. Read app CLAUDE.md and apps/web/AGENTS.md; CodeGraph before searching/reading source. Read relevant installed Next docs before framework edits.
3. Confirm START and dependencies, fetch origin, inspect `git log -5` and `git status --short`. Create a dedicated APP worktree from origin/integration, with the branch above. If Codex task starts in a Wyceny wiki project worktree, do not modify that checkout: all code commands use the explicitly created app worktree.
4. Install locked dependencies, build shared package. Use an isolated local test DB; never default to production or edit existing Zenon valuation. Coordinator owns `wyceny-pairwise-test` port5544; create your own separate PostgreSQL container on a verified free port for concurrent integration tests because migrations create cluster-wide app_role and collide in a shared cluster. This isolated local setup is authorized; no renewed user approval needed. Never change another task's server/env/worktree.
5. Report worktree, base SHA, current test baseline and any contract mismatch before edits. No secrets/PII in output or commits.

## Allowed ownership, interfaces, test steps and done criteria

## S4 — Method-aware document, prose and render lifecycle

**Files:** `domain/document-model.ts`, new `domain/pairwise-document.ts` and mandatory `domain/legacy-kcs-document.ts` for exact projection preservation, `domain/prose.ts`, `prose-hash.ts`, `app/valuations/[id]/prose-step-props.ts` if needed, render actions `preview-operat.ts`/`approve-valuation.ts`/`sign-valuation.ts`, `adapters/docx-render.ts`, template binary plus preserved legacy binary, idempotent app template patch script, `domain/operat-sections.ts` if generated output requires it; document/prose/action tests; Help methodology and sole ownership of Help manifest.ts new page registration. Worker prose contract changes only if required by actual existing schema, with parity tests. No S3 wizard files. Preserve existing public prose facts input signatures used by page.tsx; if a call-site change there is unavoidable, report it to coordinator for sequential integration after S3, not a concurrent edit.

**Interfaces:** consumes S1/S2. `buildDocumentModel` accepts a discriminated `result` for new paths while retaining legacy KCS argument compatibility as needed for existing tests. All production actions use computeValuation and common model preparation; renderer gets technical templateVersion. PP tables come from the same computed result, never recalculate corrections in template/worker.

- [ ] RED action and artifact assertions:

```ts
expect(ppDocumentText).toContain("porównywania parami");
expect(ppDocumentText).toContain("740 900");
expect(ppMethodTables).toHaveLength(4);
expect(legacySignedTextWithoutSignature).toBe(legacyApprovedTextWithoutSignature);
```

- [ ] First, before any production modification, freeze a synthetic reference DOCX text rendered by9b2903c (fractional weights included). Freeze the legacy binary AND projection before patching current template. Legacy signature uses neither new calculationIssues nor new feature validation. Add cross-version approved→signed comparison against that baseline, beyond the existing same-code signature test. Preserve current map/photo/signature/address masking paths. Patch idempotently; update SHA test in same commit. Preserve actual numbering10–13.
- [ ] Use the proven column mechanism in `tools/spike/2026-09-13-pairwise-columns`: a small adapter helper touching only caption-marked PP tables before Docxtemplater, checking table shape and matching cells/grid/widths. Preserve all other XML. This avoids a paid plugin or parallel generator.
- [ ] Implement four PP tables from SOURCES;3/4/5 columns, both rights. KCS mixed scale2/3 prints middle dash/note and fractional percentages. No blank extra PP/KCS methodology/table blocks in the wrong method.
- [ ] Add facts for method and PP corrections to affected prose sections only; preserve general descriptions and old KCS hash shape. Same WR with different pair corrections must still invalidate dependent prose. Manual texts retained.
- [ ] Render DOCX→real worker PDF for KCS legacy/current, PP3/4/5, custom long name/diacritics/fractions, both rights. Parse text and visually inspect pages, headings, wrapping and images; XML alone does not close acceptance.
- [ ] Add a production-entry fitness check rejecting direct computeKcs calls outside the dispatcher/explicit legacy module; ensure gates/facts/doc use effective PP comparables rather than the full retained pool.
- [ ] Run document/prose/actions/f7 tests, goldens and relevant worker contracts; no external paid calls in automated tests. Update Help methodology and run help-index.
- [ ] Commit `feat(operat): render pairwise method and preserve legacy signing`; PR to integration. Report actual PDF paths, test evidence, legacy compatibility limits.

## Baseline supplied by coordinator

`tools/spike/2026-09-13-legacy-render/baseline.json` contains synthetic legacy input and9b2903c approved-text hashes for both rights, fractional weights and prose. Full text/DOCX in `/tmp/pairwise-legacy-render`. Use it rather than regenerating expected output after edits. See RAPORT.md; revive approvedAt as Date.

## Execution settings and browser evidence

User accepted `thinking=medium` for subsequent implementation sessions on2026-09-13; retain the model. Coordinator/reviewer/tester settings stay unchanged. Escalate only for a concrete difficult regression or architecture issue, with the reason reported to coordinator.

After a meaningful integration, test the changed flow and existing KCS at the highest available layer on your own local web/worker/DB. Report exact commit, URLs/ports, tested rights, observable assertions and screenshot/trace paths. Distinguish UI walkthrough, unit/integration tests, baseline and CI; never claim skipped scenarios or PP E2E before the needed layers exist. Do not rerun the whole suite after each tiny edit. The Codex in-app reader showed blank PDF on S1 while Chrome displayed the same generated PDF correctly; use Chrome for actual document visual checks. S1 evidence: `docs/superpowers/pairwise-valuation/S1-BROWSER.md`.

## Review and finish

Provide exact tests/results and known limits, changed contract signatures, Help status and artifact paths. Commit/push with hooks intact. Open PR ONLY to `integration/pairwise-valuation`; never merge into main, deploy, force-push or delete other worktrees. Do not merge your own PR until coordinator review gates finish. Keep worktree for fixes and report via `send_message_to_thread` to coordinator with `DONE: pairwise-s4-operat`, PR URL, branch, worktree and test evidence. If blocked, state concrete cause and continue independent authorized work. Never assume missing user answers mean approval.
