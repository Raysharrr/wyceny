# S5 — integrated acceptance and durable E2E

Assigned worktree `/Users/michalczekala/Development/wyceny-app-worktrees/pairwise-e2e`, branch `feature/pairwise-e2e`, initial base `3261551`; fast-forwarded the coordinator’s documentation-only `7197755` before publication. Integrated S3 `ad9f0c6` and S4 `c075dbb`. S5-owned commits change tests/configuration/docs only. The independently reviewed S4 modern KCS layout fix was later imported from integration; no S5 production fix or contract/default/hosted-guard change was made.

## Harness and evidence boundaries

The existing smoke/cooperative suites retain their prose-OFF build. A separate `pairwise` project and `e2e:pairwise` command run seven new scenarios with active editors. CI runs a second prose-ON build after the historical suites. The keyless real worker honestly rejects generation; six manual synthetic sections are accepted by the actual action. No fake worker response, request interception, paid generation, live import or maps.

Own web3021, worker8022 with LibreOffice26.2.3.2, separate PostgreSQL16 cluster `wyceny-pairwise-e2e-test` on5548. Port8021 initially appeared free to lsof, but bind/netstat proved a macOS launchd listener; it was left untouched. Synthetic seeded Zenon owns the E2E valuations. All four sign with the fixture wave PNG, never a person's signature. Every test creates its own random-suffixed valuation. Local-only URL and explicit mode guards reject accidental hosted targets before test mutations.

Read-only SQL assertions query the test's own valuation and original approved PDF key. The authenticated download route deliberately stops serving the old approved key once the current document becomes signed; therefore original-byte preservation is checked against storage, while signed-byte immutability is checked by authenticated repeated downloads. Browser actions still perform every state mutation.

The dispatcher fitness check now scans both `.ts` and `.tsx` under `src/app/valuations`, actions and domain. It rejects direct computeKcs calls outside the existing dispatcher/explicit legacy modules. No new business validation duplicated in E2E.

## Observed acceptance

Four full paths passed with custom two-level feature plus three-level catalog feature, fractional weights40.25/59.75, save/reload, active manual prose, actual DOCX→PDF preview/approval, synthetic signing and immutable signed result. PP3 ownership gives455000, PP5 cooperative460000; the PP4 preview gives457500. These are independent synthetic browser fixtures, not replacements for the workbook goldens.

Negative UI covers explicit method confirmation, KCS11/12, PP2/3/5 and disabled sixth choice, retained pool/prices, rated identity reorder, duplicate custom name, wrong weights, clearing middle subject/comparable ratings on3→2, missing ratings, justified−1.25 override, Enter in ordinary fields, explicit keyboard confirmation, rejected stale second form and working-save reload. A−1.25→−1.25001 correction leaves rounded452500 unchanged but makes justification stale; all six manual texts remain and general sections remain current. Reconfirmation clears staleness.

Help opens from the actual step3/4 links and contains current selection/scale/keyboard rules. Existing source-identity, server-boundary, arithmetic, legacy and worker contract tests remain the evidence for cases best tested below UI; see the acceptance matrix.

## Verification record

- Initial baseline:3 files/8PASS, both KCS references and original dispatcher fitness; `/tmp/pairwise-s5-baseline.log`.
- Expanded integration checks:6 files/48PASS (PP wizard, prose, repository, both KCS references, expanded fitness), `/tmp/pairwise-s5-contracts.log`; typecheckPASS, `/tmp/pairwise-s5-typecheck.log`.
- During harness authoring, corrected selectors for button-based feature ratings, hidden custom-add control, multiple alert regions, physical DB names and numeric-only PDF headers. These were test assumptions, not production failures.
- Initial complete repetition:21 scenarios plus1 setup =22PASS,2.1min for all three repeats, `/tmp/pairwise-s5-repeat.log`; traces/PDF/DOCX/screenshots in `/tmp/pairwise-s5-repeat-results/`. A final repetition after stronger exact KCS amount and five-unaffected-section assertions is recorded below.
- A later repetition exposed one harness race (21PASS/1FAIL): after same-step “Zapisz pulę”, the existing step3 URL was already true and a one-shot DB read could precede commit. The test now waits for the visible “Pula zapisana” response before reading. Working-feature saves already wait for document navigation. Production was unchanged; the final3× result below supersedes that attempt.
- Final corrected suite3×:22PASS (21 scenarios plus1 login), **131.4s total**,0 skipped/0 flaky/0 unexpected; `/tmp/pairwise-s5-repeat-final.log` and machine-readable `/tmp/pairwise-s5-final-report.json`. All final trace/PDF/DOCX/screenshots are under `/tmp/pairwise-s5-final-results/`. Timing excludes build/install; the entire triplicate browser run is below5min. The successful sample trace confirms save click→visible completion response before the database assertion.
- Full local turbo:162 web files/1849PASS/1 existing skip, shared4PASS, all8 tasks successful in1m50.577s (web tests107.67s). Lint0 errors/11 existing warnings; typecheck/buildPASS. Dependency rulesPASS (280 modules/1047 dependencies), formatPASS and tracked-file F9PASS. Logs `/tmp/pairwise-s5-turbo-final.log`, `...-depcruise-final.log`, `...-format-final.log`, `...-f9-final.log`.
- Preserved smoke/cooperative E2E:12PASS/2 existing opt-in skips in28.9s; `/tmp/pairwise-s5-existing.log`, artifacts `/tmp/pairwise-s5-existing-results/`. Both built offline; the same real worker converted documents.
- Worker:321PASS in9.31s, one existing Starlette/httpx deprecation warning; ruff check/formatPASS (35 files), `/tmp/pairwise-s5-worker-test.log`, `/tmp/pairwise-s5-worker-lint.log`.
- Local format check initially saw Playwright's ignored synthetic login-state JSON. Removed only that generated session file; setup recreates it, and source formatPASS. The unit-test process explicitly enables normal mocked feature paths so dotenv cannot reload the browser's OFF flags; the separate real browser build stays offline.

