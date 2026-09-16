/**
 * Inspection snapshot (Slice 10, FR-2) — the photo-key MANIFEST + note.
 *
 * The manifest is load-bearing, not cosmetic: PortStorage has only
 * put/get/delete (no listing), so inputs.inspection is the ONLY place the
 * complete key set lives. Approve reads it live; sign reads it from the
 * FROZEN inputs — approve↔sign determinism follows from the same keys.
 * Keys embed the owning valuationId: an inherited key (versioning, Slice 8
 * newVersionOf copies inputs) fails isOwnPhotoKey and must never be
 * storage.delete()d by the new version.
 */

export const INSPECTION_SECTIONS = ["otoczenie", "budynekZewn", "wnetrza"] as const;
export type InspectionSection = (typeof INSPECTION_SECTIONS)[number];

/**
 * The six fields the inspection note splits into (ADR-017 reg. 1). Five of
 * them feed EXACTLY ONE prose section each (reg. 2); `uwagi` feeds none — it
 * is the appraiser's own remark and the only one printed verbatim.
 *
 * The split is the fix for the 14.09 operat, not tidiness. One note copied
 * under four fact keys meant every section saw the whole thing and pulled a
 * neighbour's thread out of it: §8.1 "Położenie szczegółowe" described the
 * building's age and storey count (D-15), and the same facts came back a
 * fourth time in §8.4 (D-31). A section can only stay inside its subject if
 * its input is the subject.
 */
export const NOTE_FIELDS = [
  "otoczenie",
  "budynek",
  "lokalUklad",
  "wykonczenie",
  "zagospodarowanie",
  "uwagi",
] as const;
export type NoteField = (typeof NOTE_FIELDS)[number];

export type InspectionNotes = Partial<Record<NoteField, string>>;

export type InspectionSnapshot = {
  /**
   * The pre-16.09 single note. READ-ONLY from here on (ADR-017 reg. 5): step 2
   * shows it as "Dawna notatka — rozdziel na pola", but it is NOT a prose fact
   * and is NOT printed. Copying it into the six fields was considered and
   * rejected (ADR-017 Opcja C) — it would recreate the very defect, the same
   * text feeding every section.
   */
  note: string | null;
  /** The six fields; a missing/blank field simply yields no prose section. */
  notes?: InspectionNotes;
  /** document-table keys per section; array order = upload order = render order. */
  photos: Record<InspectionSection, string[]>;
};

export const EMPTY_INSPECTION: InspectionSnapshot = {
  note: null,
  photos: { otoczenie: [], budynekZewn: [], wnetrza: [] },
};

/** One note field's text, trimmed, or "" — the single reader of `notes`. */
export function noteField(
  inspection: InspectionSnapshot | null | undefined,
  field: NoteField,
): string {
  return inspection?.notes?.[field]?.trim() ?? "";
}

/** Global cap (benchmark: the reference operat carries 42 photos). */
export const MAX_INSPECTION_PHOTOS = 50;

const SECTION_SLUG: Record<InspectionSection, string> = {
  otoczenie: "otoczenie",
  budynekZewn: "budynek",
  wnetrza: "wnetrza",
};

export function totalInspectionPhotos(i: InspectionSnapshot | null | undefined): number {
  if (!i) return 0;
  return INSPECTION_SECTIONS.reduce((sum, s) => sum + i.photos[s].length, 0);
}

export function buildPhotoKey(
  section: InspectionSection,
  uuid: string,
  valuationId: string,
): string {
  return `ogledziny-${SECTION_SLUG[section]}-${uuid}-${valuationId}.jpg`;
}

export function isOwnPhotoKey(key: string, valuationId: string): boolean {
  return key.endsWith(`-${valuationId}.jpg`);
}

/** Bajty per sekcja do renderu — typ ŻYJE W DOMENIE (czysty, type-only Buffer), bo
 *  depcruise zabrania importów lib→adapters nawet dla typów (advisor BLOCKER 1). */
export type RenderPhotos = Record<InspectionSection, Buffer[]>;
