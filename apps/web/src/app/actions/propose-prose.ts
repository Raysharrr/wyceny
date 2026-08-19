"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { proseProposal, valuationRepository } from "@/app/valuations/_deps";
import { ProseWorkerDetailError } from "@/adapters/prose-http";
import {
  attemptedProseSections,
  buildProseFacts,
  buildProseTransactions,
  proseSnapshotOf,
  selectProseSections,
  staleProseSections,
} from "@/domain/prose";
import { currentSectionFactsHash } from "@/domain/prose-hash";
import { proseEnabled } from "@/lib/prose-enabled";
import { mintWorkerToken } from "@/lib/worker-token";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";
import type { ProseSection, ProseSnapshot } from "@/domain/prose-snapshot";

export type ProposeProseResult = { prose: ProseSnapshot } | { error: string };

const NOT_FOUND = "Nie znaleziono wyceny albo nie masz do niej dostępu.";
const NOT_DRAFT = "Opisy można wygenerować tylko dla szkicu wyceny.";
const NO_FACTS =
  "Za mało danych, żeby wygenerować opisy — uzupełnij próbę, notatkę z oględzin albo dane ewidencyjne.";
const NOT_CONFIGURED =
  "Generowanie opisów nie jest skonfigurowane — skontaktuj się z administratorem.";
const GENERIC = "Nie udało się wygenerować opisów — spróbuj ponownie.";
const DISABLED = "Generowanie opisów jest wyłączone.";

/**
 * Server Action behind the operat's prose sections (ADR-014, FR-6): builds
 * the facts from the draft itself, asks the worker ONLY for the sections
 * that need it, and persists the result as an `ai`/`to_verify` proposal —
 * the appraiser still has to read, edit and accept it (F-4).
 *
 * Every gate that can be checked locally runs BEFORE the call: an LLM
 * generation costs real money, so a non-draft, a foreign valuation or a draft
 * with nothing to write about must never reach the worker. Failures are
 * honest — no section is invented, and a section the worker could not deliver
 * comes back in `rejected` for the appraiser to write by hand.
 *
 * `opts.sections`, omitted, means "whatever is missing or stale, MINUS what
 * was already asked for at these exact facts" (T3, bounded in T5): a section
 * already present with a matching fingerprint is left alone — regenerating it
 * would pay for tokens only to have the merge (`mergeProseProposal`) throw the
 * result away — and so is one that has already been attempted and could not be
 * delivered. Passed explicitly, `opts.sections` is an escape hatch — "redo
 * this one" — that bypasses both filters and still never asks for a section
 * today's facts cannot back at all.
 *
 * Three callers, three intents, and the DEFAULT is the bounded one on purpose:
 * a caller that forgets to say what it is doing gets the cheap behaviour, and
 * the failure mode of forgetting is a click that does nothing rather than a
 * bill nobody asked for.
 *
 *  - no opts — the step entering itself. Automatic, so it must never re-buy an
 *    answer it already has.
 *  - `opts.includeAttempted` — the appraiser pressing "Wygeneruj ponownie".
 *    The server still decides the batch (the browser never re-derives the
 *    missing-or-stale rule), but the bound is lifted, because a click IS the
 *    ask. Without it the button would silently do nothing on exactly the
 *    drafts the bound exists for — and the only retry left for one refused
 *    section would be paying for all six.
 *  - `opts.sections` — "redo these", named.
 *
 * Sections the appraiser already confirmed are NOT excluded from that batch.
 * `mergeProseProposal` demotes a confirmed section back to `to_verify` when
 * ITS facts moved, but only when the section is IN the batch — skipping it
 * here would leave stale text sitting at `confirmed`, with T4's approval gate
 * as the only thing standing between it and a signed operat. The appraiser's
 * own text is never overwritten by this (the merge keeps it regardless); the
 * cost is one discarded generation, a few groszy.
 *
 * F-11: neither the market value nor the unit value is sent; the result's
 * standing in the sample travels as a categorical phrase (see `domain/prose`).
 */
