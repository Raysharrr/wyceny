# S4 Linux KCS follow-up — coordinator review

PR46, head `28244eeafef1fa47755141653b09992673fe92e0`, to integration only. Required scoped Opus/high review PASS, `/tmp/pairwise-s4-linux-review.txt`. This closes the new real-PDF finding after the two original S4 reviews. The reviewer inspected code and Linux PNGs, but did not run tests or conversions.

Coordinator independently completed:

- Actual Git/source review of the deterministic width patch and geometry regression.
- Two changed-area files/24PASS: pairwise-document and template integrity; `/tmp/pairwise-s4-linux-coordinator-tests.log`.
- ZIP comparison against0bbe27f: only `word/document.xml` changes; removing width attributes makes old/new XML identical. Legacy binary SHA remains `5e43f7b885cb8ba444ad211e0349ae36f1a3875d8e28635d1b27f4f6a293572a`.
- Patch rerun prints `Already patched` and leaves worktree clean.
- Visual inspection of actual Linux red/green table output, including readable full percentages, coefficients, dashes and header.
- Fresh DOCX generation from28244ee and independent real Linux conversion of both rights in an isolated, network-disabled temporary container using the verified S4 image. Both PDFs contain whole40,25%/59,75% and the full weight header. `/tmp/pairwise-s4-root-linux-{input,pdf}/`, `...-convert.log`, `...-evidence.json`.

S4's broader six fixtures include both rights with99,99%/0,01% and100%, with whole-word extraction and visual evidence. Whole-PDF word assertions alone are not proof of a specific table cell; the inspected table PNGs complete that evidence. S5 separately reproduced the original failure on its own full Linux worker and will run the whole lifecycle after integration.

Nonblocking follow-ups: stronger lower bounds for coefficient-column widths against future edits; a preexisting header split at a page boundary in the synthetic100% fixture. No unrelated pagination redesign is part of this width correction. No additional review round is needed for these future-facing notes.

CI and integration status are finalized below when complete. Main/staging remain unchanged.

## Integrated

All required PR46 checks passed (code4m59s, browser3m2s); [checks](https://github.com/Raysharrr/wyceny/pull/46/checks). Squash `82dd24d01c4e1980a560537265916f774f6f5add` is in integration. GitHub reports MERGED, correct Raysharrr author/email and valid signature. S5 received the integrated correction for its independent full Linux retest. Main remains9b2903c.
