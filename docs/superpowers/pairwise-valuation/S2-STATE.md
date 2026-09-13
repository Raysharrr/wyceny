# S2 — persistence, method policy and minimal method control

2026-09-13; branch `feature/pairwise-state`, base `91a718d`. Implements HANDOFF S2 / SPEC AC01–AC06 and the persistence part of AC10. Shared S1 signatures are unchanged. No migration. New drafts still originate in `wizard.ts/createDraft`; the removed `create-valuation.ts` is not recreated.

## Commands for S3/S4

```ts
await selectMethodAction(id, { method: "kcs", confirm: true });
// Alternatively method: "pp". Returns {ok:true} or {error:string}.
// PortValuation.selectMethod(id, user, MethodSelection) holds the row lock,
// enforces owner/draft and records method_selected {method,confirmed:true}.

await saveSampleAction(id, {
  comparables: loaded.comparables, // whole retained pool, including manual rows
  selectedComparableIds: chosenIds, // canonical comparableIdentity strings, display order
  // Existing sampleMeta/sampleSelection/streetView are still accepted.
});
// Success: {ok:true, comparables: Comparable[], selectedComparableIds: string[]}.
// Use the RETURNED persisted rows/identities for the next screen. UUID `id`
// survives schemas and reload; source/status are server-controlled.

const expectedPairwiseBasis = pairwiseBasis(originallyLoadedSnapshot);
await saveFeaturesAction(id, {
  features: editedFeatures.map((f) => ({
    key: f.key,
    name: f.name,
    weightPct: f.weight * 100, // action input is percent; domain stores fraction
    rating: f.rating,
    ratingScale: f.ratingScale,
    definitions: f.definitions,
  })),
  comparisons: editedComparisons,
  expectedPairwiseBasis,
  confirmPairwise: true,
});
// Success: {ok:true}; stale/error: {error:string}.
// confirmPairwise:false/omitted saves a working assessment, without a stamp.
```

`comparisons` has the frozen S1 shape: canonical comparable id → feature key → `{rating: "gorsza"|"przecietna"|"lepsza"|null, multiplier:number|null, overrideReason?:string}`. No browser `confirmedBasis`, provenance or status is accepted. Two-level definitions omit `przecietna` entirely, including an empty string. `expectedPairwiseBasis` is optional only for compatibility with ordinary KCS feature saves; every PP feature write and every comparisons/confirmation request requires it. Compare the original loaded basis under the lock, mutate, validate, then stamp the resulting snapshot. Do not recompute the expected basis from edited form values.

Identity normalization can change an old manual/fallback identity to a registry identity. S2 never maps cells by index/price: such old selection/cells are removed when saving without an explicit selection, or an explicit stale selection fails with “Wybierz ponownie transakcje po zmianie ich tożsamości.” Resave the pool without that stale selection, use returned canonical identities, and deliberately select/assess again. Stable row ids also prevent a registry row from becoming manual when a price edit strips source identifiers.

Method selection preserves WR and existing prose fingerprints for the same effective KCS method, including legacy absent→kcs. A real method change clears WR and pairwise confirmation. Sample/feature writes clear WR and the pairwise stamp; retained identities retain working cells. Subject area changes clear the stamp. New versions retain the method as an unconfirmed proposal and clear WR/stamp. Calculation and approval use S1 readiness; historical approved/signed reads are not rewritten.

## Method control

`steps/method-selection.tsx` exports `MethodSelection` and `MethodSelectionProps`:

```ts
type MethodSelectionProps = {
  valuationId: string;
  method?: ValuationMethod;
  methodConfirmed?: boolean;
  comparableCount: number;
};
```

Rendered above StepSample by `page.tsx`, only on the owner's draft step3. Accessible label: **Wybierz metodę wyceny**. Options: **Korygowanie ceny średniej (KCS)** and **Porównywanie parami (PP)**. Button: **Potwierdź metodę**. Status: **Metoda wymaga potwierdzenia.**, then **Potwierdzona metoda: KCS.** / **Potwierdzona metoda: PP.** No automatic selection/confirmation. The calculation blocker list provides links to the owning wizard steps.

Help: `krok-3-proba.mdx` documents this control, thresholds, method changes and version reset; `help-index` rebuilt (17 pages). The existing generated index is not tracked. S3 owns the remaining sample header/count copy and full PP/feature UI, including the previously identified missing `coopTxId` hydration mapping. S4 owns method-specific document/prose dispatch and legacy rendering. This PR does not claim PP document/E2E completion.

