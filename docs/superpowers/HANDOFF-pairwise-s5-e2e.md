# HANDOFF pairwise-s5-e2e — Integrated acceptance and E2E

Status: D-ARCH/D-AUTO APPROVED2026-09-13. Await coordinator START only for dependency readiness; approval must not be requested again. Base: `origin/integration/pairwise-valuation`. Branch: `feature/pairwise-e2e`. Dependency: S3 and S4 merged.

Coordinator task: `01a09928-7929-7b71-ac87-01929eedf3b0`. Source repository `/Users/michalczekala/Development/wyceny-app`; coordinator worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-valuation`. Scope = this HANDOFF; report adjacent findings as follow-up, do not implement them.

## Start

1. Read this entire HANDOFF, `docs/superpowers/pairwise-valuation/SPEC.md`, `ARCHITECTURE.md`, `SOURCES.md`, and global constraints in `docs/superpowers/plans/2026-09-13-pairwise-valuation.md` from latest integration. Do not act on the historical plan's obsolete build-slice/worktree restrictions.
2. Read app CLAUDE.md and apps/web/AGENTS.md; CodeGraph before searching/reading source. Read relevant installed Next docs before framework edits.
3. Confirm START and dependencies, fetch origin, inspect `git log -5` and `git status --short`. Create a dedicated APP worktree from origin/integration, with the branch above. If Codex task starts in a Wyceny wiki project worktree, do not modify that checkout: all code commands use the explicitly created app worktree.
4. Install locked dependencies, build shared package. Use an isolated local test DB; never default to production or edit existing Zenon valuation. Coordinator owns `wyceny-pairwise-test` port5544; create your own separate PostgreSQL container on a verified free port for concurrent integration tests because migrations create cluster-wide app_role and collide in a shared cluster. This isolated local setup is authorized; no renewed user approval needed. Never change another task's server/env/worktree.
5. Report worktree, base SHA, current test baseline and any contract mismatch before edits. No secrets/PII in output or commits.

## Allowed ownership, interfaces, test steps and done criteria

## S5 — Integrated E2E and final delivery

**Files:** `apps/web/e2e/pairwise-valuation.spec.ts`, fixtures/pages shared only where repeated, `playwright.config.ts`, `package.json` e2e script inclusion, `e2e/README.md`, final QA checklist and evidence in docs. Production fixes go back to owner tasks before merging, not silently into test commits.

**Interfaces:** complete integration after S3+S4. Own isolated web/worker/storage/Postgres from that branch, no main worker masquerading as PP verification. Use synthetic data only.

- [ ] Write durable E2E mapped to SPEC AC01–AC12, methods×rights. Full happy path includes Opisy (deterministic worker fake/fixture), actual PDF, approval and signature with synthetic signature image. Do not use real client signatures/valuations.
- [ ] Negative tests: minimum/max samples, method change, stale form/basis, missing ratings, scale2 hidden average, bad weights, duplicate name, changed method/prose, permission/immutable states at appropriate unit/action layer.
- [ ] Repeat new E2E3×, ensure included in CI and total run<5min where practical; record actual duration and deviations. Preserve existing smoke/spoldzielcze tests and explicit safe staging project.
- [ ] Run full `pnpm format:check`, `pnpm turbo lint typecheck test build --env-mode=loose`, `pnpm depcruise`, worker ruff/pytest, CI and independent review. Local browser inspect existing design and actual PDF. Review Opus/high per delivery-workflow, plus coordinator code/manual review; fix before merge.
- [ ] Commit tests/docs and merge to integration after gates. Fetch/merge latest main into integration (no force/rebase shared branch), resolve and rerun affected checks.
- [ ] Deliver your test PR to integration. After its review/merge, the coordinator opens ONE final PR integration→main with complete acceptance evidence and stops for final concrete approval. Do not open a second final PR or deploy.

## Coordinator environment and deterministic Opisy coverage

Coordinator integration web: localhost:3015, worker127.0.0.1:8015, dedicated PostgreSQL5544. Environment is local-only in apps/web/.env. The browser login as seeded Zenon was verified. Do not use the user's main3000/main worker as evidence for this block.

For UI coverage of the existing Opisy step, prefer enabling it and filling/confirming manual synthetic sections after an honest unavailable-generation response from a worker without an LLM key. Assert retained text and staleness after edits. Pair that with S4 deterministic worker/prose adapter contract tests for the automatic path. Do not mark Opisy covered by NEXT_PUBLIC_PROSE=off or silently spend API tokens in E2E. If a deterministic worker response fixture is needed instead, agree the smallest test-only mechanism with coordinator; preserve production defaults and hosted stub guards.

## Execution settings and browser evidence

S5 is a test/verification session: retain the normal model and reasoning setting. The user's medium setting applies only to implementation sessions S2/S3/S4, not testers or reviewers.

After a meaningful integration, test the changed flow and existing KCS at the highest available layer on your own local web/worker/DB. Report exact commit, URLs/ports, tested rights, observable assertions and screenshot/trace paths. Distinguish UI walkthrough, unit/integration tests, baseline and CI; never claim skipped scenarios or PP E2E before the needed layers exist. Do not rerun the whole suite after each tiny edit. The Codex in-app reader showed blank PDF on S1 while Chrome displayed the same generated PDF correctly; use Chrome for actual document visual checks. S1 evidence: `docs/superpowers/pairwise-valuation/S1-BROWSER.md`.

## Review and finish

Provide exact tests/results and known limits, changed contract signatures, Help status and artifact paths. Commit/push with hooks intact. Open PR ONLY to `integration/pairwise-valuation`; never merge into main, deploy, force-push or delete other worktrees. Do not merge your own PR until coordinator review gates finish. Keep worktree for fixes and report via `send_message_to_thread` to coordinator with `DONE: pairwise-s5-e2e`, PR URL, branch, worktree and test evidence. If blocked, state concrete cause and continue independent authorized work. Never assume missing user answers mean approval.

## Frozen S2 and Git identity

Read `docs/superpowers/pairwise-valuation/S2-STATE.md` and `S2-REVIEW.md`: S2 merged as c7bb94a. User requires project-local Git author/committer `Michał Czekała <michal@make-simple.it>` and active gh account `Raysharrr`. Origin uses HTTPS and the local gh credential helper; SSH previously authenticated the wrong account. Verify effective config and absence of author/committer environment overrides before every commit; keep SSH signing enabled. Do not change global config or rewrite published history. Confirm GitHub attribution and verification after the first push. Report a mismatch and hold further publication, continuing independent coding/tests.

Coordinator prepared `docs/superpowers/pairwise-valuation/QA-CHECKLIST.md` as an unexecuted AC01–AC12 matrix. Refine against final S3/S4 labels, map durable test names to IDs, and record actual evidence; do not treat planned rows as PASS.

After both S3/S4 merge, extend `apps/web/tests/valuation-entry-fitness.test.ts` to include production entrypoints under `src/app/valuations` as well as actions/domain. S4 could not cover these unmerged S3 consumers on its separate branch; final integration must reject direct computeKcs outside dispatcher/explicit legacy path. This is a test boundary correction, not a new production refactor.

Coordinator already executed the actual S1-approved-before-update→S4-sign-after-update browser check for both rights; those retained DB5544 rows are now signed. See S4-REVIEW.md and /tmp/pairwise-s4-coordinator-browser/legacy-sign-evidence.json. Original approved artifacts remain unchanged. Do not try to sign them again; preserve evidence and cover deterministic legacy signing in your own isolated fixtures.

## Final integration inputs after S3/S4

Start from the refined integration containing S3 squash ad9f0c6 and S4 code c075dbb. Read S3-WIZARD/S3-REVIEW and S4-STATE/S4-REVIEW. S3 accessible pool selectors say “Transakcja N w puli”; assessment columns retain “Porównanie N”. PP Enter in ordinary inputs does not confirm; explicit confirmation supports keyboard activation. Use original-form expectedPairwiseBasis and canonical saved rows from S2.

S4 adds prepareOperatModel and renderer templateVersion; public prose facts signatures remain unchanged. All new method variants use valuation-v2, while signing absent-method approvals uses frozen legacy projection/template. Only actual overrides expose their retained reasons. Do not redefine these contracts in E2E.

Coordinator completed independent local changed-flow checks and both actual across-version legacy signatures. Your own durable tests must still exercise the complete modern four-way method/right matrix with active Opisy and real PDF, approval and synthetic signing. Never treat the placeholder produced by NEXT_PUBLIC_PROSE=off as coverage of manual prose. The known keyless worker/manual-edit approach is authorized; a deterministic test-only response fixture must preserve hosted guards and production defaults.

S4 GitHub metadata note: squash code c075dbb is already in integration and merge-tree equality proves the entire S4 branch is incorporated. A GitHub502 left PR44 metadata OPEN; coordinator closed the integrated PR without another merge/history rewrite. Use the verified code state, not the PR badge, for dependency readiness.