## Visual inspection

Offline Poppler rasterization and `view_image`: `/tmp/pairwise-s5-pdf/`, with original PDFs, page PNGs and `inspection.json`. PP3 ownership page9; PP5 cooperative page9; PP4 ownership preview page9; KCS ownership pages10–11 and cooperative page10. The four PP tables and comparison columns are readable; expected values455000/457500/460000, Polish custom name, fractional percentages and KCS middle dashes/scale note are visible without clipped columns or overlapping table text. Signed cooperative title page1 shows the synthetic wave and right-specific title. KCS mixed fixture gives494200 for both rights. This is focused inspection, not every page or maximum-length definition.

IAB on3021 confirmed signed PP455000, tables and new-version-only action; `/tmp/pairwise-s5-browser/signed-pp.txt` and `.png`. Its normal authenticated PDF route displayed a blank reader, so no claim of PDF viewing in IAB/Chrome. Coordinator retained Chrome session isolation; no prohibited file URL was retried.

## Limits and ownership

Actual across-version AC10 belongs to the coordinator's already signed S1 approvals and `/tmp/pairwise-s4-coordinator-browser/legacy-sign-evidence.json`; S5 did not touch those rows. The existing deterministic legacy tests remain in final CI. No claim of every historical template version, maximal text lengths, live external sources, paid AI, maps/photos in the new full-flow fixtures, or deployment.

Coordinator owns Opus/high reviews, integration merge, the single final integration→main PR and final approval. This worktree remains available for fixes. No merge, main/staging change, force-push or global Git change was performed.

## First review fixes and Linux CI finding

First coordinator Opus/high review: PASS (`/tmp/pairwise-s5-review.txt`), code reading only. Tester-owned improvements now wait for the exact keyless-generation failure on first Opisy entry and assert no usage; revisits with saved text do not wait for a new failure. This checks the configured keyless path and does not prevent a keyed worker from spending tokens: the README still requires an unkeyed worker.

Wrong weights and missing comparison ratings now assert visible validation errors; changing3→2 explicitly leaves both subject endpoints unselected. Enter is covered by remaining on the editable page with the working-save control available (plus the existing RTL regression); persisted unconfirmed state after the completed working save is supporting evidence, because that save itself clears confirmation. Working-save waits only accept the main frame and verify reloaded values. KCS PDF checks include the scale note and mixed middle SUMA dash. Signed URL/SHA must differ from approval, and the title page excludes the other right's title phrase without rejecting valid common legal text.

Targeted fix check:4PASS in28.4s; targeted ESLint/typecheckPASS. All seven scenarios repeated3× on the fix:22PASS in118.2s,0 skipped/0 flaky/0 unexpected. Logs `/tmp/pairwise-s5-fix-target.log`, `...-fix-repeat.log`, `...-fix-lint.log`, `...-fix-typecheck.log`; JSON `/tmp/pairwise-s5-fix-report.json`; traces/artifacts `/tmp/pairwise-s5-fix-results/`. No production change. Coordinator owns the integration-document placeholder and the second review.

