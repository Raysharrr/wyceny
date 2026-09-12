/**
 * Batch geocoding for register rows (T-13): the worker's UUG → Nominatim
 * chain, one result per input address, `null` when neither knows it — that
 * row is "do poprawki", never a failed import.
 */
export type GeocodeHit = { x: number; y: number; source: "uug" | "nominatim" };

export interface PortGeocoder {
  /** Same length and order as `addresses`. */
  geocodeMany(addresses: readonly string[], token: string): Promise<(GeocodeHit | null)[]>;
}
