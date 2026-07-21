/**
 * Port for the worker's map-proposal (GUGiK WMS GetMap crops for the
 * ewidencyjna/orto maps that seed section 8.1 of a valuation).
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10).
 */
export interface MapImages {
  ewidencyjna: Buffer; // PNG
  orto: Buffer; // JPEG
}

/**
 * Result of a fetch attempt. Total by design: `unavailable` covers every
 * failure (out-of-coverage, worker error, network failure) uniformly,
 * because the approve flow treats them all the same way — render the
 * honest "no maps" stub instead of retrying (spec decision 4).
 */
export type MapFetchResult =
  { kind: "ok"; maps: MapImages } | { kind: "unavailable"; message: string };

export interface PortMapImages {
  /**
   * Fetches the ewidencyjna + orto map crops for the given address, sourced
   * from GUGiK WMS via the worker's `/map-proposal` integration.
   */
  fetchMaps(address: string): Promise<MapFetchResult>;
}
