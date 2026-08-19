import { createHash } from "node:crypto";

/**
 * Per-field hashes of an AI proposal, recorded the moment it arrives.
 *
 * Why hashes and not the values: the metric this feeds — "% of fields
 * accepted as proposed" (PRD §10) — is pure equality. Comparing this hash to
 * a hash of the final value answers it completely. Storing the values
 * themselves would put EGiB parcels, RCN comparables and the geocoded address
 * into `event_log` — the very data F-12 masks before it may reach a document,
 * and a hole straight through the allowlist in `log.ts`.
 *
 * Why at all, given this slice does not compute the metric: the proposal is
 * overwritten in `inputs` the moment the appraiser edits it, and write-once
 * covers the snapshot, not the history of a field. Uncollected, the
 * before-picture is gone for good.
 *
 * ponytail: hashes answer "changed?", not "changed by how much". Magnitude
 * would be a separate decision, needing its own RODO justification.
 */
export function fingerprint(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    // JSON.stringify keeps 1 and "1" apart (the quotes survive), so an edit
    // that only changes a field's type still reads as an edit.
    out[key] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  return out;
}
