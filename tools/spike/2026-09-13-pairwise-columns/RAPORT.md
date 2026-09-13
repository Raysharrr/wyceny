# PP 3/4/5-column technical spike — PASS

2026-09-13. Synthetic files only; all work under /tmp/pp-column-spike. No app/wiki edits. Used installed PizZip and Docxtemplater from app dependencies; no paid plugin or network calls. Local LibreOffice conversion successful.

Mechanism proved: prepare maximum-five comparison columns in three method-specific tables. Mark tables using OOXML `w:tblCaption` (here pp-dynamic-N, where N is fixed leading columns). Before Docxtemplater construction, strip excess prepared cells from each row, replace matching tblGrid, and replace each tcW with computed widths. Keep fixed total9600dxa and label column2400dxa. Existing Docxtemplater then resolves only surviving field tags. Table4 has no variable comparison columns; spike represents its result as text, not a claim of full four-table production layout.

XML assertions passed for counts3/4/5: every row and grid in ratings/corrections/prices has exactly fixed+count columns (5/6/4;6/7/5;7/8/6), no unselected comparable header, no unresolved braces/undefined. Synthetic averages9800/9900/10000 and values529200/534600/540000.

DOCX→PDF conversion passed for all3 files; each A4 one page. Rasterized and visually inspected all3 PDFs. No clipped/right-overflow columns or missing values. Five-column correction header wraps long English word 'Comparable' across lines; production should use source's short '1…5' headings and existing style widths rather than this deliberately minimal formatting. This proves transport/layout mechanism, not final Polish styling, long descriptions, merged cells, large feature lists or multipage operat.

Suggested production responsibility: small pure adapter helper `resizePairwiseTables(xml,count)` called by docx-render after reading the selected modern template ZIP and before `new Docxtemplater`. Scoped solely to exact caption-marked PP tables; leave every other table untouched. Guard count3–5 and shape mismatch loudly. Marked tables should have no nested tables/merged cells in the dynamic area. Use existing expression parser for row-model arrays as needed. Domain/document-model supplies data, not XML. No template-engine replacement, runtime DOCX builder, or service is necessary.

Production tests: assert untouched KCS XML/template path, counts3/4/5, matching grid/tc widths, repeat-header properties preserved, optional property-right captions, rendered numerical values. Add full real-template PDF render with9 features/custom long name and5 comparisons for final pagination proof. This spike's regex is intentionally narrow for simple table shape; production helper must validate explicit markers/shape and must not run a global table rewrite.

Artifacts:

- /tmp/pp-column-spike/spike.cjs (reproducible synthetic package + preprocessing + assertions)
- /tmp/pp-column-spike/results.json
- /tmp/pp-column-spike/pp-3.docx, pp-4.docx, pp-5.docx
- /tmp/pp-column-spike/pp-3.xml, pp-4.xml, pp-5.xml
- /tmp/pp-column-spike/pp-3.pdf, pp-4.pdf, pp-5.pdf
- /tmp/pp-column-spike/pp-3.png, pp-4.png, pp-5.png
