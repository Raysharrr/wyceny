# PP document/prose pipeline audit (read-only, 2026-09-13)

Repository audited: /Users/michalczekala/Development/wyceny-app. CodeGraph used first. No application changes or test runs made. Findings are code inspection, not validated implementation.

## Existing responsibilities and exact touchpoints

- `apps/web/src/app/actions/preview-operat.ts:71-76` refuses non-draft preview. Lines164-190 computeKcs → amountInWords → buildDocumentModel(preview:true) → renderOperatDocx → worker.convertToPdf. Lines191-198 store preview and return content-hashed URL. Keep existing real PDF preview; do not replace with HTML.
- `apps/web/src/app/actions/approve-valuation.ts:98-114` authoritative fail-fast gate and document blockers; lines123-124 separately computeKcs + amountInWords. Existing map freeze/reuse starts146 and must remain unchanged.
- `apps/web/src/app/actions/sign-valuation.ts:48-55` signed/invalid-state guards. Lines64-78 recomputeKcs from frozen inputs using approvedAt. Lines79-124 reuse frozen maps/photos without fetching live data. Lines138-147 re-render, convert, store separate signed documents and SHA hashes.
- `apps/web/src/adapters/valuation-drizzle.ts:625-708` approval transaction: exact expectedInputs JSON comparison645-649, recomputed prose fingerprints672-679, draft-only CAS693. Sign711-738 approved-only CAS730 and SHA audit737. No read normalization that changes frozen snapshots should be added here.
- `apps/web/src/domain/document-model.ts:411-426` BuildDocumentInput requires KcsInput and KcsResult; 444 destructures these. Common factual/property-right/prose model should stay shared. Method-specific values currently569-583 and653-665. Fractional weights currently rounded to integer percent655. `ui_sr` is always weight657 and template SUMA middle is literal1.000.
- Same file489-499: active features weight>0; definitions loop all LEVEL_ORDER whose text nonempty. New scale2 must restrict legal levels even if stale middle text exists. No structural dependency on catalog names: custom name already flows654,665,667-671; identity/validation belongs upstream.
- `apps/web/src/domain/prose.ts:122-138` existing per-section fact dependencies; general descriptions should remain. `proseKcs`192-197 currently permits drafts with positive prices/area independent of confirmation; replace with method-aware safe calculation, don't throw across incomplete PP drafts. `ProseFacts`88-108 has no method. `ProseFactsInput`163 pins KcsInput.
- `apps/web/src/domain/prose-hash.ts:70-85`: hash is canonical selected facts plus sorted month/price transaction payload for market analysis and justification. Method/pair edits that do not alter these facts are currently invisible. Introduce PP-only method/correction calculation fingerprint for affected justification, not indiscriminately for all six sections. Keep legacy KCS hash byte shape stable if factual inputs haven't changed. Fact-dictionary changes must respect worker accepted schema and `prose-section-facts.test.ts` prompt contract.
- `apps/web/src/domain/prose-snapshot.ts:57-84`: absent factsHashes intentionally stale; attempts separate from accepted text. Preserve accepted appraiser text and proposals semantics; invalidate confirmation/freshness without deleting narrative ownership.
- `apps/web/src/adapters/docx-render.ts:23,74-107`: single production template path, Docxtemplater + expression parser, common image/photo/signature mechanisms. Do not create separate PDF infrastructure.
- `apps/web/src/domain/operat-sections.ts:14-37` canonical actual numbering10 methodology,11 market,12 calculation with12.1-12.3,13 justification. Generated from template. HTML8/9/10 is irrelevant. Existing property-right switches in headings must remain.

## Actual four PP tables verified from primary DOCX files

Read ZIP XML of both `raw/documents/2026-08-31-wetransfer-operaty-wzorcowe/lokale-porownywanie-parami/Operat szacunkowy, Kaźmierz.docx` and `Operat szacunkowy, Murowana Goślina.docx` without modifying them. Both have:

1. Charakterystyka wybranych nieruchomości lokalowych o funkcji mieszkalnej — columns Cecha / Lp. / Nier. wyceniana / Nier.nr1 / Nier.nr2 / Nier.nr3.
2. Porównanie nieruchomości wycenianej z nieruchomościami podobnymi — Cechy rynkowe / Waga / Zakres /1/2/3.
3. Obliczenie skorygowanej ceny transakcyjnej każdego lokalu mieszkalnego przyjętego do porównań przy użyciu określonych poprawek — label / Nier.nr1 / Nier.nr2 / Nier.nr3.
4. Określenie wartości rynkowej prawa własności nieruchomości lokalowej o funkcji mieszkalnej — label/value, starts unit value (Kazmierz9927.54; MG7055.30).

Requirement is 3–5 chosen transactions, so DOCX layout must support 4 and5 columns beyond reference3. Needs real render/PDF width/wrapping proof, not XML-only tests. Preserve masking of comparable identity: document-model.ts599-649 currently handles composite transaction+lokal IDs, coop register IDs, honest missing address and stripped house numbers. Don't build a second unsafe address mapper for PP.

## Template source chain / smallest credible change

