/**
 * Chunk arithmetic of the register import (S2b), shared by the browser
 * wizard and the server service. No node imports here on purpose — the
 * client component must not pull `node:crypto` through the service module
 * (review 1 m-7).
 */

/** Rows per `importCoopChunk` call from the screen: one geocoder call (adapter CHUNK = 20), ≈ 20 × 1.4 s worst case < the action timeout. */
export const IMPORT_CHUNK = 20;

/** Counters of one chunk; summed by the caller across chunks, then handed to `finalizeCoopImport`. */
export type CoopChunkResult = {
  attempted: number;
  inserted: number;
  /** Rows already present in the register (by dedupe key) — in-file duplicates were skipped by the parser. */
  duplicates: number;
  geocoded: number;
  needsFix: number;
  usedNominatim: boolean;
};

export function sumCoopChunks(chunks: readonly CoopChunkResult[]): CoopChunkResult {
  return chunks.reduce(
    (a, c) => ({
      attempted: a.attempted + c.attempted,
      inserted: a.inserted + c.inserted,
      duplicates: a.duplicates + c.duplicates,
      geocoded: a.geocoded + c.geocoded,
      needsFix: a.needsFix + c.needsFix,
      usedNominatim: a.usedNominatim || c.usedNominatim,
    }),
    { attempted: 0, inserted: 0, duplicates: 0, geocoded: 0, needsFix: 0, usedNominatim: false },
  );
}
