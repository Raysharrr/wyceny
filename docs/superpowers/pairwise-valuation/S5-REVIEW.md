# S5 — review and coordinator evidence

Initial head `215db4c9f6272c84e76b8b57b0e01facaf1d6784`, PR45 to integration/pairwise-valuation. Required first Opus/high review: PASS with test-strengthening findings, `/tmp/pairwise-s5-review.txt`. Reviewer read code and the machine-readable repetition report; did not run tests/build/CI and does not claim to have done so.

Coordinator independently inspected spec/page object/config/CI/fitness and ran dispatcher fitness plus both historical KCS goldens:3files/8PASS, `/tmp/pairwise-s5-coordinator-tests.log`. Coordinator's full combined Chrome acceptance (all four method/right paths, manual prose, real PDF, signing, plus new-version and same-WR staleness) is recorded in INTEGRATION-ACCEPTANCE. Production source in S5 is unchanged.

## Requested strengthening after review1

- Wait for the specific keyless worker failure before first manual prose entry; an enabled field immediately after mounting is insufficient to establish that its effect completed. Preserve keyless environment requirement: observing an error cannot prevent a call against a wrongly configured paid worker.
- Assert actual validation feedback for bad weights/missing ratings instead of merely the already-current URL; check unconfirmed basis after a completed working save for Enter behavior.
- Assert the KCS two-level note in parsed PDF or qualify any remaining visual-only claims. Different signed/approved URLs and SHA should be explicit.
- Any wrong-right negative assertion must be scoped to the document's valuation title/section rather than unrelated standard legal prose.
- Coordinator will close the pending final integrated-run wording and record final CI/head after completion.

Implementer owns fixes on the same branch. Required second Opus/high review and final CI remain pending; no declaration of merge or staging here.

## Linux PDF finding from first CI

PR45 initial CI code job passed; browser job failed in the two KCS full paths on exact fractional-percent assertions. Downloaded real Linux PDFs show the numeric value split across lines (`40,2` / `5%`, `59,7` / `5%`) and the weight header split `Wag` / `a`. Coordinator independently viewed `/tmp/pairwise-s5-pdf/ci-kcs-11.png`. This is a real modern-KCS layout defect, not a reason to relax the PDF assertions. Local macOS rendering had fit the same values. Font evidence differs across platforms; both have Carlito, so missing Carlito is not established as the cause.

S4 owner resumed on its existing feature/pairwise-report branch, merging current integration normally and preparing a minimal modern-template correction with Linux LibreOffice reproduction. Legacy binary/projection remain frozen. S5 continues test-only reviewer fixes; integration is gated on the document fix and green CI. First failed CI remains historical evidence, never reported as PASS. Local DOCX reproducer `/tmp/pairwise-s5-pdf/ci-repro-kcs-ownership.docx` is synthetic and stays outside Git.

## Review2 — tester fixpack closed

Final tester head `e1b1670030ca6a97ab129208410d90836492f318`. Second required Opus/high review PASS, `/tmp/pairwise-s5-review2.txt`. Reviewer read the fixpack and exact final report but Bash was blocked; coordinator separately inspected the real `215db4c..e1b1670` Git diff. Test-only changes implement the requested failure wait, visible blockers, scoped cover assertion, KCS note/SUMA dash and different signed URLs/SHA. Local final3×:22PASS,0flaky/0skip,118.240s; `/tmp/pairwise-s5-fix-report.json`, `...-fix-repeat.log`, `...-fix-results/`. Lint/typecheck/format/F9 passed.

The persisted unconfirmed marker after working save is supplementary: working save clears the marker. The Enter regression is caught by the UI remaining usable for working save (implicit confirmation would disable/navigate it), together with the existing RTL proof. Likewise no usage indicator is supplementary; the specific worker failure is the meaningful first-visit signal. No third tester review round is required for these informational notes. The known Linux KCS defect remains a separate S4 dependency and still blocks integration.

## Final integrated acceptance and merge

S4 correction82dd24d was merged normally into S5 asbf80117. On the tester's separate full Linux worker, all seven scenarios passed3×:22 executions,64.723s,0flaky/0skip/0unexpected; `/tmp/pairwise-s5-linux-final-report.json`. Existing E2E12PASS/2opt-in skips in21.7s;95 focused tests passed. Corrected KCS pages for both rights were inspected, and coordinator additionally viewed the final KCS/PP cooperative pages. Strict percentage assertions were not weakened.

Final S5 head `f052fe70d211134ee71d5f8177341f951006330f` adds only documented evidence after the tested merge. [Final PR45 checks](https://github.com/Raysharrr/wyceny/pull/45/checks) all passed: code3m54s, browser4m00s; web1850PASS/1existing skip, shared4PASS, worker320PASS/1conversion skip in CI (321PASS locally with real LibreOffice). Browser CI: preserved12PASS/2opt-in skips, new8PASS including setup. Squash `8b87be86b2ff5b5efff299ffc635f20827f7f9aa` is in integration, GitHub state MERGED. Main/staging were not changed. The tester stopped only its own web/Mac/Linux workers; isolated DB, image and artifacts remain.
