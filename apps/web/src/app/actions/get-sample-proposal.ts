"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { eventLog, sampleProposal } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { fingerprint } from "@/lib/fingerprint";
import { currentTraceId, withTrace } from "@/lib/trace";
import { WORKER_RESPONDED_PREFIX } from "@/adapters/sample-http";
import { valuationFormObject } from "@/lib/valuation-form-schema";
import type { SampleProposal } from "@/ports/sample";

const getSampleProposalInputSchema = valuationFormObject.pick({ address: true, area: true });

export type GetSampleProposalInput = { address: string; area: number };

export type GetSampleProposalResult = { proposal: SampleProposal } | { error: string };

const GENERIC_ERROR =
  "Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie.";

/**
 * Server Action backing the "Pobierz próbę z RCN" button (Task 5). Session-
 * gated like `createDraft`; validates address/area with the same rules
 * as the main form (reused via `.pick()`), then delegates to
 * `PortSampleProposal`. The HTTP adapter's Polish `detail` message (surfaced
 * by the worker on failure, e.g. too few nearby transactions) is passed
 * through verbatim; the adapter's own English status-text fallback (used
 * when the worker response carries no `detail`) is replaced with a generic
 * Polish message instead.
 */
export async function getSampleProposal(
  input: GetSampleProposalInput,
): Promise<GetSampleProposalResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = getSampleProposalInputSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message =
      firstIssue?.code === "invalid_type" ? "Nieprawidłowe dane formularza." : firstIssue?.message;
    return { error: message ?? "Nieprawidłowe dane formularza." };
  }

  return withTrace(async () => {
    try {
      const proposal = await sampleProposal.fetchProposal(parsed.data.address, parsed.data.area);
      // Keyed by POSITION, never by transactionId: that id is masked out of
      // the document by F-12, so it has no business sitting in a table key
      // in the clear. Only the three fields the appraiser can actually edit
      // are hashed — a later "% as proposed" needs to tell an edit from an
      // acceptance, not to re-identify a transaction.
      await eventLog.record({
        level: "info",
        event: "proposal.sample",
        traceId: currentTraceId(),
        actorId: session.user.id,
        meta: {
          fields: fingerprint(
            Object.fromEntries(
              proposal.transactions.map((tx, i) => [
                `tx${i}`,
                { date: tx.date, area: tx.area, pricePerM2: tx.pricePerM2 },
              ]),
            ),
          ),
          count: proposal.transactions.length,
        },
      });
      return { proposal };
    } catch (error) {
      await recordFailure({
        event: "getSampleProposal.failed",
        error,
        actorId: session.user.id,
      });
      const message = error instanceof Error ? error.message : undefined;
      if (message && !message.startsWith(WORKER_RESPONDED_PREFIX)) {
        return { error: message };
      }
      return { error: GENERIC_ERROR };
    }
  });
}
