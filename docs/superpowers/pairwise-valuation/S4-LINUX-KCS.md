# S4 follow-up: fractional KCS weights in Linux PDF

Modern KCS PDFs split `40,25%` into `40,2` / `5%`, `59,75%` into
`59,7` / `5%`, and `Waga` into `Wag` / `a` in Linux LibreOffice.
This was reproduced from S5's synthetic approval DOCX, not just inferred from
text extraction. The same document renders those values intact after the fix.

## Change and scope

The deterministic template patch widens the KCS weight column from 716 to 1200
twips. The grid changes from `[2339, 716, 1489, 1347, 1358, 1712]` to
`[2339, 1200, 1300, 1200, 1210, 1712]`. Total width stays 8961 twips.
Every cell width, including the four-column merged heading (5422 twips), agrees
with the grid. Fonts, text, calculations and PP tables are unchanged.

Comparing all ZIP entries against the template at integration `0bbe27f` confirms
that only `word/document.xml` changed, and within it only width attributes of
this one table. The legacy document projection has no changes. The legacy binary
SHA-256 remains `5e43f7b885cb8ba444ad211e0349ae36f1a3875d8e28635d1b27f4f6a293572a`.
The new modern binary SHA-256 is
`6b3cff63ea6eb13d898f4d8e9372b271a6e3a428693beb30484ed5bd44406d76`.

## Real Linux evidence

Local isolated Docker image `pairwise-s4-linux-lo`:
`sha256:32215762dacb91adbc8cc004f8aba678a1a2806d0856d31a491c528d3c73eab9`.
Python 3.12 slim / Debian trixie, Linux arm64, LibreOffice 25.2.3.2, Writer,
Carlito, DejaVu and Liberation fonts plus Poppler. `fc-match 'Segoe UI'` resolves
to DejaVu Sans, matching the problematic fallback in CI. No application services,
DB, secrets, LLM calls or deployment were involved in this conversion.

Evidence root: `/tmp/pairwise-s4-linux-kcs/`.

- `red-pdf/ci-red.pdf`, page 11: original S5 DOCX visibly reproduces all three splits.
- `green-pdf/ci-green.pdf`, page 11: same DOCX with only the production width delta;
  all three tokens are intact, coefficients and mixed-scale dashes remain readable.
- Six fresh application-rendered DOCXs/PDFs: ownership and cooperative rights,
  each with 40.25/59.75, 99.99/0.01 and 100 percent. Zero-weight features are
  omitted by the existing model in the last case.
- `pdf-assertions.json`: all seven green PDFs contain complete percentage words
  and `Waga` in Poppler bounding-box output; the original fails those assertions.
- `png/*-table-*.png`: visually inspected tables for all seven green PDFs and red.
  Weight values, coefficient values and borders have no clipping or overlap.
  Existing document pagination is unchanged in scope; some synthetic fixtures
  continue the table onto the next page.
- `template-scope.json`: archive/text scope checks and frozen legacy hash.
- `convert.log`, `linux-version.txt`, `*.fonts.txt`: converter/font evidence.

Generate fresh inputs from the web package directory:

```sh
pnpm exec tsx scripts/pairwise-kcs-linux-evidence.mts /tmp/pairwise-kcs-inputs
```

Convert them with real Linux LibreOffice, then use `pdftotext -bbox` to check whole
percentage words and `pdftoppm` to inspect tables. The S5 real-PDF end-to-end
assertions remain strict and unchanged; S5 owns their independent integrated rerun.

## Checks

- 9 focused test files, 78 tests PASS: document contract, template integrity,
  PP tables, scale model, signature/map/photo/prose/transaction table rendering.
- Web typecheck PASS; focused ESLint PASS; formatting PASS.
- Running `patch-template-pairwise.mts` again reports `Already patched`.
- New geometry regression covers total width, weight-column space, every row and
  merged header. Existing legacy byte/text and PP tests remain unchanged.

This follow-up is prepared for coordinator review and integration. It does not
merge to main or deploy; integrated S5 acceptance remains a separate gate.
