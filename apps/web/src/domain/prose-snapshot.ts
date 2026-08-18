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

/**
 * The section's own heading, in the operat's Polish. One map, two readers:
 * the step-6 field labels and the F-4 gate's blocker messages. Two copies
 * would let the appraiser be blocked on "Otoczenie" while the screen calls
 * the field something else.
 */
export const PROSE_SECTION_LABEL: Record<ProseSection, string> = {
  analiza_rynku: "Analiza i charakterystyka rynku",
  opis_lokalu: "Opis lokalu — układ funkcjonalny",
  otoczenie: "Charakterystyka bezpośredniego otoczenia",
  zagospodarowanie: "Opis zagospodarowania terenu",
  standard: "Opis standardu wykończenia",
  uzasadnienie: "Uzasadnienie wyniku — pozycja na tle próby",
};

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
  /**
   * Per-section fingerprint of the facts subset that section was written from
   * (or last accepted against) — see `prose-hash.ts`. A section missing here
   * reads as stale — that is how snapshots written before this change
   * migrate: one regeneration per existing draft on the next visit to step 6.
   */
  factsHashes: Partial<Record<ProseSection, string>>;
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
 * The comparison is now PER SECTION, not over the whole snapshot: a global
 * fingerprint marked every section stale whenever any input moved, so
 * correcting one transaction price threw away four confirmed texts that
 * could not have changed and made the F-4 gate demand they be read again.
 * Each section's fingerprint, model and timestamp come from the INCOMING
 * proposal even when the text was preserved: keeping the old hash would
 * leave the step permanently stale for that section, so every visit would
 * fire — and pay for — a generation whose result it then discards.
 *
 * That adoption is exactly why a preserved section must LOSE its `confirmed`
 * status when ITS fingerprint changes (review finding I-A). Without it,
 * regenerating after an input edit produced a snapshot whose every character
 * predated the edit while its fingerprint claimed otherwise — one click, at
 * full generation cost, and the F-4 staleness blocker was gone without the
 * appraiser reading a single sentence. The in-transaction gate cannot catch
 * that: the staleness lives INSIDE the snapshot, so the adapter recomputes the
 * same hash and finds it consistent. The text is kept (it may still be
 * perfectly good, and losing it would be the other failure) — but it goes back
 * to "to_verify", so the appraiser has to look at it against the new data.
 *
 * An incoming section with no hash of its own (T3: only stale/requested
 * sections are regenerated) is read as "not moved" here — the merge cannot
 * tell, and erring toward preservation is right for a section this run never
 * touched. This is the opposite default from `staleProseSections`, which
 * reads an absent hash as stale (the pre-migration case): the two functions
 * answer different questions — "did THIS regeneration invalidate the text"
 * versus "does the STORED snapshot still match today's facts" — and default
 * oppositely on purpose.
 *
 * Symmetrically, a section ABSENT from the incoming batch (T3 partial
 * regeneration: only stale sections are requested) must carry its WHOLE
 * previous entry forward — text, status and provenance, not just the hash.
 * Carrying only the hash left the text itself unset, so a 2-of-6 partial
 * regeneration silently dropped the other 4 from the screen until something
 * else happened to regenerate them (fix round 1, finding 2).
 *
 * A section that WAS requested this run but whose text the worker's guard
 * rejected looks, on the wire, almost like the case above: `incoming.sections`
 * has no entry for it either. The one difference is `incoming.rejected` DOES
 * have an entry — and that reason must survive into the merge even though old
 * text is carried forward alongside it (T3 ruling 2). Here `sections` and
 * `rejected` stop being disjoint on purpose: the carried-forward text is
 * still the best available content, but silently keeping it with no reason
 * attached would make a failed regeneration indistinguishable from a section
 * nobody asked about — the appraiser clicks "Wygeneruj ponownie", nothing on
 * screen changes, and nothing says why. Whether both are shown together is a
 * rendering decision (Task 5); this function only has to stop discarding one
 * of them.
 *
 * Both `previous.factsHashes` and `incoming.factsHashes` are read with `?.`
 * throughout: a row persisted before this field existed carries
 * `factsHash: string` and no per-section map at all, and this function must
 * stay total against that shape on EITHER side — not only the `previous`
 * side (fix round 1, finding 1), but also `incoming`, since a caller that
 * has not yet migrated to building a `factsHashes` map (e.g. a not-yet-
 * updated UI action) can hand this function that shape too (fix round 2).
 */
