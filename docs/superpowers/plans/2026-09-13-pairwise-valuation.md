# Pairwise Valuation Implementation Plan

> **For agentic workers:** execute each task with a failing behavior test, implementation, verification and review. Use the delivery-workflow task cycle; user explicitly chose separate Codex tasks coordinated here, replacing manual session creation.

**Goal:** Deliver T-06–T-09 for apartments with both valuation methods and property rights, preserving existing UI and historical documents.

**Architecture:** Extend the current valuation snapshot, centralize method dispatch and readiness, preserve pure KCS arithmetic. Add a pure PP engine and method-specific document projections behind existing actions and adapters; use no new runtime infrastructure.

**Tech Stack:** Next16.2.9, React19.2.4, TypeScript, Zod4.4.3, Drizzle/Postgres, Docxtemplater, current Python worker, Vitest/Playwright.

**Spec:** [SPEC](../pairwise-valuation/SPEC.md); [architecture proposal](../pairwise-valuation/ARCHITECTURE.md).

## Global constraints

- Status: D-ARCH and D-AUTO APPROVED on2026-09-13; see pairwise-valuation/ACCEPTANCE.md. Execute in dependency order. No task may invent additional methodology.
- Base for every task/PR: `integration/pairwise-valuation`, never main. English `feature/<name>` branches and dedicated app worktrees.
- Preserve current styles/components, seven-step wizard, Opisy, actual PDF and document numbering.
- Both rights: `wlasnosc_lokalu` and `spoldzielcze_wlasnosciowe`. Homes/land excluded.
- No raw data/PII/secrets committed; no production database, staging deploy or client contact.
- CodeGraph first; read app CLAUDE/AGENTS and relevant local Next docs. Domain has no infrastructure imports.
- Source formulas, not erroneous PDF totals, determine numerical expected values.
- TDD on behavior; KCS regression in every task. Keep rejected/confirmed provenance, owner checks, row locks, CAS and immutability.
- Each task includes relevant Help updates before merge; code-only tasks explicitly state why Help is unchanged.

## Execution graph and ownership

`S1 contracts + engines → S2 persistence + policy → [S3 wizard UI || S4 document/prose/actions] → S5 full E2E + final review`.

S3 and S4 share only frozen contracts and do not edit each other's files. Every HANDOFF starts from the current integration after dependencies merge. If a shared contract needs revision, pause dependent code, report the change, merge it once and refine both handoffs. Estimates S1 6h, S2 6h, S3 8h, S4 8h, S5 6h are planning bounds, not billed time; split S4 if actual reviewable work exceeds8h.

## S1 — Shared feature/input contract and pure engines

**Files:** create `apps/web/src/domain/valuation-input.ts`, `feature-rules.ts`, `pairwise.ts`, `pairwise-state.ts`, `valuation-calculation.ts`; modify `domain/kcs.ts`, `feature-presets.ts`; tests `feature-rules.test.ts`, `pairwise.test.ts`, `valuation-calculation.test.ts`, `f6-feature-preset.test.ts`, existing KCS goldens.

**Interfaces:** produces SPEC signatures, existing KcsInput re-export, optional ratingScale/manual comparable id/method/pairwise fields. S1 owns comparableIdentity, valuationComparables, pairwiseBasis and all calculationIssues/thresholds. No actions/UI/template edits. `computeKcs` unchanged internally.

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

## S2 — Atomic writes, identities, readiness and invalidation

**Files:** `domain/valuation.ts`, `domain/provenance.ts`, `domain/wizard.ts`, `domain/pairwise-state.ts` only for integration with frozen S1 helpers, `ports/valuation.ts`, `adapters/valuation-drizzle.ts`, `lib/valuation-form-schema.ts`, `lib/assign-provenance.ts`, `app/actions/wizard-schemas.ts`, `app/actions/wizard.ts`, `app/actions/create-valuation.ts`, new `app/actions/select-method.ts`; tests wizard-domain/actions/repo, assign-provenance, f4-approval-gate, f7-immutability, valuation-form-schema, new pairwise-state.

