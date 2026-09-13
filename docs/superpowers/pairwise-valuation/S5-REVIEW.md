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
