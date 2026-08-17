/**
 * ProseSnapshot — the LLM prose proposals persisted on `inputs.prose`
 * (ADR-014, FR-6). Standalone leaf type: no import except the provenance
 * kernel, mirroring `subject-snapshot.ts` / `kw-snapshot.ts`.
 *
 * Deliberately free of `node:` builtins so a Client Component (the step-6
 * editors) can import `PROSE_SECTIONS`/`ProseSection` without dragging a
 * server-only module into the browser bundle — the sha256 lives in
 * `prose-hash.ts` for exactly that reason.
 */

import type { Sourced } from "@wyceny/shared";

/** The six operat sections the model writes — worker `prose.SECTIONS`, same order. */
export const PROSE_SECTIONS = [
  "analiza_rynku",
  "opis_lokalu",
  "otoczenie",
  "zagospodarowanie",
  "standard",
  "uzasadnienie",
] as const;

export type ProseSection = (typeof PROSE_SECTIONS)[number];

export type ProseSnapshot = {
  /**
   * Text per section. A proposal always arrives as
   * `{ source: "ai", status: "to_verify" }` — "confirmed" is assigned only at
   * the web ACL when the appraiser accepts the text (ADR-010).
   */
  sections: Partial<Record<ProseSection, Sourced<string>>>;
  /**
   * Sections the worker could not deliver: the numbers its guard rejected
   * twice, or an EMPTY list when the call itself failed. Either way the
   * section is left for the appraiser to write by hand.
   */
  rejected: Partial<Record<ProseSection, string[]>>;
  /** sha256 of the facts these proposals were written from — see `prose-hash.ts`. */
  factsHash: string;
  model: string;
  /** ISO timestamp — passed in by the caller, never read from the clock here (F-2). */
  generatedAt: string;
};
