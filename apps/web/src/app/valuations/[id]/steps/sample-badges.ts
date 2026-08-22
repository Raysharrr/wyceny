import { sameness, type Candidate, type Flag } from "@/domain/sample-selection";
import type { SubjectEgib } from "@/domain/egib-id";

export type BadgeTone = "outline" | "secondary" | "destructive";
export type RowBadge = { key: string; label: string; tone: BadgeTone };

const FLAG_BADGE: Record<Flag, RowBadge> = {
  price_outlier: { key: "price_outlier", label: "cena odstająca", tone: "destructive" },
  primary_suspect: {
    key: "primary_suspect",
    label: "prawdopodobnie deweloperska",
    tone: "destructive",
  },
  market_unknown: { key: "market_unknown", label: "rynek?", tone: "outline" },
};

/**
 * Badges for one candidate row (spec §Krok 3 UI, ADR-015 rule 10: storeys are
 * an explicit criterion — ">5 kond." when known). Identity badges show only
 * the strongest match: same building ⊃ same parcel ⊃ same obręb; the obręb
 * itself is a column, so "same obręb" alone gets no badge, "other obręb" does.
 */
export function rowBadges(
  c: Candidate,
  flags: Flag[],
  subjectEgib: SubjectEgib | undefined,
): RowBadge[] {
  const out: RowBadge[] = [];
  if (subjectEgib && c.egib) {
    const s = sameness(c, subjectEgib);
    if (s.sameBuilding)
      out.push({ key: "same_building", label: "ten sam budynek", tone: "secondary" });
    else if (s.sameParcel)
      out.push({ key: "same_parcel", label: "ta sama działka", tone: "secondary" });
    else if (!s.sameObreb) out.push({ key: "other_obreb", label: "inny obręb", tone: "outline" });
  }
  if (c.floor !== null) {
    out.push({ key: "floor", label: `p. ${c.floor}`, tone: "outline" });
    if (c.floor > 5) out.push({ key: "tall", label: ">5 kond.", tone: "outline" });
  }
  for (const f of flags) out.push(FLAG_BADGE[f]);
  return out;
}