**CI blocker on215db4c:** main CI and historical E2E passed; new E2E found both Linux KCS PDFs split40,25% into40,2 /5% and59,75% into59,7 /5%. This is visible in the real artifact, not merely extraction whitespace. macOS inspection had intact numbers. Linux PDF embeds DejaVuSans/Bold along with LiberationSans and Carlito; local output uses LiberationSans/Arial/Carlito. The strict percentage assertions remain; the coordinator assigned the modern-layout repair to S4. This report does not claim deployed production was reproduced.

Evidence: `/tmp/pairwise-s5-ci-first-artifacts/`, failure log `/tmp/pairwise-s5-ci-first-failure.log`, raster `/tmp/pairwise-s5-pdf/ci-kcs-11.png`, and isolated reproduction DOCX `/tmp/pairwise-s5-pdf/ci-repro-kcs-ownership.docx`. AC08/GitHub acceptance was blocked at this point; the owner fix and independent Linux retest below supersede this finding. The other nonblocking review suggestions were implemented; only coordinator-owned documentation and this newly discovered production-rendering dependency remain outside S5 edits.

## Independent Linux preparation

Second coordinator Opus/high review PASS on `e1b1670`, `/tmp/pairwise-s5-review2.txt`; code-reading review, no reviewer-run commands claimed. No third S5 review requested.

Built the unchanged worker Dockerfile as `wyceny-pairwise-e2e-worker`, image `sha256:ce32a0e50e983414edb88534665df6a1af2a72f89e8f58309a007bba58328e2b`. Own container `wyceny-pairwise-e2e-linux`, verified-bound port8023; Debian trixie/linux arm64, LibreOffice25.2.3.2. Only the local shared secret, GEOCODER_STUB1 and STREET_INDEXoff were passed; no LLM credential environment keys. Nonsecret metadata: `/tmp/pairwise-s5-linux-environment.json`. Web3021 deliberately points to8023; the separate DB5548 is unchanged, other stacks untouched.

Docker Desktop's credential helper initially delayed public image metadata. Only this task's build was stopped; a task-local empty-auth Docker config and the same explicit local socket allowed public image downloads, without global Docker changes. S4's build/container remained separate.

Before the owner fix, this actual Linux worker independently reproduced the strict KCS40,25 failure through full UI and real preview: setupPASS/caseFAIL in10.9s, `/tmp/pairwise-s5-linux-baseline.log`, `/tmp/pairwise-s5-linux-baseline-results/`. Thus macOS-only passing results were insufficient. Final post-integration Linux results are recorded below.

## Final integrated Linux acceptance

Normal signed merge `bf801174978e5804d5e4291c2b9ac0fa55b123c0` imports the reviewed S4 width-only fix `82dd24d` (PR46). The test assertions were not relaxed. New production width attributes came only from the owner PR. The source/test tree at this merge is the tested state; later S5 edits only record these results and clarify Enter evidence.

- Affected document/template/fitness/KCS reference checks:12 files/95PASS in5.92s, `/tmp/pairwise-s5-linux-focused.log`.
- Fresh offline build plus preserved smoke/cooperative suite against Linux8023:12PASS/2 existing opt-in skips in21.7s, `/tmp/pairwise-s5-linux-existing.log`; traces/output `/tmp/pairwise-s5-linux-existing-results/`.
- Fresh active-Opisy build plus all seven new scenarios3×:22PASS in64.7s,0 skipped/0 flaky/0 unexpected. `/tmp/pairwise-s5-linux-final.log`, machine report `/tmp/pairwise-s5-linux-final-report.json`, traces/PDF/DOCX/screenshots `/tmp/pairwise-s5-linux-final-results/`. `/tmp/pairwise-s5-linux-lifecycle-index.json` binds the tested merge SHA to all12 signed lifecycle records.
- Both builds passed (`/tmp/pairwise-s5-linux-build-off.log`, `...-linux-build-on.log`). The same independent keyless Linux container and own DB5548 served the whole run. The64.7s browser repetition excludes build/install and stays below the5min target.
- Final Linux PDF inspection: `/tmp/pairwise-s5-linux-pdf/` (original PDF/DOCX, table PNGs and inspection metadata). Both KCS rights have13 pages; page11 now shows whole Waga/40,25%/59,75%, coefficients, mixed SUMA dash and the scale note. PP ownership has11 pages (inspected table continuation page10); cooperative has11 pages (inspected table page9). Table columns/values are readable in the inspected regions. Existing pagination/branding and uninspected extreme text cases remain outside this focused claim.

The previously observed Linux fractional-weight defect is closed by the owner fix plus S5's strict, independently passing full flows. Final GitHub CI is attached to PR45 on the published head. Both required S5 reviews passed; the coordinator retains final integration/merge/main/staging approval responsibility.
