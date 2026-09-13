# S4 — method-aware operat, prose and legacy signing

Implemented on `feature/pairwise-report`, base `74390d0`, in `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-report`. Scope: HANDOFF S4 / SPEC AC08–AC10, document/prose portions of AC07/AC12. No S3 wizard/page changes, engine changes, migration, production access or paid model calls.

## Contracts and compatibility

- `buildDocumentModel` accepts `result?: ValuationResult`; existing `kcs?: KcsResult` calls remain supported. A calculation result is required at runtime. Method-specific values come from the discriminated result, not a second calculation.
- `prepareOperatModel(input, {preview?, signing?})` returns `{model, templateVersion}`. All three render actions use `computeValuation` and this common preparation. Only signing an approved snapshot with absent `inputs.method` chooses `legacy-kcs`; modern preview/approval uses `valuation-v2`. Existing stored amount-in-words is reused at signing, with the previous worker fallback for rows without it.
- Renderer options add `templateVersion?: "legacy-kcs" | "valuation-v2"`. Media machinery remains common. Renderer selects a technical template version and does not choose a business algorithm.
- `legacy-kcs-document.ts` is the frozen 9b projection, including old percentage/scale formatting. `operat-szablon-legacy-kcs.docx` is byte-identical to the frozen template SHA `5e43f7b885cb8ba444ad211e0349ae36f1a3875d8e28635d1b27f4f6a293572a`. The existing frozen baseline JSON and `/tmp/pairwise-legacy-render` expected artifacts were not regenerated.
- Both-right tests compare signed DOCX text against the original 9b hashes, including fractional weights and manual prose. The action-level test additionally uses a retired feature key to demonstrate that legacy signing does not introduce new catalog validation.
- Public `ProseFactsInput` and `buildProseTransactions(Comparable[])` signatures are unchanged. The small `propose-prose.ts` caller adjustment sends the effective selected PP subset via `proseComparables`. No page.tsx caller change is needed.
- PP-only `metoda` and `poprawki_porownan` facts affect analysis/justification as applicable. Justification additionally fingerprints selected active feature/cell state, so the same rounded WR with changed corrections is stale. Unused pool rows/cells and zero-weight features are excluded. Accepted manual text is not deleted. General section dependencies remain unchanged.
- `legacy-prose-hashes.json` was captured from `git show 9b2903c` prose and prose-hash source using the frozen synthetic input; tests compare current hashes with it. Absent→explicit KCS selection also preserves hashes for unchanged valid data.
- Worker `fakty` already accepts a dictionary. No wire-schema migration; only the analysis and justification prompt examples/instructions change. Numeric WR/unit value are not sent in PP facts. The worker still does no PP arithmetic.

## Template and PDF evidence

`scripts/patch-template-pairwise.mts` derives the modern template from the SHA-pinned legacy binary and is idempotent (second invocation reports `Already patched`, preserving bytes). It retains untouched body XML, common property-right/media/prose paths, and actual section numbering 10–13. Each modern method renders its own explanation and calculations.

Three PP tables are explicitly caption-marked with their fixed leading-column count; table 4 is fixed. `resizePairwiseTables` changes only marked tables, rejects unexpected counts/shapes/merged cells/duplicate markers, synchronizes grids and cell widths, and preserves row/header properties. Tests assert unmarked tables are byte-identical. PP calculations are projected from `PairwiseResult`; formatting does not feed back into arithmetic. Two-level KCS middle cells and mixed middle total print a dash with a note; percentages preserve fractions and the actual sum.

Real conversion used the isolated worker on `127.0.0.1:8019` and LibreOffice **26.2.3.2**, not a conversion mock. Modern words came from the real `/amount-in-words` worker endpoint. The legacy fixture keeps its originally frozen synthetic words. Reproduction: `pnpm --filter web exec tsx scripts/pairwise-render-evidence.mts` with that worker running. Optional synthetic media fixtures are local `/tmp/pairwise-s4-render/map-synthetic.jpg` and `photo-synthetic.jpg`.

