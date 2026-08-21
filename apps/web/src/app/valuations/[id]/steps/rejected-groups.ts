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
  const groups: RejectedGroup[] = [...auto.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([reason, rows]) => ({ key: reason, label: REJECT_REASON_LABELS[reason], rows }));
  const all = new Map(
    [...snap.proposed, ...snap.alternates].map((c) => [candidateKey(c), c] as const),
  );
  for (const reason of MANUAL_REJECTION_REASONS) {
    const rows = (snap.manualRejections ?? [])
      .filter((m) => m.reason === reason)
      .map((m) => {
        const c = all.get(`${m.transactionId}|${m.lokalId}`);
        return {
          key: `${m.transactionId}|${m.lokalId}`,
          date: c?.date ?? "",
          area: c?.area ?? 0,
          pricePerM2: c?.pricePerM2 ?? 0,
          distanceM: c?.distanceM ?? 0,
          ...(m.note ? { note: m.note } : {}),
          manual: true,
        };
      });
    if (rows.length)
      groups.push({ key: `manual:${reason}`, label: MANUAL_REJECTION_LABELS[reason], rows });
  }
  return groups;
}
