"""Sanitized arithmetic reproduction; no source files or identifying data needed."""
import json
from pathlib import Path


def reproduce(totals, areas, weights, multipliers, subject_area, expected):
    prices = [total / area for total, area in zip(totals, areas)]
    spread = max(prices) - min(prices)
    corrections = [sum(spread * weight * row[col] for weight, row in zip(weights, multipliers)) for col in range(len(prices))]
    corrected = [price + correction for price, correction in zip(prices, corrections)]
    mean = sum(corrected) / len(corrected)
    raw = mean * subject_area
    rounded = int(raw / 100 + 0.5) * 100
    assert rounded == expected, (rounded, expected)
    return dict(prices=prices, spread=spread, corrections=corrections, corrected=corrected, mean=mean, raw=raw, rounded=rounded, status='PASS')


results = {
    'reference_a': reproduce([510000, 1068000, 694000], [51.2, 108.81, 71.3], [.4, .4, .1, .1], [[0, 1, 1], [-.5, .5, 0], [1, 0, 1], [1, 0, 1]], 74.63, 740900),
    'reference_b': reproduce([350000, 359000, 300000], [49.9, 50.7, 42.2], [.2, .2, .3, .2, .1], [[0, -1, -1], [-1, 0, 0], [0, 0, -1], [0, 1, 1], [1, 0, 0]], 48.1, 339400),
}
# Report precision only; all arithmetic and final-value assertions above use
# full float precision. Eight decimals keep a readable numeric report without
# long fractional digit runs resembling identifiers to the repository scanner.
def report_value(value):
    if isinstance(value, float):
        return round(value, 8)
    if isinstance(value, list):
        return [report_value(item) for item in value]
    if isinstance(value, dict):
        return {key: report_value(item) for key, item in value.items()}
    return value


Path(__file__).with_name('results.json').write_text(json.dumps(report_value(results), indent=2)+'\n')
print('PASS: reference_a=740900; reference_b=339400. Source PDF discrepancies documented in SOURCES.md.')
