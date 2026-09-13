# HANDOFF pairwise-s3-wizard — Wizard and apartment features

Status: D-ARCH/D-AUTO APPROVED2026-09-13. Await coordinator START only for dependency readiness; approval must not be requested again. Base: `origin/integration/pairwise-valuation`. Branch: `feature/pairwise-wizard`. Dependency: S2 merged.

Coordinator task: `01a09928-7929-7b71-ac87-01929eedf3b0`. Source repository `/Users/michalczekala/Development/wyceny-app`; coordinator worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-valuation`. Scope = this HANDOFF; report adjacent findings as follow-up, do not implement them.

## Start

1. Read this entire HANDOFF, `docs/superpowers/pairwise-valuation/SPEC.md`, `ARCHITECTURE.md`, `SOURCES.md`, and global constraints in `docs/superpowers/plans/2026-09-13-pairwise-valuation.md` from latest integration. Do not act on the historical plan's obsolete build-slice/worktree restrictions.
2. Read app CLAUDE.md and apps/web/AGENTS.md; CodeGraph before searching/reading source. Read relevant installed Next docs before framework edits.
3. Confirm START and dependencies, fetch origin, inspect `git log -5` and `git status --short`. Create a dedicated APP worktree from origin/integration, with the branch above. If Codex task starts in a Wyceny wiki project worktree, do not modify that checkout: all code commands use the explicitly created app worktree.
4. Install locked dependencies, build shared package. Use an isolated local test DB; never default to production or edit existing Zenon valuation. Coordinator owns `wyceny-pairwise-test` port5544; create your own separate PostgreSQL container on a verified free port for concurrent integration tests because migrations create cluster-wide app_role and collide in a shared cluster. This isolated local setup is authorized; no renewed user approval needed. Never change another task's server/env/worktree.
5. Report worktree, base SHA, current test baseline and any contract mismatch before edits. No secrets/PII in output or commits.

## Allowed ownership, interfaces, test steps and done criteria

## S3 — Existing wizard extended for both methods and custom features

**Files:** `app/valuations/[id]/page.tsx`, `steps/step-sample.tsx`, `use-sample-review.ts`, sample sections/panel as required, new focused `pairwise-selection.tsx`/`pairwise-assessment.tsx`, `step-features.tsx`, `step-calculation.tsx`, `cards.tsx`; tests RTL feature/sample/calculation and use-sample-review; existing Help step3/4/5 pages; do not edit manifest.ts (S4 owns new method page registration). No renderer/actions from S4.

**Interfaces:** consumes S1/S2 finalized action payloads and the method-selection control shipped with the S2 server gate; extend that control rather than create a second method selector. S2 updates the existing KCS E2E to confirm the method explicitly. Never redefine formulas. Existing cards render discriminated result from computeValuation; existing KCS presentation stays intact. `pairwise-selection` is a manual selection over ranked proposals; no new scoring engine.

- [ ] RED user-flow assertions: one custom field, missing name, duplicate name, immutable preset names; scale3→2 clears middle; invalid weights hide both preview amounts; PP matrix keyed by identities; insufficient sample blocks and changing method requests confirmation.

```ts
await user.click(screen.getByRole("button", { name: /Inna cecha/ }));
expect(screen.getByRole("textbox", { name: /Nazwa cechy/ })).toHaveValue("");
// Use actual accessible labels introduced by the existing component extension.
// Do not assert CSS classes or implementation-specific hook calls.
```

- [ ] Build controls from existing Table/Input/Button/SectionCard/FieldError/FootNav. Preserve Opisy navigation. PP comparison defaults missing unless a known structured preset threshold supports a visible suggestion; never silently confirm.
- [ ] Add a registry reload→save regression preserving coopTxId: step-sample initial mapping currently omits it while assignSampleProvenance uses it to distinguish registry from RCN. Verify and retain source identity rather than converting a saved registry row to RCN.
- [ ] Preserve KCS proposal/backfill and editable row behavior. For PP choose3–5 explicitly, maintain separate pool vs choice, preserve stored values and the existing import rounding; method changes must not change pricePerM2/content-key provenance. PP arithmetic does not add intermediate rounding. Reordering never maps data by index.
- [ ] Add numeric multiplier input with explanation for override, suggested value/basis visible; editing dependencies invalidates confirmation. Keyboard/accessibility and narrow table view checked in browser.
- [ ] Run RTL tests, existing sample-selection/overlay/use-sample-review tests, both goldens, typecheck, lint. Local browser walkthrough KCS/PP, both rights, incomplete data. Add Help reflecting actual UI and `pnpm --filter web help-index`.
- [ ] Commit `feat(wizard): support apartment features and pairwise comparisons`; PR to integration. Provide screenshots and manual scenario results; no claim of complete backend/document E2E before S4.

## Execution settings and browser evidence

User accepted `thinking=medium` for subsequent implementation sessions on2026-09-13; retain the model. Coordinator/reviewer/tester settings stay unchanged. Escalate only for a concrete difficult regression or architecture issue, with the reason reported to coordinator.

After a meaningful integration, test the changed flow and existing KCS at the highest available layer on your own local web/worker/DB. Report exact commit, URLs/ports, tested rights, observable assertions and screenshot/trace paths. Distinguish UI walkthrough, unit/integration tests, baseline and CI; never claim skipped scenarios or PP E2E before the needed layers exist. Do not rerun the whole suite after each tiny edit. The Codex in-app reader showed blank PDF on S1 while Chrome displayed the same generated PDF correctly; use Chrome for actual document visual checks. S1 evidence: `docs/superpowers/pairwise-valuation/S1-BROWSER.md`.

## Review and finish

Provide exact tests/results and known limits, changed contract signatures, Help status and artifact paths. Commit/push with hooks intact. Open PR ONLY to `integration/pairwise-valuation`; never merge into main, deploy, force-push or delete other worktrees. Do not merge your own PR until coordinator review gates finish. Keep worktree for fixes and report via `send_message_to_thread` to coordinator with `DONE: pairwise-s3-wizard`, PR URL, branch, worktree and test evidence. If blocked, state concrete cause and continue independent authorized work. Never assume missing user answers mean approval.
