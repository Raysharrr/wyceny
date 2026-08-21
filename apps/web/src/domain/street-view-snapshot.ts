/**
 * Frozen Street View lookup per building (`buildingKey` from sample-selection),
 * written once at fetch time so the step-3 preview and the operat stay
 * reproducible (ADR-011). `panoId === null` = Google has no panorama there
 * ("brak zdjęcia ulicy"). `lat`/`lng` = the building position (EPSG:2180 →
 * WGS84, domain/geo.ts) the iframe centres on; `heading` = camera → building.
 */
export type StreetViewEntry = {
  panoId: string | null;
  captureDate: string | null; // "YYYY-MM" from Metadata API, null when no panorama
  thumbnailKey: string | null; // PortStorage key from `thumbnailKey()` (app/actions/_street-view-enrich.ts) — slash-free, e.g. "streetview-<buildingKey with / -> ~>.jpg"
  heading: number | null; // degrees 0–360
  lat: number;
  lng: number;
};
export type StreetViewSnapshot = Record<string, StreetViewEntry>;
