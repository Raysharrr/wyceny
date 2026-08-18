"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { proseProposal, valuationRepository } from "@/app/valuations/_deps";
import { ProseWorkerDetailError } from "@/adapters/prose-http";
import {
  buildProseFacts,
  buildProseTransactions,
  proseSnapshotOf,
  selectProseSections,
} from "@/domain/prose";
import { currentProseFactsHash } from "@/domain/prose-hash";
import { proseEnabled } from "@/lib/prose-enabled";
import { mintWorkerToken } from "@/lib/worker-token";
import type { ProseSnapshot } from "@/domain/prose-snapshot";

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
 * the facts from the draft itself, asks the worker for the sections those
 * facts can actually back, and persists the result as an `ai`/`to_verify`
 * proposal — the appraiser still has to read, edit and accept it (F-4).
 *
 * Every gate that can be checked locally runs BEFORE the call: an LLM
 * generation costs real money, so a non-draft, a foreign valuation or a draft
 * with nothing to write about must never reach the worker. Failures are
 * honest — no section is invented, and a section the worker could not deliver
 * comes back in `rejected` for the appraiser to write by hand.
 *
 * F-11: neither the market value nor the unit value is sent; the result's
 * standing in the sample travels as a categorical phrase (see `domain/prose`).
 */
export async function proposeProse(id: string): Promise<ProposeProseResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

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

  const facts = buildProseFacts({ address: valuation.address, inputs: valuation.inputs });
  const sections = selectProseSections(facts);
  if (sections.length === 0) return { error: NO_FACTS };

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
    console.error("proposeProse failed", error);
    // Default-deny on error text (T5 review): ONLY the worker's own Polish
    // `detail` — which the adapter marks with its own type — is written for a
    // human and may be shown. Everything else is our plumbing: a dropped
    // connection ("fetch failed"), a proxy's HTML quoted by the JSON parser
    // (internal hostname and all), a bug in our own code. Those get the
    // generic sentence; the details go to the server log above.
    return { error: error instanceof ProseWorkerDetailError ? error.message : GENERIC };
  }

  const snapshot = proseSnapshotOf({
    sections: proposal.sections,
    rejected: proposal.rejected,
    model: proposal.model,
    // Pins the proposals to the facts they were written from: once the draft
    // moves on, the UI can tell a stale proposal from a current one. Via the
    // SAME helper the step-6 page compares against — two hand-rolled copies of
    // this expression drifting apart would mark every draft stale, and the
    // step auto-generates on stale.
    factsHash: currentProseFactsHash({ address: valuation.address, inputs: valuation.inputs }),
    generatedAt: new Date(),
  });

  const saved = await valuationRepository.saveProse(id, session.user, snapshot, proposal.usage);
  if (!saved) return { error: NOT_FOUND };

  revalidatePath(`/valuations/${id}`);
  return { prose: snapshot };
}