export async function proposeProse(
  id: string,
  opts?: { sections?: ProseSection[]; includeAttempted?: boolean },
): Promise<ProposeProseResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    // The kill switch, on the layer that actually spends (T6 review, I-1). The
    // step props and the component are gated too, but this is a Server Action:
    // a POST endpoint any authenticated owner can call directly, with or
    // without a browser. Checked FIRST — before the draft is even read — so a
    // switched-off generator costs nothing at all, not even a query.
    if (!proseEnabled()) return { error: DISABLED };

    const valuation = await valuationRepository.get(id, session.user);
    if (!valuation) return { error: NOT_FOUND };
    // Re-checked by the repo inside the write transaction; checked here too so a
    // frozen operat never costs a generation.
    if (valuation.status !== "in_progress") return { error: NOT_DRAFT };
    if (!valuation.inputs) return { error: NO_FACTS };

    const factsInput = { address: valuation.address, inputs: valuation.inputs };
    const facts = buildProseFacts(factsInput);
    const generatable = selectProseSections(facts);
    if (generatable.length === 0) return { error: NO_FACTS };

    const stale = new Set(
      staleProseSections(valuation.inputs.prose, factsInput, currentSectionFactsHash),
    );
    // Sections already asked for at exactly these facts (T5 fix round 2). Left
    // out of the AUTOMATIC batch: a section the worker refused stays stale
    // forever — the merge keeps its old fingerprint on purpose, so the F-4 gate
    // goes on blocking it — and would therefore ride along in every batch some
    // OTHER section legitimately earns. Not once: every time anything at all
    // goes stale, for as long as its own facts stay put. The step's
    // `worthGenerating` decides WHETHER to call; this decides WHAT the call
    // contains, and it is the same money.
    const attempted = new Set(
      opts?.includeAttempted
        ? []
        : attemptedProseSections(valuation.inputs.prose, factsInput, currentSectionFactsHash),
    );
    const sections = opts?.sections
      ? opts.sections.filter((s) => generatable.includes(s))
      : generatable.filter(
          (s) => (!valuation.inputs?.prose?.sections[s] || stale.has(s)) && !attempted.has(s),
        );
    if (sections.length === 0) {
      // Nothing left to buy. In the no-opts path that now means one of two
      // things — every generatable section is present and fresh, OR everything
      // that still needs work was already attempted at these exact facts —
      // and `prose` is guaranteed to exist under both: a draft with no prose at
      // all has recorded no attempts either, so its missing sections cannot be
      // filtered out. But `opts.sections` can ALSO filter down to
      // nothing (e.g. naming only a section today's facts cannot back), on a
      // draft with no prior generation at all. Asserting non-null there would
      // ship `{ prose: undefined }` typed as a real snapshot to a caller that
      // only checks `"error" in result`. Returning the current snapshot (rather
      // than calling the worker for nothing) is what makes it safe to always
      // call this action unconditionally on mount: a no-op costs neither tokens
      // nor a write.
      return valuation.inputs.prose ? { prose: valuation.inputs.prose } : { error: NO_FACTS };
    }

    const token = mintWorkerToken();
    if (!token) return { error: NOT_CONFIGURED };

    let proposal;
    try {
      proposal = await proseProposal.fetchProposal({
        token,
        sections,
        facts,
        transactions: buildProseTransactions(valuation.inputs.comparables),
      });
    } catch (error) {
      await recordFailure({
        event: "proposeProse.failed",
        valuationId: id,
        actorId: session.user.id,
        error: error,
      });
      // Default-deny on error text (T5 review): ONLY the worker's own Polish
      // `detail` — which the adapter marks with its own type — is written for a
      // human and may be shown. Everything else is our plumbing: a dropped
      // connection ("fetch failed"), a proxy's HTML quoted by the JSON parser
      // (internal hostname and all), a bug in our own code. Those get the
      // generic sentence; the details go to the server log above.
      return {
        error: errorWithCode(error instanceof ProseWorkerDetailError ? error.message : GENERIC),
      };
    }

    // One fingerprint per REQUESTED section — never the whole six, since only
    // `sections` was actually sent. A section this run never asked about must
    // stay ABSENT from `factsHashes`: `mergeProseProposal` reads that as "not
    // touched by this run" and carries the previous entry forward untouched.
    const factsHashes: Partial<Record<ProseSection, string>> = {};
    for (const section of sections)
      factsHashes[section] = currentSectionFactsHash(section, factsInput);

    const snapshot = proseSnapshotOf({
      sections: proposal.sections,
      rejected: proposal.rejected,
      model: proposal.model,
      factsHashes,
      generatedAt: new Date(),
    });

    const saved = await valuationRepository.saveProse(id, session.user, snapshot, proposal.usage);
    if (!saved) return { error: NOT_FOUND };

    revalidatePath(`/valuations/${id}`);
    return { prose: snapshot };
  });
}
