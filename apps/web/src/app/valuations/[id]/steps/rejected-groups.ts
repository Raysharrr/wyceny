import { candidateKey, type RejectReason } from "@/domain/sample-selection";
import { MANUAL_REJECTION_LABELS, MANUAL_REJECTION_REASONS } from "@/domain/sample-manual";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  share_not_whole: "udział inny niż 1/1",
  not_free_market: "nie wolny rynek",
  not_residential: "lokal niemieszkalny",
  no_price: "brak ceny lub powierzchni",
  out_of_window: "poza oknem 24 mies.",
  out_of_area_band: "poza pasmem metrażu",
  primary_market: "rynek pierwotny",
};
export type RejectedGroup = {
  key: string;
  label: string;
  rows: {
    key: string;
    date: string;
    area: number;
    pricePerM2: number;
    distanceM: number;
    note?: string;
    manual: boolean;
  }[];
};

/** "Odrzucone" section data: domain rejections (by reason, largest first) followed by the appraiser's own (by reason). */
export function groupRejected(snap: SampleSelectionSnapshot): RejectedGroup[] {
  const auto = new Map<RejectReason, RejectedGroup["rows"]>();
  for (const r of snap.rejected ?? []) {
    const rows = auto.get(r.reason) ?? [];
    rows.push({
      key: `${r.transactionId}|${r.lokalId}`,
      date: r.date,
      area: r.area,
      pricePerM2: r.pricePerM2,
      distanceM: r.distanceM,
      manual: false,
    });
    auto.set(r.reason, rows);
  }
  // Sort by the CENSUS (`rejectedCounts`), not by the sampled row count —
  // `rejected` caps at REJECTED_PER_REASON (50) per reason, so two reasons
  // both at the cap (50 rows each) can still have wildly different true
  // totals (final wave, T7 #6); a group with no census entry (pre-Slice-3
  // snapshot) falls back to its own row count.
  const census = (reason: RejectReason, rows: RejectedGroup["rows"]): number =>
    snap.rejectedCounts?.[reason] ?? rows.length;
  const groups: RejectedGroup[] = [...auto.entries()]
    .sort(([reasonA, rowsA], [reasonB, rowsB]) => census(reasonB, rowsB) - census(reasonA, rowsA))
    .map(([reason, rows]) => ({ key: reason, label: REJECT_REASON_LABELS[reason], rows }));
  // Manual inclusions too (final wave, I2): a rejection whose candidate
  // fell out of both `proposed` and `alternates` after a radius change can
  // still be a re-attached `manualInclusions` entry (the appraiser's own
  // addition survives via its carried `candidate` — `sample-manual.ts`) —
  // omitting it here made a genuinely-in-the-sample rejected row silently
  // disappear from the list while still counting toward the header total.
  const all = new Map(
    [
      ...snap.proposed,
      ...snap.alternates,
      ...(snap.manualInclusions ?? []).map((i) => i.candidate),
    ].map((c) => [candidateKey(c), c] as const),
  );
  for (const reason of MANUAL_REJECTION_REASONS) {
    const rows = (snap.manualRejections ?? [])
      .filter((m) => m.reason === reason)
      .flatMap((m) => {
        const c = all.get(`${m.transactionId}|${m.lokalId}`);
        // A carried manualRejection whose candidate matches NEITHER the
        // current `proposed`/`alternates` NOR any re-attached
        // `manualInclusions` (e.g. it never had a full `Candidate` carried
        // at all) has nothing real to show — skip it rather than render a
        // "0,00 zł/m²" ghost row (final wave, T8 #1). The header count
        // (census + manualRejections.length) is unaffected — it never
        // reads this function's output.
        if (!c) return [];
        return [
          {
            key: `${m.transactionId}|${m.lokalId}`,
            date: c.date,
            area: c.area,
            pricePerM2: c.pricePerM2,
            distanceM: c.distanceM,
            ...(m.note ? { note: m.note } : {}),
            manual: true,
          },
        ];
      });
    if (rows.length)
      groups.push({ key: `manual:${reason}`, label: MANUAL_REJECTION_LABELS[reason], rows });
  }
  return groups;
}
