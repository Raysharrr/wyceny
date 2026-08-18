/**
 * Fingerprint of the facts a set of prose proposals was written from
 * (ADR-014). Stored on the snapshot so the UI can tell a proposal that still
 * describes the draft from one the appraiser has since invalidated by editing
 * the inputs — the non-blocking cousin of `InputsChangedError`: a mismatch
 * asks for a regeneration, it does not refuse anything.
 *
 * Split out of `prose.ts` ON PURPOSE: this is the only prose module that
 * touches a `node:` builtin, and `prose.ts`/`prose-snapshot.ts` must stay
 * importable from a Client Component (the step-6 editors) without pulling
 * `node:crypto` into the browser bundle.
 */

import { createHash } from "node:crypto";
import {
  buildProseFacts,
  buildProseTransactions,
  type ProseFacts,
  type ProseFactsInput,
} from "./prose";

/**
 * JSON with keys sorted recursively. Plain `JSON.stringify` preserves
 * INSERTION order, so the same facts assembled by a different code path would
 * fingerprint differently — the exact false "stale" the hash exists to avoid.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/**
 * Canonical hash of the facts dictionary ALONE.
 *
 * NOT the draft's fingerprint — it does not see the transactions, and the
 * worker derives `proba.trend_cen` from those. Production code wants
 * {@link currentProseFactsHash}; this stays exported for the canonicalisation
 * tests that pin the hashing itself.
 */
export function proseFactsHash(facts: ProseFacts): string {
  return sha256Canonical(facts);
}

/**
 * The draft's CURRENT fingerprint, in one expression — over the facts AND the
 * transactions.
 *
 * Two reasons this is the only entry point production may use:
 *
 *  - **The transactions are an input to the prose.** They travel outside
 *    `fakty`, but the worker injects `proba.trend_cen = price_trend(transakcje)`
 *    into the facts every section sees (`apps/worker/app/main.py`). Swapping
 *    which comparable carries which month leaves every fact byte-identical
 *    while reversing the trend the operat asserts — a facts-only fingerprint
 *    would call those proposals current (review finding I-2).
 *  - **One expression, one answer.** Every caller asking "are these proposals
 *    still about this draft?" must build the inputs the same way the generation
 *    did. Two hand-rolled copies drifting apart would mark every draft stale,
 *    and the step auto-generates on stale — the drift would bill a generation
 *    on every single visit.
 */
export function currentProseFactsHash(input: ProseFactsInput): string {
  return sha256Canonical({
    facts: buildProseFacts(input),
    transactions: buildProseTransactions(input.inputs.comparables),
  });
}