export function mergeProseProposal(
  previous: ProseSnapshot | null | undefined,
  incoming: ProseSnapshot,
): ProseSnapshot {
  if (!previous) return incoming;

  const sections: ProseSnapshot["sections"] = {};
  const rejected: ProseSnapshot["rejected"] = {};
  const factsHashes: ProseSnapshot["factsHashes"] = {};
  for (const section of PROSE_SECTIONS) {
    const kept = previous.sections[section];
    const incomingHash = incoming.factsHashes?.[section];
    const previousHash = previous.factsHashes?.[section];
    if (isAppraisers(kept)) {
      // The appraiser's text survives regeneration — but if the facts BEHIND
      // THIS SECTION moved, it goes back to "to_verify": every character of
      // it predates the edit, and the fingerprint it would inherit says
      // otherwise.
      const factsMoved = incomingHash !== undefined && incomingHash !== previousHash;
      sections[section] = factsMoved
        ? sourced(kept.value, kept.provenance.source, "to_verify")
        : kept;
      factsHashes[section] = incomingHash ?? previousHash;
      // No rejection reason next to a text the appraiser wrote — `sections`
      // and `rejected` stay disjoint.
      continue;
    }
    const fresh = incoming.sections[section];
    if (fresh) {
      sections[section] = fresh;
      factsHashes[section] = incomingHash;
    } else if (kept) {
      // Either this section was not part of the incoming batch, or it WAS
      // requested and the worker's guard rejected the output (T3 ruling 2) —
      // either way there is no fresh text, so carry the whole previous entry
      // forward, not just its hash (see the docstring above).
      sections[section] = kept;
      if (previousHash !== undefined) factsHashes[section] = previousHash;
    } else if (previousHash !== undefined) {
      factsHashes[section] = previousHash;
    }
    // A rejection from the PREVIOUS run is not carried over: it explains a
    // generation that no longer describes this snapshot — `reason` below is
    // read from `incoming.rejected` alone, never `previous.rejected`.
    //
    // T3 ruling 2: a rejection from THIS run IS kept even when old text was
    // carried forward (`kept`), on purpose — `sections` and `rejected` are no
    // longer disjoint for this one case. Without it, a section that was
    // re-requested because its facts moved, then failed the worker's number
    // guard, would show its stale carried-forward text with NO indication a
    // regeneration was even attempted — indistinguishable from a section
    // nobody asked about. The old text is still the best available content,
    // so it stays; the reason it could not be refreshed has to survive
    // alongside it. Whether the UI renders both together is Task 5's
    // decision — this only guarantees neither is silently dropped.
    const reason = incoming.rejected[section];
    if (reason && !fresh) rejected[section] = reason;
  }

  return {
    sections,
    rejected,
    factsHashes,
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
 * `model`/`generatedAt` describe the GENERATION and a confirm leaves them
 * alone. `factsHashes` does NOT: each confirmed section records the facts
 * ITS text was last ACCEPTED AGAINST (T7 / T6 review I-2, now per section —
 * T2). The F-4 gate refuses prose whose fingerprint no longer matches the
 * draft — sections stay `confirmed` when the sample is edited underneath
 * them, and `uzasadnienie` would then describe a sample that no longer
 * exists. Re-reading the text on step 6 must therefore be a real way out of
 * that blocker; keeping the generation's old fingerprint would leave a paid
 * regeneration as the only remedy. The caller supplies `meta.factsHashes`
 * (one entry per section, computed from the row inside its own transaction —
 * `currentSectionFactsHash` needs `node:crypto`, which this leaf module must
 * not import, see the file header).
 */
export function confirmProseSnapshot(
  previous: ProseSnapshot | null | undefined,
  texts: Partial<Record<ProseSection, string>>,
  meta: { factsHashes: Partial<Record<ProseSection, string>>; now: Date },
): ProseSnapshot {
  const sections: ProseSnapshot["sections"] = {};
  const rejected: ProseSnapshot["rejected"] = {};
  const factsHashes: ProseSnapshot["factsHashes"] = {};
  for (const section of PROSE_SECTIONS) {
    const text = (texts[section] ?? "").trim();
    if (text) {
      sections[section] = sourced(text, "rzeczoznawca", "confirmed");
      factsHashes[section] = meta.factsHashes[section];
      continue;
    }
    const reason = previous?.rejected[section];
    if (reason) rejected[section] = reason;
  }

  return {
    sections,
    rejected,
    factsHashes,
    model: previous?.model ?? "",
    generatedAt: previous?.generatedAt ?? meta.now.toISOString(),
  };
}
