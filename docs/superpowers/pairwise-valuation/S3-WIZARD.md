# S3 — apartment feature and pairwise wizard

Implementation branch `feature/pairwise-wizard`, base `74390d0`. Dedicated application worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-wizard`. S1/S2 domain/action contracts unchanged; S4 rendering/prose files untouched.

## Behavior delivered

- Existing method control remains the single explicit choice/confirmation. Step3 header describes both thresholds. PP retains a pool separately from3–5 manually selected comparisons, ordered by canonical identities. Saved ACL rows/ids replace client values. Registry `coopTxId`, saved prices and manual ids survive reload/save.
- PP proposal/radius refresh extends its pool and preserves edited/selected rows, including edits made while a request is in flight. Existing KCS proposal/backfill logic remains. Import prices still use the existing two-decimal `rcnRow` conversion.
- One custom feature, immutable catalog names, unique custom name, required allowed definitions, two/three-level scales and weights in percent. Switching to two levels removes middle subject/comparison ratings and the middle definition. Removing a feature also removes its working cells. Historical unambiguous catalog names can recover their key; unknown keys remain a visible validation error.
- PP assessment has identity-keyed ratings, visible ordinal multiplier suggestions, editable numeric multipliers and required exception reasons. Missing data is never inferred from the subject. The only area-rating suggestion requires unchanged known preset definitions and the selected-area median; accepting it is explicit. UI and `saveFeaturesAction` use the same selected subset for preset provenance.
- Form fields, dependencies and `expectedPairwiseBasis` freeze together at mount. A prop refresh cannot silently grant old dirty values a new basis. Working saves deliberately reload the persisted form before another confirmation.
- Both previews use validated features and the shared dispatcher. PP cards show range, every correction, sums, original/corrected prices and final value; KCS presentation remains. Opisy navigation remains in both methods. Tables scroll within their cards and the PP confirmation fits a390px viewport.
- Help steps3/4/5 updated and17-page index rebuilt. The quote-count test now includes the new confirmation label. No Help manifest changes.

## Verification and artifacts

Baseline9 files/159 PASS: feature/sample/calculation/method RTL, sample review/selection/manual and both KCS goldens (`/tmp/pairwise-s3-baseline.log`). Four initial UI assertions failed before implementation (`/tmp/pairwise-s3-red.log`). Additional regressions cover registry hydration, selected-subset provenance, matrix reorder, scale cleanup, explicit selection/full-pool persistence and in-flight price editing.

Full web suite157 files/1806 PASS/1 existing skip. Typecheck and production build PASS. Final checks are recorded in `/tmp/pairwise-s3-tests-pass.log`, `...-typecheck-pass.log`, `...-lint-pass.log`, `...-depcruise-pass.log`, `...-format-pass.log`, `...-build-complete.log`, `...-worker-tests.log` and `...-shared-tests.log`. Lint has zero errors and11 existing warnings. Worker320 PASS; shared4 PASS. Existing browser suite first run12 PASS/2 existing opt-in skips in27.8s; final run after responsive changes is `/tmp/pairwise-s3-e2e-final.log`. Local Playwright traces remain under `apps/web/test-results/`.

Isolated PostgreSQL16 container `wyceny-pairwise-wizard-test` port5546, web3018, worker8018. Synthetic users/data only; paid LLM disabled, geocoder stub, external UI fetches disabled. Vitest requires its normal feature-on flags in the **test process** for mocked prose/maps/address tests; the actual web stays offline. The initial full run accidentally inherited UI-off flags and failed mode-sensitive assertions; subsequent runs restored test-process defaults. One E2E invocation lacked exported seed credentials and stopped before tests; the corrected command sources the local synthetic environment. No paid request or production database access occurred.

Manual CUA in the isolated in-app browser:

- Ownership `2d63d247-cf74-4fd7-81e0-15bc783e3deb`: PP unselected pool saves but cannot advance; missing matrix blocks; select3, custom two-level feature, multiplier1.25 without a reason hides both previews; reason restores preview; working save/reload preserves cells; explicit confirmation → WR510900 → Opisy. Original prices9000.12/10000.34/11000.56 remain after PP→KCS. Add9 rows → KCS with the same custom feature → WR507200 → Opisy.
- Cooperative `e60a7811-dd7f-4785-a5d2-f4a3b1170bec`: PP3 manual rows7000/7200/7400,48m², all average → WR345600 → Opisy. PP→KCS +9 rows7200 → WR345600 → Opisy. Back to PP keeps the3 selections and working ratings; final confirmation succeeds.
- Final390×844 check: feature/assessment tables have internal horizontal scrolling; primary confirmation visible; Tab reaches third comparison multiplier. A small existing global header overflow remains outside this slice. Viewport reset afterwards. Final browser error log empty.

Screenshots/DOM: `/tmp/pairwise-s3-browser/ownership-pp-calculation.{png,txt}`, `ownership-kcs-calculation.png`, `coop-pp-calculation.txt`, `coop-kcs-calculation.png`, `coop-pp-mobile-final.png`, `coop-pp-calculation-final.png`, `coop-pp-table-final.png`. The initial ownership PP screenshot predates the full-width table layout; final cooperative screenshots show the corrected layout.

## Boundaries

No complete PP document/prose/approval/signature E2E is claimed before S4/S5. Manual flows verified navigation to the existing offline Opisy screen; existing browser tests cover KCS preview/approval and registry flow. Live RCN, paid prose, maps and signing are not claimed here. Preserve this worktree and isolated stack for coordinator review and fixes. PR targets integration only; no merge or deployment.
