# PP primary-material audit — 2026-09-13

Read-only source inspection. No production implementation or exhaustive legal/methodology validation. References below are local raw files; do not copy identifying document data to git.

## Reproduced numerical fixtures

Base A: raw/documents/2026-08-31-wetransfer-operaty-wzorcowe/lokale-porownywanie-parami/.

1. `wycena Kaźmierz.xlsx`, Arkusz1: G20:G22 = 510000/51.2, 1068000/108.81, 694000/71.3. B27 = max-minus-min of these selected three = 227.4171633941096. E39:E42 weights [.4,.4,.1,.1]. G39:I42 correction multipliers by feature: [[0,1,1],[-.5,.5,0],[1,0,1],[1,0,1]]. G44:I44 sums [0,136.45029803646577,136.45029803646577]. G48:I48 corrected [9960.9375,9951.724629439828,9869.970634642355]. G50 mean9927.544254694061, G52 area74.63, G54 total740892.6277278177; nearest100 =740900.
2. `WYCENA MG GRASZYŃSKIEGO.xlsx`, Worksheet: H49:H51 =350000/49.9,359000/50.7,300000/42.2. D56 range94.97668322426762 from these three. C72:C76 weights [.2,.2,.3,.2,.1]; E72:G76 multipliers [[0,-1,-1],[-1,0,0],[0,0,-1],[0,1,1],[1,0,0]]. E78:G78 sums [-9.497668322426762,0,-28.493004967280285]. E82:G82 corrected [7004.530387789798,7080.867850098619,7080.511734369212]. E84 mean7055.303324085876, E86 area48.1, E88 total339360.0898885306; nearest100 =339400.

Sanitized fixtures should use neutral fixture IDs (pp-reference-a/b), arbitrary feature IDs f1…f5, comparable IDs a/b/c; numerical prices, weights, areas and coefficients above suffice. Exclude addresses, dates, names, land-register IDs and screenshots. These reproduce workbook arithmetic, not erroneous document totals.

## Important PDF discrepancies

- Kaźmierz PDF p25 table4 prints mean9927.54, total740892.31 (rounded mean times area), final740900; workbook uses full precision until total. Both same rounded final.
- Murowana PDF p25 table4 prints mean7055.30, total339359.93 (rounded mean times area), **final399400 and words399400**. This is arithmetically inconsistent with both table and workbook. Do not encode399400 as a golden computed result; correct arithmetic is339400 when rounded to100.
- Older Uzarzewo PDF p26 table3 row1 prints4230.77 + (-273.87) =3992.90; arithmetic gives3956.90. Older spike claims of exact PDF parity cannot be assumed generally valid.

## Four document tables, exact structure

Kaźmierz PDF p24 tables1–3, p25 table4; Murowana PDF p24 tables1–2, p25 tables3–4:

1. “Charakterystyka wybranych nieruchomości lokalowych o funkcji mieszkalnej”: subject + comparable columns; transaction date, unit price, feature rating rows.
2. “Porównanie nieruchomości wycenianej z nieruchomościami podobnymi”: feature, weight, monetary range, correction per comparable, SUMA.
3. “Obliczenie skorygowanej ceny transakcyjnej każdego lokalu mieszkalnego przyjętego do porównań przy użyciu określonych poprawek”: comparable columns; original unit price, total correction, corrected unit price, mean.
4. “Określenie wartości rynkowej prawa własności nieruchomości lokalowej o funkcji mieszkalnej”: mean unit value, subject area, unrounded value, rounded value and words. Adapt existing right-specific template; these originals concern ownership.

## Fraction / extrapolation primary evidence

Older base B: raw/documents/wyceny-przyklady-2026-04-27/porownywanie-parami/.

- `wycena-uzarzewo.xlsx`, Arkusz1 E68/F68 =-D68/4 =-39.12466843501327; G68=-D68-(D68/4)=-195.62334217506634: demonstrated **negative quarter and negative1.25**, not proof of every symmetric option. `operat-uzarzewo.pdf` p26 table2 matches display-39.12 and-195.62 against range156.50.
- `wycena-milczanska.xlsx`, Worksheet J52=I52/2=1450.3590000000002; PDF p23 table2 standard range2900.72, correction1450.36.
- `operat-folwarczna.pdf` p25 table2 floor range603.15, comparables3/4 corrections301.57: halves are present, contrary to old spike summary claiming only0/±1 for Folwarczna.
- `wiki/topics/tech/spike-2026-05-14-pp-empiryczny.md` is secondary: its symmetric nine-value set is a design/generalization, not direct evidence all9 are used; its Uzarzewo plus1.25 label conflicts with the actual negative formula.

## Automation: proven versus proposed

Proven: price spread of selected comparables; per-feature weighted range; coefficient × range; sums and corrected prices; mean × subject area; sign positive when subject better. Rating text cells are separate literals; Kaźmierz G39:I42 and Murowana E72:G76 formulas do not reference descriptive rating cells. None proves universal label-to-coefficient mapping. Legacy multiple labels/scales and fractions further limit automatic generalization.

Simplest proposal for explicit product decision: after user confirms ordered two/three-level feature scale and subject/comparable ratings, _suggest_ normalized ordinal difference (subjectIndex-comparableIndex)/(levels-1); two levels0/±1, three levels0/±.5/±1. Show calculated suggestion and require appraiser confirmation; allow manual coefficient override with explanation, including fractions/extrapolation supported by examples. Keep full precision internally, format2 decimals, round final to100. This rule reproduces the two recent examples if their two/three-level definitions are correctly supplied, but is a proposal, not inferred approved methodology. Do not silently infer unknown comparable ratings from missing RCN attributes. Automatically calculate all downstream arithmetic. Do not claim source documents define ranking formula; rank only on verified available fields with visible reasons and human3–5 selection.

Explicit unresolved decision: approve this suggestion rule (with overrides/confirmation), or keep coefficients independently appraiser-entered. Recommend former to satisfy automation intent without pretending ratings mathematically determine expert corrections. Example: subject average vs comparable better on three-level scale suggests-.5; two-level worse vs better suggests-1. Fraction-.25/extension-1.25 must remain an explicit appraiser exception, not generated merely from labels. Bound/rounding policies and override rationale are product decisions to document; no universal hard limit justified by sources.
