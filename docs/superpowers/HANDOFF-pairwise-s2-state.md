# HANDOFF pairwise-s2-state — Persistence and method policy

Status: D-ARCH/D-AUTO APPROVED2026-09-13. Await coordinator START only for dependency readiness; approval must not be requested again. Base: `origin/integration/pairwise-valuation`. Branch: `feature/pairwise-state`. Dependency: S1 merged.

Coordinator task: `01a09928-7929-7b71-ac87-01929eedf3b0`. Source repository `/Users/michalczekala/Development/wyceny-app`; coordinator worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-valuation`. Scope = this HANDOFF; report adjacent findings as follow-up, do not implement them.

## Start

1. Read this entire HANDOFF, `docs/superpowers/pairwise-valuation/SPEC.md`, `ARCHITECTURE.md`, `SOURCES.md`, and global constraints in `docs/superpowers/plans/2026-09-13-pairwise-valuation.md` from latest integration. Do not act on the historical plan's obsolete build-slice/worktree restrictions.
2. Read app CLAUDE.md and apps/web/AGENTS.md; CodeGraph before searching/reading source. Read relevant installed Next docs before framework edits.
3. Confirm START and dependencies, fetch origin, inspect `git log -5` and `git status --short`. Create a dedicated APP worktree from origin/integration, with the branch above. If Codex task starts in a Wyceny wiki project worktree, do not modify that checkout: all code commands use the explicitly created app worktree.
4. Install locked dependencies, build shared package. Use an isolated local test DB; never default to production or edit existing Zenon valuation. Coordinator owns `wyceny-pairwise-test` port5544; request separate DB/container for concurrent integration tests because migrations create cluster-wide app_role and collide in a shared cluster. Never change another task's server/env/worktree.
5. Report worktree, base SHA, current test baseline and any contract mismatch before edits. No secrets/PII in output or commits.

## Allowed ownership, interfaces, test steps and done criteria

## S2 — Atomic writes, identities, readiness and invalidation

**Files:** `domain/valuation.ts`, `domain/provenance.ts`, `domain/wizard.ts`, `domain/pairwise-state.ts` only for integration with frozen S1 helpers, `ports/valuation.ts`, `adapters/valuation-drizzle.ts`, `lib/valuation-form-schema.ts`, `lib/assign-provenance.ts`, `app/actions/wizard-schemas.ts`, `app/actions/wizard.ts`, `app/actions/create-valuation.ts`, new `app/actions/select-method.ts`; tests wizard-domain/actions/repo, assign-provenance, f4-approval-gate, f7-immutability, valuation-form-schema, new pairwise-state.

**Interfaces:** consumes S1. `selectMethodAction(id,{method,confirm:true})` delegates to PortValuation.selectMethod/applyMethodSelection under a row lock. SampleUpdate retains all comparable rows and updates only PP selectedComparableIds; it does not choose method. FeaturesUpdate sends features, comparisons, an explicit confirmation request and expectedPairwiseBasis from the originally loaded snapshot. S1 pairwiseBasis includes method, area, selected ids IN DISPLAY ORDER, source ids/date/price/area, feature data and comparison cells (excluding confirmedBasis). Compare expected basis to locked current data, apply mutation, then stamp the resulting basis on deliberate confirmation. Gate checks equality of stored/current basis, not a boolean. newVersionOf clears basis, methodConfirmed and wr; retain method merely as a proposal. Keep same-method legacy KCS selection from invalidating wr/prose. Never accept provenance status from browser.

**S1 review guidance:** derive comparable identities after server provenance normalization and stable fallback-id assignment. Filling missing registry ids or promoting a manual-looking row to its true registry source can change `comparableIdentity`; never silently transfer ratings by array index or price. Return persisted canonical identities to the UI. Test source promotion and an incomplete RCN row receiving its missing lokal id; either preserve the association through a proven one-to-one row mapping or explicitly require reselection/reassessment. `pairwiseBasis` preserves distinctions between absent/null/empty definitions and reasons: normalize before stamping the persisted snapshot, and ensure save→JSONB→read does not alter its basis. Test a confirmed snapshot round-trip. Scale-two payloads must omit the middle definition, not send an empty middle string.

- [ ] RED aggregate/adapter assertions:

```ts
expect(calculationIssues(kcsWith11)).toContainEqual(
  expect.objectContaining({ path: "comparables" }),
);
expect(() => applyCalculationConfirm(ppWithoutConfirmedCorrections)).toThrow();
expect(applyFeaturesUpdate(draft, editedFeatures).wr).toBeNull();
expect(() => applySampleUpdate(signed, editedSample)).toThrow();
```

- [ ] Add stale-form test: open features on basisA, save changed sampleB, attempt confirmation from basisA; reject and retain B. Add newVersionOf reset and legacy absent→kcs preservation tests. Add reorder/remove/add tests with two locals of one transaction and manual IDs; ratings never shift by index.
- [ ] Implement schemas/ACL/locked mutations and audit meta in existing paths, no SQL migration unless a concrete need emerges. New create permits incomplete step1 but cannot calculate/issue without method. Legacy read unchanged; undefined method defaults only in arithmetic/read.
- [ ] Run targeted tests listed above against isolated Postgres, plus both KCS goldens and provenance/hash tests. Inspect changed validations for old fixture/seed compatibility; adapt fixtures to explicit new commands only when testing new operations.
- [ ] Commit `feat(valuation): persist method and pairwise assessment safely`; PR to integration. Return concrete action payload examples to freeze before S3/S4. Help: unchanged until UI, invariant-only change on integration.

## Review and finish

Provide exact tests/results and known limits, changed contract signatures, Help status and artifact paths. Commit/push with hooks intact. Open PR ONLY to `integration/pairwise-valuation`; never merge into main, deploy, force-push or delete other worktrees. Do not merge your own PR until coordinator review gates finish. Keep worktree for fixes and report via `send_message_to_thread` to coordinator with `DONE: pairwise-s2-state`, PR URL, branch, worktree and test evidence. If blocked, state concrete cause and continue independent authorized work. Never assume missing user answers mean approval.
