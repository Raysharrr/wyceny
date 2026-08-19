"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { eventLog, subjectData } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { fingerprint } from "@/lib/fingerprint";
import { currentTraceId, errorWithCode, withTrace } from "@/lib/trace";
import { WORKER_SUBJECT_PREFIX } from "@/adapters/subject-http";
import { valuationFormObject } from "@/lib/valuation-form-schema";
import type { SubjectProposal } from "@/ports/subject";

const inputSchema = valuationFormObject.pick({ address: true });

export type GetSubjectDataResult =
  { proposal: SubjectProposal } | { outOfCoverage: string } | { error: string };

const GENERIC_ERROR =
  "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie.";

/**
 * Server Action backing the "Pobierz dane przedmiotu" button. Session-gated
 * like `createDraft`; validates the address with the same rule as the
 * main form (reused via `.pick()`), then delegates to `PortSubjectData`.
 * Distinguishes the worker's non-retryable 422 (`outOfCoverage` — address
 * outside EGiB/MPZP coverage) from a retryable failure, whose Polish
 * `detail` is passed through verbatim; the adapter's own English
 * status-text fallback (no `detail` in the response) is replaced with a
 * generic Polish message instead.
 */
export async function getSubjectData(input: { address: string }): Promise<GetSubjectDataResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Nieprawidłowe dane formularza." };
  }

  return withTrace(async () => {
    try {
      const result = await subjectData.fetchSubject(parsed.data.address);
      if (result.kind === "outOfCoverage") {
        // Not a failure: the worker's 422 says this address is outside the
        // supported area, which is a legitimate answer the appraiser acts on
        // by filling the data by hand. Worth counting, not worth alarming.
        await eventLog.record({
          level: "info",
          event: "proposal.subjectOutOfCoverage",
          traceId: currentTraceId(),
          actorId: session.user.id,
        });
        return { outOfCoverage: result.message };
      }
      await eventLog.record({
        level: "info",
        event: "proposal.subject",
        traceId: currentTraceId(),
        actorId: session.user.id,
        meta: {
          fields: fingerprint({
            parcel: result.proposal.parcel,
            building: result.proposal.building,
            mpzp: result.proposal.mpzp,
          }),
        },
      });
      return { proposal: result.proposal };
    } catch (error) {
      await recordFailure({
        event: "getSubjectData.failed",
        error,
        actorId: session.user.id,
      });
      const message = error instanceof Error ? error.message : undefined;
      if (message && !message.startsWith(WORKER_SUBJECT_PREFIX)) {
        return { error: errorWithCode(message) };
      }
      return { error: errorWithCode(GENERIC_ERROR) };
    }
  });
}
