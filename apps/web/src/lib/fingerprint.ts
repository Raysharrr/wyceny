import { createHmac } from "node:crypto";

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
 * KEYED, not a plain digest. A bare sha256 over a low-entropy value is
 * reversible by enumeration: a gmina holds a few thousand parcel ids, and RCN
 * transactions are public, so anyone with this table could hash the candidates
 * and read the originals straight back. Under GDPR an unsalted digest of
 * computable data is still personal data — and this repo is public. An HMAC
 * answers the same equality question while making the column worthless
 * without the key.
 *
 * The key is DERIVED from `BETTER_AUTH_SECRET` rather than being a new
 * variable: that secret is already required (the app refuses to boot without
 * it), already server-only, and never reaches the browser — so this adds no
 * provisioning step and no new way to misconfigure a deployment. The
 * derivation keeps the two uses separate, so a fingerprint never exercises
 * the auth key directly.
 *
 * ponytail: hashes answer "changed?", not "changed by how much". Magnitude
 * would be a separate decision, needing its own RODO justification.
 */
function fingerprintKey(): Buffer {
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base) {
    // Same stance as db/client.ts: refuse rather than silently degrade. A
    // fallback here would quietly restore the reversible digest this exists
    // to remove, and would do it exactly when nobody is looking.
    throw new Error("BETTER_AUTH_SECRET is not set — cannot key proposal fingerprints.");
  }
  return createHmac("sha256", base).update("fingerprint-v1").digest();
}

export function fingerprint(values: Record<string, unknown>): Record<string, string> {
  const key = fingerprintKey();
  const out: Record<string, string> = {};
  for (const [key_, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    // JSON.stringify keeps 1 and "1" apart (the quotes survive), so an edit
    // that only changes a field's type still reads as an edit.
    out[key_] = createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
  }
  return out;
}
