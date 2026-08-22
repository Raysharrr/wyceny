import { sameness, type Candidate, type Flag } from "@/domain/sample-selection";
import type { SubjectEgib } from "@/domain/egib-id";
import { POZNAN_TERYT_PREFIX } from "@/domain/obreb-name";
import type { StreetIndexState } from "@/ports/sample";

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

// --------------------------------------------------------------- Ulica (Slice 3d)

/** Why a row shows a dash instead of a street — four states, four different things to say. */
export type StreetMissingReason =
  "outside_city" | "index_building" | "pool_without_index" | "not_in_export";

/**
 * The four messages, side by side on purpose (team-lead, 2026-08-22): one shared wording
 * would have to be so vague it would say none of these things. `outside_city` is a
 * permanent boundary of the source, `index_building` is transient and asks for an action,
 * `pool_without_index` needs a fresh fetch (a radius change re-selects from the cached
 * pool WITHOUT calling the worker, so those rows would never fill in on their own), and
 * `not_in_export` is a transaction newer than the export — nothing for the user to do.
 */
export function streetMissingTitle(reason: StreetMissingReason, cutoff: string | null): string {
  switch (reason) {
    case "outside_city":
      return "Transakcja spoza Poznania — miejski eksport adresów jej nie obejmuje.";
    case "index_building":
      return "Adresy się wczytują — pobierz próbę z rejestru ponownie za chwilę.";
    case "pool_without_index":
      return "Ta próba została pobrana bez adresów — pobierz próbę z rejestru ponownie, żeby je uzupełnić.";
    case "not_in_export":
      return cutoff
        ? `Adres jeszcze nieopublikowany (eksport z ${cutoff.slice(0, 7)}).`
        : "Brak adresu tej transakcji w rejestrze.";
  }
}

/**
 * `null` when the row HAS a street. Order matters: first the states that are ours to
 * explain (no index at all, still building), then the boundary of the source, and only
 * then "the export simply doesn't have it" — otherwise a pool fetched before the index
 * existed would be labelled with a claim about the export that we cannot back.
 */
export function streetMissingReason(
  c: Candidate,
  streetIndex: StreetIndexState | undefined,
): StreetMissingReason | null {
  if (c.street) return null;
  if (!streetIndex) return "pool_without_index";
  if (streetIndex.status !== "ready") return "index_building";
  // An unparseable lokalId leaves `egib` null — that is "we don't know", not "outside
  // Poznań", and must not claim a boundary we haven't established.
  if (c.egib && !c.egib.teryt.startsWith(POZNAN_TERYT_PREFIX)) return "outside_city";
  return "not_in_export";
}
