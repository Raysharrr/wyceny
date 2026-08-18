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
import { buildProseFacts, type ProseFacts, type ProseFactsInput } from "./prose";

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

export function proseFactsHash(facts: ProseFacts): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(facts)))
    .digest("hex");
}

/**
 * The draft's CURRENT fingerprint, in one expression.
 *
 * Every caller that asks "are these proposals still about this draft?" must
 * build the facts the same way the generation did. Two independent
 * `proseFactsHash(buildProseFacts(...))` call sites that drift apart would
 * mark every draft stale — and the step auto-generates on stale, so the drift
 * would bill a generation on every single visit. One function, one answer.
 */
export function currentProseFactsHash(input: ProseFactsInput): string {
  return proseFactsHash(buildProseFacts(input));
}