All final DOCX/PDF/text/PNG artifacts are under `/tmp/pairwise-s4-render/`. `results.json` records byte sizes; `pdf-text-evidence.json` records final PDF SHA256/page counts and rasterized page candidates. PDF text assertions verify all four PP captions, no unresolved PP placeholders/undefined, and **740 900** for reference PP3 on both rights. XML tests assert exactly four PP tables, 3/4/5 comparison columns, matching grids/cells/widths and repeated headers.

| File stem (add `.pdf` or `.docx`)       | Pages | Focused visual pages |
| --------------------------------------- | ----: | -------------------- |
| `pp-3-wlasnosc_lokalu`                  |    11 | 7, 9–10              |
| `pp-3-spoldzielcze_wlasnosciowe`        |    10 | 8–9                  |
| `pp-4-wlasnosc_lokalu`                  |    11 | 8–9                  |
| `pp-4-spoldzielcze_wlasnosciowe`        |    10 | 8–9                  |
| `pp-5-wlasnosc_lokalu`                  |    15 | 1, 5, 7, 12–14       |
| `pp-5-spoldzielcze_wlasnosciowe`        |    14 | 11–13                |
| `kcs-current-wlasnosc_lokalu`           |    12 | 10–11                |
| `kcs-current-spoldzielcze_wlasnosciowe` |    12 | 10                   |
| `kcs-legacy-wlasnosc_lokalu`            |    12 | 10–11                |
| `kcs-legacy-spoldzielcze_wlasnosciowe`  |    12 | 10–11                |

PP5 contains all nine catalog features plus one long Polish custom name, mixed scales, fractional weights, a −0.25 override, two synthetic maps, photos and a synthetic signature. Current KCS contains a custom feature, fractional weights and a two-level feature. The final page inspection used the PDF skill's offline rasterization and `view_image`: no clipped columns or overlapping text in inspected pages; long rows stay together and table headers repeat. Tables and override prose may continue across pages. Inherited KCS pagination may leave a header/first row near a page boundary; the preserved legacy layout was deliberately not changed. This is focused inspection, not a claim that every page or maximum-length 1000-character definition was reviewed.

**Chrome limitation:** opening the local PDF with CUA was explicitly denied by browser URL policy, including a prohibition on workarounds or alternate browser surfaces. No retry/rehosting was performed. Coordinator confirmed offline PDF-skill image inspection was a permitted safer alternative. Therefore these are real PDF + offline visual checks, **not Chrome PDF viewing**. Normal authenticated app-generated PDF acceptance remains a separate coordinator/S5 check.

## Verification

- Before production edits: 5 files / 44 PASS; `/tmp/pairwise-s4-baseline.log`. Frozen projection and template had no diff from 9b.
- RED behavior evidence: `/tmp/pairwise-s4-red.log` (legacy entry/new PP document output missing), `/tmp/pairwise-s4-prose-red.log` (PP facts/staleness). GREEN logs include `/tmp/pairwise-s4-doc-green.log`, `/tmp/pairwise-s4-prose-green.log`.
- Full web: **160 files / 1812 PASS / 1 existing skip**, `/tmp/pairwise-s4-full-final.log`. This full run preceded final table-helper/prompt/legacy-pin refinements; affected final checks below cover those changes.
- Final document/prose/action/media/fitness/KCS goldens: **13 files / 131 PASS**, `/tmp/pairwise-s4-acceptance.log`. Subsequent added legacy byte pin and retired-key check: **3 files / 36 PASS**, `/tmp/pairwise-s4-legacy-final.log`. Table/facts checks: **4 files / 39 PASS**, `/tmp/pairwise-s4-document-final.log`.
- Worker full final: **321 PASS**, `/tmp/pairwise-s4-worker-final.log`; includes real LibreOffice conversion. Ruff check and format check PASS; one existing Starlette/httpx deprecation warning.
- Final production build PASS, `/tmp/pairwise-s4-build-final.log`. Typecheck and dependency-cruiser PASS. Lint: 0 errors, 11 pre-existing warnings. Help index: 18 pages; PP methodology registered in the owned manifest and KCS methodology updated.
- Own isolated PostgreSQL16 container `wyceny-pairwise-report-test`, port **5547**; web **3019**, worker **8019**. Existing KCS Playwright smoke/cooperative suite: **12 PASS / 2 existing opt-in skips**, final **31.0s**, `/tmp/pairwise-s4-e2e-final.log`. Real worker, deterministic geocoder, maps/prose/external UI fetches disabled. Traces: `apps/web/test-results/**/trace.zip`. This covers existing KCS UI/PDF paths, not the unmerged S3 PP wizard.
- Initial full-run setup lacked local test secrets, causing unrelated fingerprint/proposal failures; corrected before the successful full run. No external model call was made. An old prose-freeze spy was updated to observe common preparation. Worker prompt parser checks caught incomplete PP example metadata; the complete example now passes the existing count/address assertions without weakening them.

