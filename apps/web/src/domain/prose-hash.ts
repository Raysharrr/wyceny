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
  PROSE_SECTION_FACTS,
  SECTIONS_USING_TRANSACTIONS,
  type ProseFacts,
  type ProseFactsInput,
} from "./prose";
import type { ProseSection } from "./prose-snapshot";

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
 * NOT a draft's fingerprint — it does not see the transactions, and the
 * worker derives `proba.trend_cen` from those. Production code wants
 * {@link currentSectionFactsHash}; this stays exported for the canonicalisation
 * tests that pin the hashing itself.
 */
export function proseFactsHash(facts: ProseFacts): string {
  return sha256Canonical(facts);
}

/**
 * Fingerprint of the facts ONE section was written from.
 *
 * Scoped on purpose: a global fingerprint marked all six sections stale when
 * any input moved, so a corrected transaction price threw away four confirmed
 * texts that could not have changed — and made the F-4 gate demand they be
 * read again. The subset comes from `PROSE_SECTION_FACTS`, which the prompt
 * files pin.
 */
export function currentSectionFactsHash(section: ProseSection, input: ProseFactsInput): string {
  const facts = buildProseFacts(input);
  const subset: Partial<ProseFacts> = {};
  for (const key of PROSE_SECTION_FACTS[section]) {
    if (facts[key] !== undefined) (subset as Record<string, unknown>)[key] = facts[key];
  }
  return sha256Canonical({
    facts: subset,
    // Sorted: the worker orders the sample chronologically before halving the
    // period, so row order is invisible to the model.
    transactions: SECTIONS_USING_TRANSACTIONS.has(section)
      ? [...buildProseTransactions(input.inputs.comparables)].sort((a, b) =>
          a.data === b.data ? a.cena_m2 - b.cena_m2 : a.data < b.data ? -1 : 1,
        )
      : [],
  });
}
