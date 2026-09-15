import { PROPERTY_RIGHT_DOC, type PropertyRight } from "./property-right";

/**
 * R-10 (ADR-018 reg. 2) — the ONE answer to "which KW facts does this
 * valuation need". The step-1 schemas, the operat's document-field blockers
 * and the F-4 gate used to spell the rule out each on their own; they now ask
 * here and only check the value. Pure domain, no I/O (F-10).
 *
 * An absent right is a legacy caller and reads as własność, so the numbers
 * stay required (default-deny).
 */
export type KwRequirements = {
  /** Step 1: a KW number must be typed — the manual path, no snapshot attached. */
  numerKwWFormularzu: boolean;
  /** Operat header fields: the valuation's KW number must be set. */
  numerKwWDokumencie: boolean;
  /**
   * F-4 gate: the snapshot must carry the KW gruntu. Asked only when a snapshot
   * exists, so the manual path skips it — the gap ADR-018 names (I-13).
   */
  kwGruntu: boolean;
  /** F-4 gate: the snapshot must carry the KW lokalu, unless the lokal has none (deweloperski). */
  kwLokalu: boolean;
};

export function kwRequirements(
  propertyRight: PropertyRight | undefined,
  kw: { deweloperski: boolean } | null | undefined,
): KwRequirements {
  const doc = PROPERTY_RIGHT_DOC[propertyRight ?? "wlasnosc_lokalu"];
  // Only a right with a KW of its own asks for a number at all (T-12).
  const numberRequired = doc.wymagaKwLokalu;
  return {
    numerKwWFormularzu: numberRequired && kw == null,
    numerKwWDokumencie: numberRequired,
    kwGruntu: kw != null && doc.wymagaKwGruntu,
    kwLokalu: kw != null && !kw.deweloperski && doc.wymagaKwLokalu,
  };
}