## Local evidence

Own PostgreSQL16 container `wyceny-pairwise-state-test` on5545; web3017 / worker8017. No other stack touched. Synthetic credentials/data; offline flags, geocoder stub, no paid LLM credentials. Baseline9 files/215 PASS (`/tmp/pairwise-s2-baseline.log`). Full web156 files/1781 PASS +1 existing skip (`/tmp/pairwise-s2-tests-final.log`); later focused contract checks cover final error-message polish and added regressions. Typecheck/build, lint (0 errors; existing warnings), dependency rule and format check pass. Full authoritative CI is linked from the PR.

Existing smoke/spoldzielcze E2E:12 PASS /2 existing opt-in skips,40.2s (`/tmp/pairwise-s2-e2e-final.log`), with explicit KCS choice/status assertions. The negative3-row smoke now proves the earlier calculation gate and inability to reach issuance, retaining its link-back assertion. All12-row approval/PDF assertions remain. Traces: `apps/web/test-results/**/trace.zip` (local, ignored).

Manual Chrome, spółdzielcze: new draft → explicit KCS →12 manual rows → reload with unchanged prices and confirmation → features → WR363200 → KCS→PP blocks calculation and later steps → explicit KCS again → WR363200 → descriptions with offline flag → real preview → approved document. Valuation `32b0b509-1f51-4b4d-97b5-4f93ce0b144e`. Ownership full E2E creates and approves `6a3d3822-2383-4c29-a434-3794384891ce`, WR681500; its issued PDF also inspected in Chrome.

Artifacts in `/tmp/pairwise-s2-browser/`: method unconfirmed/confirmed screenshots, PP blocker screenshot, both issued DOMs, preview/issued Chrome screenshots, both `*-issued.pdf` and text extracts, `pdf-evidence.json` (byte counts/SHA256), rendered table/value pages. Both PDFs13 pages; right-specific title and correct WR verified, no unresolved template markers. Visual checks cover title pages and KCS tables/value pages (coop11, ownership11–12), not every document page. The existing ownership table4 crosses a page break. Artifacts stay outside git because the existing template contains office branding/stamp.

First local E2E setup accidentally retained the coordinator's prose-on flag; the keyless worker rejected the request before an external model call. The run was stopped, this task's flag changed to off, the app rebuilt, then the complete successful E2E above ran. PP end-to-end, live RCN, optional register approval, maps, photos and signing are not claimed as manual checks here; relevant existing automated tests remain intact.

## First review fix batch

The first review and coordinator reproduction identified three issues on `eba365e` despite green CI (web1784 PASS/1 skip, worker319 PASS/1 skip, E2E12 PASS/2 opt-in skips). The review label itself is not treated as acceptance of those defects.

- Removed the permissive missing-area/features branch in `approvalGate`. Every new approval now uses `calculationIssues`; missing fields become invalid calculation inputs, and an unknown method cannot bypass readiness by omitting a field. Provenance fixtures now contain real prices, area and valid feature data. `GateInput.comparables` is the full `Comparable[]` contract. Legacy approved signing still uses its existing separate path.
- Incoming `coopTxId` takes precedence over an older RCN source recorded against the row id. Stable-id protection against source-id stripping/manual demotion remains for both RCN and SM. Changed canonical identities require reassessment.
- PP provenance paths use the actual saved-pool index, independent of selection display order; the label says e.g. “Transakcja 3 w zapisanej puli”. KCS labels are unchanged. Missing area blockers link to step1.

New regressions first reproduced five failures (`/tmp/pairwise-s2-review-red.log`). The fix batch also tests explicit stale selected ids without mutation and persisted stamp/WR invalidation after a subject-area edit. Targeted verification includes F4, wizard domain/repo, pairwise state, F7, signing actions and both KCS goldens. Final results are reported in the PR/coordinator message, with logs `/tmp/pairwise-s2-review-green-final.log`, `...-types.log`, `...-lint.log`, `...-depcruise.log` and `...-build.log` under the same `/tmp/pairwise-s2-review` prefix.

S3 retains the documented coopTxId/ratingScale hydration work and PP preset-definition median semantics; coordinator will explicitly assign action ownership for the latter. No production database access or new approval workflow was added for this review.
