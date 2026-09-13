import { pairwiseOverrideReason } from "./pairwise-presentation";
import type { ValuationInput } from "./valuation-input";
import type { PairwiseResult } from "./pairwise";
import { valuationComparables } from "./pairwise-state";
import {
  formatNumber,
  formatPercent,
  formatPln,
  LEVEL_LABEL,
  transactionMonth,
} from "./document-format";

/** Pure PP projection. Monetary corrections come exclusively from the computed result. */
export function buildPairwiseDocument(inputs: ValuationInput, result: PairwiseResult) {
  const comparables = valuationComparables(inputs);
  const features = inputs.features.filter((f) => f.weight > 0);
  const columns = (values: string[]) =>
    Object.fromEntries(values.map((value, i) => [`c${i + 1}`, value]));
  const rows = [
    {
      label: "Data transakcji",
      subject: "—",
      ...columns(comparables.map((c) => transactionMonth(c.date))),
    },
    {
      label: "Cena transakcyjna [zł/m²]",
      subject: "—",
      ...columns(result.pairs.map((p) => formatPln(p.pricePerM2))),
    },
    {
      label: "Powierzchnia [m²]",
      subject: formatNumber(inputs.area, 2),
      ...columns(comparables.map((c) => (c.area == null ? "—" : formatNumber(c.area, 2)))),
    },
    ...features.map((f) => ({
      label: f.name,
      subject: LEVEL_LABEL[f.rating],
      ...columns(
        result.pairs.map(
          (p) => LEVEL_LABEL[inputs.pairwise!.comparisons[p.comparableId][f.key!].rating!],
        ),
      ),
    })),
  ];
  const corrections = features.map((f) => {
    const cells = result.pairs.map((p) => p.corrections.find((c) => c.featureKey === f.key)!);
    return {
      label: f.name,
      weight: formatPercent(f.weight),
      range: formatPln(cells[0].range),
      ...columns(cells.map((c) => formatPln(c.amount))),
    };
  });
  corrections.push({
    label: "SUMA",
    weight: formatPercent(features.reduce((sum, f) => sum + f.weight, 0)),
    range: formatPln(result.pairs[0].corrections.reduce((sum, c) => sum + c.range, 0)),
    ...columns(result.pairs.map((p) => formatPln(p.totalCorrection))),
  });
  const prices = [
    {
      label: "Cena transakcyjna [zł/m²]",
      ...columns(result.pairs.map((p) => formatPln(p.pricePerM2))),
    },
    {
      label: "Suma poprawek [zł/m²]",
      ...columns(result.pairs.map((p) => formatPln(p.totalCorrection))),
    },
    {
      label: "Cena skorygowana [zł/m²]",
      ...columns(result.pairs.map((p) => formatPln(p.correctedPrice))),
    },
  ];
  return {
    pp_count: result.pairs.length,
    pp_rows: rows,
    pp_corrections: corrections,
    pp_prices: prices,
    pp_spread: formatPln(result.priceSpread),
    pp_overrides: result.pairs.flatMap((p, i) =>
      features.flatMap((f) => {
        const cell = inputs.pairwise!.comparisons[p.comparableId][f.key!];
        const reason = pairwiseOverrideReason(f, cell);
        return reason
          ? [
              `Porównanie ${i + 1}, ${f.name}: mnożnik ${String(cell.multiplier).replace(".", ",")}. ${reason}`,
            ]
          : [];
      }),
    ),
  };
}
