# HANDOFF pairwise-s5-e2e — Integrated acceptance and E2E

Status: D-ARCH/D-AUTO APPROVED2026-09-13. Await coordinator START only for dependency readiness; approval must not be requested again. Base: `origin/integration/pairwise-valuation`. Branch: `feature/pairwise-e2e`. Dependency: S3 and S4 merged.

Coordinator task: `01a09928-7929-7b71-ac87-01929eedf3b0`. Source repository `/Users/michalczekala/Development/wyceny-app`; coordinator worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-valuation`. Scope = this HANDOFF; report adjacent findings as follow-up, do not implement them.

## Start

1. Read this entire HANDOFF, `docs/superpowers/pairwise-valuation/SPEC.md`, `ARCHITECTURE.md`, `SOURCES.md`, and global constraints in `docs/superpowers/plans/2026-09-13-pairwise-valuation.md` from latest integration. Do not act on the historical plan's obsolete build-slice/worktree restrictions.
2. Read app CLAUDE.md and apps/web/AGENTS.md; CodeGraph before searching/reading source. Read relevant installed Next docs before framework edits.
3. Confirm START and dependencies, fetch origin, inspect `git log -5` and `git status --short`. Create a dedicated APP worktree from origin/integration, with the branch above. If Codex task starts in a Wyceny wiki project worktree, do not modify that checkout: all code commands use the explicitly created app worktree.
4. Install locked dependencies, build shared package. Use an isolated local test DB; never default to production or edit existing Zenon valuation. Coordinator owns `wyceny-pairwise-test` port5544; request separate DB/container for concurrent integration tests because migrations create cluster-wide app_role and collide in a shared cluster. Never change another task's server/env/worktree.
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
- [ ] Open ONE final PR integration→main with complete acceptance matrix and evidence. Stop before merge/staging for final concrete approval; do not deploy partial feature.

## Coordinator environment and deterministic Opisy coverage

Coordinator integration web: localhost:3015, worker127.0.0.1:8015, dedicated PostgreSQL5544. Environment is local-only in apps/web/.env. The browser login as seeded Zenon was verified. Do not use the user's main3000/main worker as evidence for this block.

For UI coverage of the existing Opisy step, prefer enabling it and filling/confirming manual synthetic sections after an honest unavailable-generation response from a worker without an LLM key. Assert retained text and staleness after edits. Pair that with S4 deterministic worker/prose adapter contract tests for the automatic path. Do not mark Opisy covered by NEXT_PUBLIC_PROSE=off or silently spend API tokens in E2E. If a deterministic worker response fixture is needed instead, agree the smallest test-only mechanism with coordinator; preserve production defaults and hosted stub guards.

## Review and finish

Provide exact tests/results and known limits, changed contract signatures, Help status and artifact paths. Commit/push with hooks intact. Open PR ONLY to `integration/pairwise-valuation`; never merge into main, deploy, force-push or delete other worktrees. Do not merge your own PR until coordinator review gates finish. Keep worktree for fixes and report via `send_message_to_thread` to coordinator with `DONE: pairwise-s5-e2e`, PR URL, branch, worktree and test evidence. If blocked, state concrete cause and continue independent authorized work. Never assume missing user answers mean approval.
