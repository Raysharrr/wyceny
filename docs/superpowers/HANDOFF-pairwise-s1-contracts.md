# HANDOFF pairwise-s1-contracts — Shared contracts and engines

Status: HOLD until coordinator START following approval of D-ARCH/D-AUTO and dependency check. Base: `origin/integration/pairwise-valuation`. Branch: `feature/pairwise-contracts`. Dependency: none.

Coordinator task: `01a09928-7929-7b71-ac87-01929eedf3b0`. Source repository `/Users/michalczekala/Development/wyceny-app`; coordinator worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-valuation`. Scope = this HANDOFF; report adjacent findings as follow-up, do not implement them.

## Start

1. Read this entire HANDOFF, `docs/superpowers/pairwise-valuation/SPEC.md`, `ARCHITECTURE.md`, `SOURCES.md`, and global constraints in `docs/superpowers/plans/2026-09-13-pairwise-valuation.md` from latest integration. Do not act on the historical plan's obsolete build-slice/worktree restrictions.
2. Read app CLAUDE.md and apps/web/AGENTS.md; CodeGraph before searching/reading source. Read relevant installed Next docs before framework edits.
3. Confirm START and dependencies, fetch origin, inspect `git log -5` and `git status --short`. Create a dedicated APP worktree from origin/integration, with the branch above. If Codex task starts in a Wyceny wiki project worktree, do not modify that checkout: all code commands use the explicitly created app worktree.
4. Install locked dependencies, build shared package. Use an isolated local test DB; never default to production or edit existing Zenon valuation. Coordinator owns `wyceny-pairwise-test` port5544; request separate DB/container for concurrent integration tests because migrations create cluster-wide app_role and collide in a shared cluster. Never change another task's server/env/worktree.
5. Report worktree, base SHA, current test baseline and any contract mismatch before edits. No secrets/PII in output or commits.

## Allowed ownership, interfaces, test steps and done criteria

## S1 — Shared feature/input contract and pure engines

**Files:** create `apps/web/src/domain/valuation-input.ts`, `feature-rules.ts`, `pairwise.ts`, `valuation-calculation.ts`; modify `domain/kcs.ts`, `feature-presets.ts`; tests `feature-rules.test.ts`, `pairwise.test.ts`, `valuation-calculation.test.ts`, `f6-feature-preset.test.ts`, existing KCS goldens.

**Interfaces:** produces SPEC signatures, existing KcsInput re-export, optional ratingScale/manual comparable id/method/pairwise fields. No actions/UI/template edits. `computeKcs` unchanged internally.

- [ ] Write RED reference arithmetic test with neutral fixture IDs using `tools/spike/2026-09-13-pairwise-reference/spike.py` numbers:

```ts
expect(computePairwise(referenceA).wr).toBe(740900);
expect(computePairwise(referenceB).wr).toBe(339400);
expect(suggestPairwiseMultiplier("przecietna", "lepsza", "three")).toBe(-0.5);
expect(suggestPairwiseMultiplier("gorsza", "lepsza", "two")).toBe(-1);
```

- [ ] Run `pnpm --filter web exec vitest run tests/pairwise.test.ts tests/feature-rules.test.ts`; verify missing behavior fails, then implement the approved SPEC using pure functions.
- [ ] Add edge assertions: ΔC0; null multiplier vs0; −0.25/−1.25 explicit overrides; finite positive area/prices; duplicate/missing identities; unknown method; scale2 middle invalid; names/weights; no rounding until PP final; legacy absent method/scale.
- [ ] Keep old KCS fixture values1044400/446900 exactly and F6 catalog9 unchanged. Run `pnpm --filter web exec vitest run tests/golden-wr.test.ts tests/golden-coop-piastowskie.test.ts tests/f6-feature-preset.test.ts` plus new tests and typecheck/depcruise.
- [ ] Commit `feat(valuation): add shared feature contracts and pairwise calculation`, push task branch, PR to integration. Report exported signatures, command results and limitations. Help: unchanged, contracts not exposed yet.

## Review and finish

Provide exact tests/results and known limits, changed contract signatures, Help status and artifact paths. Commit/push with hooks intact. Open PR ONLY to `integration/pairwise-valuation`; never merge into main, deploy, force-push or delete other worktrees. Do not merge your own PR until coordinator review gates finish. Keep worktree for fixes and report via `send_message_to_thread` to coordinator with `DONE: pairwise-s1-contracts`, PR URL, branch, worktree and test evidence. If blocked, state concrete cause and continue independent authorized work. Never assume missing user answers mean approval.
