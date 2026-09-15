import type { EncumbranceTreatment, KwGruntSnapshot, KwSnapshot } from "./kw-snapshot";
import { PROPERTY_RIGHT_DOC, type PropertyRight } from "./property-right";

/**
 * R-10 (ADR-018 reg. 2) — the ONE answer to "which KW facts does this
 * valuation need, and are they there". The step-1 schemas, the operat's
 * document-field blockers and the F-4 gate used to spell the rule out each on
 * their own; they now ask here and only check the value. Pure domain, no I/O
 * (F-10).
 *
 * An absent right is a legacy caller and reads as własność, so everything
 * stays required (default-deny).
 */
export type KwRequirements = {
  /** Step 1: a KW number must be typed — the manual path, no snapshot attached. */
  numerKwWFormularzu: boolean;
  /** Operat header fields: the valuation's KW number must be set. */
  numerKwWDokumencie: boolean;
  /** The lokal's own book must be examined (not so for a lokal that has none — deweloperski). */
  ksiegaLokalu: boolean;
  /** The grunt's (mother) book must be examined. */
  ksiegaGruntu: boolean;
  /** …and is it? Step 1's per-card "Zbadana"/"Do zbadania" badge reads these, so
   * a card can never claim an examination the F-4 gate would refuse. */
  lokalZbadana: boolean;
  gruntZbadana: boolean;
  /** How many books this valuation needs examined — step 1's "Zbadane księgi: N z {wymagane}". */
  wymagane: number;
  /** How many of the required ones actually are. */
  zbadane: number;
  /** B-06: at least one required book is not examined. */
  brakBadania: boolean;
};

/**
 * Just the facts the rule reads. Structural on purpose: the F-4 gate's
 * `GateInput` describes its input by shape rather than importing the snapshot
 * wholesale, and the rule must fit that without an adapter (F-10).
 */
export type KwExamination = Pick<KwSnapshot, "source" | "kwLokalu" | "deweloperski"> &
  Partial<Pick<KwSnapshot, "dataBadania" | "dzial3" | "dzial4">>;

/**
 * A book counts as examined when it was read (a PDF excerpt or eKW by hand —
 * a deed is not a book), it has a number, the appraiser recorded WHEN they
 * read it, and both dzialy were answered. `dzialN == null` means the
 * Brak wpisów / Są wpisy question was never answered, which is exactly the
 * hole the 14.09 operat fell into: it described a dział III nobody had looked
 * at. An `akt` never satisfies this — it is a deed, not the register.
 */
function ksiegaLokaluZbadana(kw: KwExamination | null | undefined): boolean {
  return (
    kw != null &&
    (kw.source === "odpis_kw" || kw.source === "ekw_reczne") &&
    !!kw.kwLokalu &&
    !!kw.dataBadania &&
    kw.dzial3 != null &&
    kw.dzial4 != null
  );
}

/** Same rule for the mother book; its `source` is manual-only in paczka 1. */
function ksiegaGruntuZbadana(kwGrunt: KwGruntSnapshot | null | undefined): boolean {
  return (
    kwGrunt != null &&
    !!kwGrunt.nrKsiegi &&
    !!kwGrunt.dataBadania &&
    kwGrunt.dzial3 != null &&
    kwGrunt.dzial4 != null
  );
}

export function kwRequirements(
  propertyRight: PropertyRight | undefined,
  kw: KwExamination | null | undefined,
  kwGrunt?: KwGruntSnapshot | null,
): KwRequirements {
  const doc = PROPERTY_RIGHT_DOC[propertyRight ?? "wlasnosc_lokalu"];
  // Only a right with a KW of its own asks for a number at all (T-12).
  const numberRequired = doc.wymagaKwLokalu;
  // A lokal bought from a developer has no book yet: the mother book is the
  // whole legal picture, and the deed stands in for the rest (as it does today).
  const ksiegaLokalu = doc.wymagaKwLokalu && !kw?.deweloperski;
  const ksiegaGruntu = doc.wymagaKwGruntu;
  const lokalZbadana = ksiegaLokaluZbadana(kw);
  const gruntZbadana = ksiegaGruntuZbadana(kwGrunt);
  const zbadane = (ksiegaLokalu && lokalZbadana ? 1 : 0) + (ksiegaGruntu && gruntZbadana ? 1 : 0);
  const wymagane = (ksiegaLokalu ? 1 : 0) + (ksiegaGruntu ? 1 : 0);
  return {
    numerKwWFormularzu: numberRequired && kw == null,
    numerKwWDokumencie: numberRequired,
    ksiegaLokalu,
    ksiegaGruntu,
    lokalZbadana,
    gruntZbadana,
    wymagane,
    zbadane,
    // Asked WITHOUT a `kw != null` guard — that guard was the bug: on the
    // manual path the gate never ran, and the operat claimed an examination
    // that had not happened (ADR-018 reg. 3, I-13 U).
    brakBadania: zbadane < wymagane,
  };
}

/**
 * B-07 (ADR-018 reg. 6): an entry in dział III of the LOKAL's book forces the
 * appraiser to say whether the figure accounts for it, and on what basis.
 * Only the lokal's book — entries in the grunt's dział III are described in
 * §8.2 but do not encumber this lokal (RAPORT-diff D-02).
 */
export function encumbranceDecisionNeeded(
  kw: KwExamination | null | undefined,
  encumbranceTreatment: EncumbranceTreatment | null | undefined,
): boolean {
  if (kw?.dzial3?.wpisy !== true) return false;
  return !encumbranceTreatment || !encumbranceTreatment.podstawa.trim();
}