`apps/web/tests/f12-template-integrity.test.ts:18-35` explicitly documents chain: wiki `tools/spike/2026-07-15-template-koscielna/build_template.py` generator, then three app scripts `patch-template-table1.mts`, `patch-template-table1-ulica.mts`, `patch-template-foto-2-kolumny.mts`; commit binary and SHA pin together. Generator source stages5b (lines244-322,1875-1878) own current KCS tables; middle SUMA literal at297; stages5c/5d own scales;9d property rights; later image insertion must survive. Generated `operat-sections.ts` must correspond.

Recommend a narrowly scoped, deterministic app-side idempotent template patch following existing scripts, or update generator through separately authorized wiki work; do not silently regenerate source and lose downstream patches. Keep common template body/property-right/prose/media; method-conditional methodology and calculation blocks (four PP tables) and pure method-specific document projection. One typed calculation dispatcher, with result discriminant, provides common wr/unitValue/sample statistics and engine-specific detail. Do not scatter computeKcs/computePP choices among actions.

For T08/09 add scale-aware definition projection, dash middle Ui and conditional middle SUMA for mixed scales, preserve fractional percent precision. Keep legacy no-scale KCS output byte/text behavior where practical.

## Critical immutability caveat

Already SIGNED rows aren't re-rendered by preview/sign guards, and stored URLs/SHA audit should stay untouched. APPROVED but unsigned rows ARE re-rendered against current template/code at sign64/138. There is no template version in this inspected path. `docx-render-signature.test.ts:37-55` proves same-model same-current-template equality only, not approval-before-deploy / signature-after-deploy. If common KCS template text changes, preserve old render path/version for approved legacy records or establish an artifact-based signing strategy with a targeted spike. Avoid claiming current test guarantees cross-version immutability. At minimum PP conditional addition must render legacy KCS text identically; new scale behavior only on explicit new fields. Do not retrofit optional fields into issued JSON.

## Test ownership / acceptance evidence to add during implementation

- Domain/result task: synthetic/reference PP numbers, rounding, calculation dispatcher and invalid/incomplete PP handling used by prose. Old KCS golden exact numbers.
- Document task: extend `document-model-skala.test.ts`, `f12-document-sections.test.ts`, `f12-template-integrity.test.ts`, `f12-document-masking.test.ts`, `docx-render-signature.test.ts`, `docx-render-prose.test.ts`, `docx-render-table1.test.ts`. Real production template assertions for exclusive methodology/formulas, exactly four PP tables, correct rows/columns for3/4/5 transactions, custom names and2/3 scales, fractional weights, both rights. Common sections/media must survive and no PII/unresolved placeholders leak. Approved/signed text parity with PP and prose. Run actual worker PDF conversion, visually inspect tables/page breaks.
- Lifecycle/action task: `preview-operat.test.ts`, `approve-valuation-action.test.ts`, `sign-valuation-action.test.ts`, `prose-freeze.test.ts`, `f7-immutability.test.ts`, `prose-staleness-flow.test.ts`, `prose-section-facts.test.ts`. Same numerical result/document at all entry points; PP incomplete blocks with useful errors; draft edits invalidate relevant justification even if rounded WR unchanged; unrelated Opisy remain fresh. Transaction drift during render rejected. Historical absent method/scale read and signed artifacts unchanged.
- End-to-end integration: existing seven-step UI→save/reload→Opisy→actual PDF preview→approval→document→signature for PP and KCS on both rights; compare result and frozen text. Do not use preview with main worker as evidence of integrated feature.

## Concrete bounded compatibility proposal

For this block the smallest viable discriminator is already-frozen `inputs.method`: legacy approved rows have it absent; newly issued rows must have it explicit after mandatory step3 method confirmation. Preserve the current binary and legacy document projection/formatting. At SIGN, absence selects both old KCS calculation/model projection and legacy binary. Signed rows never reach this path. Modern drafts with absent method can use modern editing/preview but must not issue without explicit method; don't normalize approved snapshots merely by reading them.

Current renderer API is `renderOperatDocx(model, opts?: { signature?: Buffer|null; maps?: RenderMaps|null; photos?: RenderPhotos|null }): Buffer` (docx-render.ts46-49). Minimal extension: `templateVersion?: 'legacy-kcs'|'valuation-v2'` option; renderer chooses file, callers supply version. It should not inspect business method. Keep all media/signature machinery identical. Preserve legacy numeric/scale formatting as well as binary; old inputs using missing keys must remain accepted. A preserved template alone is insufficient when builder changes visible percent/middle-scale output.

Cleaner durable alternative: explicit `renderVersion` frozen at approval; future text/template changes get a new version without overloading method presence. However approval currently only writes status/date/doc URLs/words (valuation-drizzle.ts681-692), so stamping inputs adds persistence/CAS considerations and needs tests. For this specific two-version cutover, absent-method invariant is a valid minimal compatibility boundary; document it, enforce that newly approved rows always have explicit method, and pin legacy golden output. An explicit renderVersion becomes worthwhile if more than this single migration is anticipated. Neither option automatically proves historical parity against arbitrary prior template releases; they preserve the exact pre-block baseline9b2903c, which is the concrete available source.