**Interfaces:** consumes S1. `selectMethodAction(id,{method,confirm:true})` delegates to PortValuation.selectMethod/applyMethodSelection under a row lock. SampleUpdate retains all comparable rows and updates only PP selectedComparableIds; it does not choose method. FeaturesUpdate sends features, comparisons, an explicit confirmation request and expectedPairwiseBasis from the originally loaded snapshot. S1 pairwiseBasis includes method, area, selected ids IN DISPLAY ORDER, source ids/date/price/area, feature data and comparison cells (excluding confirmedBasis). Compare expected basis to locked current data, apply mutation, then stamp the resulting basis on deliberate confirmation. Gate checks equality of stored/current basis, not a boolean. newVersionOf clears basis, methodConfirmed and wr; retain method merely as a proposal. Keep same-method legacy KCS selection from invalidating wr/prose. Never accept provenance status from browser.

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
- [ ] Deliver the small method-choice UI with the server gate in S2: a focused `steps/method-selection.tsx` using existing controls, wired from `app/valuations/[id]/page.tsx` or step3 with persisted method/confirmation props. Explicit selection and confirmation must be reachable by a real user; never silently stamp KCS to keep old tests green. This is the existing approved method control moved earlier, not a redesign. S3 extends this control for the full PP workflow.
- [ ] Keep existing KCS browser flows working for both rights. Update existing smoke/spoldzielcze E2E to deliberately choose and confirm KCS, with a user-visible assertion; no DB shortcut, test skip or temporary bypass of the new gate. Preserve the other assertions. Scope includes the smallest Help step3 addition and help-index update describing this control. PP end-to-end is completed in S3–S5.
- [ ] Commit `feat(valuation): persist method and pairwise assessment safely`; PR to integration. Return concrete action payload examples and actual method-control props/labels to freeze before S3/S4. Full CI and existing KCS E2E must pass.

## S3 — Existing wizard extended for both methods and custom features

**Files:** `app/valuations/[id]/page.tsx`, `steps/step-sample.tsx`, `use-sample-review.ts`, sample sections/panel as required, new focused `pairwise-selection.tsx`/`pairwise-assessment.tsx`, `step-features.tsx`, `step-calculation.tsx`, `cards.tsx`; tests RTL feature/sample/calculation and use-sample-review; existing Help step3/4/5 pages; do not edit manifest.ts (S4 owns new method page registration). No renderer/actions from S4.

**Interfaces:** consumes S1/S2 finalized action payloads; never redefines formulas. Existing cards render discriminated result from computeValuation; existing KCS presentation stays intact. `pairwise-selection` is a manual selection over ranked proposals; no new scoring engine.

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

## S5 — Integrated E2E and final delivery

**Files:** `apps/web/e2e/pairwise-valuation.spec.ts`, fixtures/pages shared only where repeated, `playwright.config.ts`, `package.json` e2e script inclusion, `e2e/README.md`, final QA checklist and evidence in docs. Production fixes go back to owner tasks before merging, not silently into test commits.

**Interfaces:** complete integration after S3+S4. Own isolated web/worker/storage/Postgres from that branch, no main worker masquerading as PP verification. Use synthetic data only.

- [ ] Write durable E2E mapped to SPEC AC01–AC12, methods×rights. Full happy path includes Opisy (deterministic worker fake/fixture), actual PDF, approval and signature with synthetic signature image. Do not use real client signatures/valuations.
- [ ] Negative tests: minimum/max samples, method change, stale form/basis, missing ratings, scale2 hidden average, bad weights, duplicate name, changed method/prose, permission/immutable states at appropriate unit/action layer.
- [ ] Repeat new E2E3×, ensure included in CI and total run<5min where practical; record actual duration and deviations. Preserve existing smoke/spoldzielcze tests and explicit safe staging project.
- [ ] Run full `pnpm format:check`, `pnpm turbo lint typecheck test build --env-mode=loose`, `pnpm depcruise`, worker ruff/pytest, CI and independent review. Local browser inspect existing design and actual PDF. Review Opus/high per delivery-workflow, plus coordinator code/manual review; fix before merge.
- [ ] Commit tests/docs and merge to integration after gates. Fetch/merge latest main into integration (no force/rebase shared branch), resolve and rerun affected checks.
- [ ] Open ONE final PR integration→main with complete acceptance matrix and evidence. Stop before merge/staging for final concrete approval; do not deploy partial feature.

## Coordinator gates

For each task: implementer tests → Opus review → fixes → second review → coordinator code/manual/E2E as applicable → Help → merge squash into integration. Refine all unstarted HANDOFFs after merge. Missing tool name is not a reason to ask user to create sessions: use Codex task APIs and explicitly named app worktrees. If app is not separately registered as a saved project, use the existing Wyceny project context with an explicit app-worktree working-directory instruction; never edit the wiki checkout as application code.

No implementation session is launched on an unapproved or unfrozen contract. The architecture/methodology decision request follows completed audits and this concrete plan; once answered, coordinator continues without further per-commit approvals.