## Remaining integration checks

Coordinator owns independent review and actual S1 approved-before-update → sign-after-update checks against its retained port5544 approvals. This task never mutated that DB. Full PP wizard UI→save/reload→descriptions→preview→approve→sign (AC11) requires S3 integration and is not claimed here. Live RCN/WMS, paid AI generation, production signing, arbitrary older template releases and every possible extreme text length are not covered. Compatibility is specifically the available 9b boundary. Worktree and isolated DB are retained for fixes; no merge, deployment or shared-history rewrite.

## First review fixes

The coordinator required two P2 corrections from `/tmp/pairwise-s4-review.txt` before merge. Five focused regression tests first failed (`/tmp/pairwise-s4-review-red.log`), then passed after these changes:

- `pairwiseOverrideReason` compares the accepted multiplier with the fresh `suggestPairwiseMultiplier` for the current subject/comparable ratings and scale. Document exception paragraphs and PP prose facts include a reason only for an actual current override. Saved text is retained. Tests cover returning the multiplier to the suggestion and changing the rating so the same multiplier becomes the suggestion. Reference document fixtures now attach reasons only to actual exceptions; zero multipliers with matching neutral ratings carry no exception reason.
- Restored the original common §10 regulatory introduction/list and the selected method's complete original definition. In the actual frozen template/tokenizer, the common list is blocks248–252, PP definition253, KCS254. Tests compare every nonempty common paragraph and the selected definition with the frozen source, for both methods. Other-method calculation blocks remain hidden. No new legal text or methodology decision was introduced.
- PP prose percentages now use the same `formatPercent` as the document. Legacy KCS hashes remain unchanged. Help describes when an exception reason appears.
- Explicit KCS approval→signing now has dedicated both-right tests proving modern fractional percentages and the two-level note survive, with identical approved/signed text. Legacy signing also has both-right tests for an 80% weight sum. The compact `legacy-abnormal-weights.json` expectations were captured with the original `git show 9b2903c` calculator, projection and renderer source against the frozen binary; existing baseline expectations were never regenerated. The old result is396200 and old formatting is preserved without applying modern validation.

Focused verification: 16 files /215PASS (`/tmp/pairwise-s4-review-acceptance.log`), typecheck/build/dependency rules pass. Actual LibreOffice conversion was repeated for all10 variants (`/tmp/pairwise-s4-review-render-final.log`); the same artifact names now contain the review-fixed output, including the restored §10 and only actual exception reasons. Final PDF hashes/page counts remain in `/tmp/pairwise-s4-render/pdf-text-evidence.json`. Offline reinspection focuses on the restored methodology and affected table/exception pagination; the previously documented Chrome policy limitation is unchanged. Fitness expansion into S3-owned UI files remains with S5 after integration.

Final review-fix checks after the template wording/pin refresh: 3 pure files /30PASS plus action file /9PASS (`/tmp/pairwise-s4-review-final-pure.log`, `...-final-actions.log`); build PASS, lint0errors/11existingwarnings, formatting PASS. Reinspected PP3 ownership §10 page7 and calculations/continuation pages9–10, PP3 cooperative §10 page6 and table page8, plus modern KCS §10 pages6–7. Original regulatory text and repeated headers remain legible; PP3 ownership now has11 pages. Legacy files remain12 pages. Current page/SHA metadata supersedes the earlier matrix where pagination changed.
