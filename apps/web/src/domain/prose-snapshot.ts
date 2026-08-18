/**
 * ProseSnapshot — the LLM prose proposals persisted on `inputs.prose`
 * (ADR-014, FR-6) — plus the pure algebra over it. Leaf module: no import
 * except the provenance kernel, mirroring `subject-snapshot.ts` /
 * `kw-snapshot.ts`.
 *
 * Deliberately free of `node:` builtins so a Client Component (the step-6
 * editors) can import `PROSE_SECTIONS`/`ProseSection` — and `mergeProseProposal`,
 * which the step applies to a fresh proposal so the screen shows exactly what
 * the repo persisted — without dragging a server-only module into the browser
 * bundle. The sha256 lives in `prose-hash.ts` for exactly that reason.
 */

import { sourced, type Sourced } from "@wyceny/shared";

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

/** Sections the appraiser owns: regeneration must not touch them. */
function isAppraisers(entry: Sourced<string> | undefined): entry is Sourced<string> {
  return entry != null && entry.provenance.source !== "ai";
}

/**
 * Folds a fresh proposal onto whatever the draft already holds.
 *
 * The rule the whole "Wygeneruj ponownie" button rests on: a section the
 * appraiser confirmed keeps ITS text and ITS provenance — only `ai` sections
 * (and absent ones) are replaced. Losing accepted text would be silent and
 * irreversible, and the operat is a document with legal effects.
 *
 * The fingerprint, model and timestamp come from the INCOMING proposal even
 * when every section was preserved: keeping the old `factsHash` would leave
 * the step permanently stale, so every visit would fire — and pay for — a
 * generation whose result it then discards.
 */
export function mergeProseProposal(
  previous: ProseSnapshot | null | undefined,
  incoming: ProseSnapshot,
): ProseSnapshot {
  if (!previous) return incoming;

  const sections: ProseSnapshot["sections"] = {};
  const rejected: ProseSnapshot["rejected"] = {};
  for (const section of PROSE_SECTIONS) {
    const kept = previous.sections[section];
    if (isAppraisers(kept)) {
      sections[section] = kept;
      // No rejection reason next to a text the appraiser wrote — `sections`
      // and `rejected` stay disjoint.
      continue;
    }
    const fresh = incoming.sections[section];
    if (fresh) sections[section] = fresh;
    // A rejection from the PREVIOUS run is not carried over: it explains a
    // generation that no longer describes this snapshot.
    const reason = incoming.rejected[section];
    if (reason && !fresh) rejected[section] = reason;
  }

  return {
    sections,
    rejected,
    factsHash: incoming.factsHash,
    model: incoming.model,
    generatedAt: incoming.generatedAt,
  };
}

/**
 * The appraiser's submit: the whole step at once, exactly like
 * `confirmSample`/`confirmFeatures`. Every non-blank field becomes
 * `rzeczoznawca`/`confirmed` — this is the ONLY place prose can reach
 * `confirmed` (ADR-010; the model's output can never claim it).
 *
 * A blank field REMOVES the section rather than leaving the generated text
 * behind: the appraiser deleting a proposal means the operat must not print
 * it, and T7's gate must see an unfilled section. `texts` is the complete
 * editor state — a missing key reads as blank — so after a confirm no `ai`
 * section survives.
 *
 * `factsHash`/`model`/`generatedAt` describe the GENERATION, so a confirm
 * leaves them alone. Prose written by hand with no generation behind it gets
 * the current fingerprint instead, or the step would look stale forever and
 * keep triggering generations it does not need.
 */
export function confirmProseSnapshot(
  previous: ProseSnapshot | null | undefined,
  texts: Partial<Record<ProseSection, string>>,
  meta: { factsHash: string; now: Date },
): ProseSnapshot {
  const sections: ProseSnapshot["sections"] = {};
  const rejected: ProseSnapshot["rejected"] = {};
  for (const section of PROSE_SECTIONS) {
    const text = (texts[section] ?? "").trim();
    if (text) {
      sections[section] = sourced(text, "rzeczoznawca", "confirmed");
      continue;
    }
    const reason = previous?.rejected[section];
    if (reason) rejected[section] = reason;
  }

  return {
    sections,
    rejected,
    factsHash: previous?.factsHash ?? meta.factsHash,
    model: previous?.model ?? "",
    generatedAt: previous?.generatedAt ?? meta.now.toISOString(),
  };
}
