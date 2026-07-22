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

export type InspectionSnapshot = {
  note: string | null;
  /** document-table keys per section; array order = upload order = render order. */
  photos: Record<InspectionSection, string[]>;
};

export const EMPTY_INSPECTION: InspectionSnapshot = {
  note: null,
  photos: { otoczenie: [], budynekZewn: [], wnetrza: [] },
};

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
