import type { PortSubjectData, SubjectFetchResult, SubjectProposal } from "../ports/subject";

/**
 * Prefix of the fallback error message thrown below when the worker's error
 * response has no `detail` (i.e. not a Polish user-facing message). Exported
 * so callers (e.g. `get-subject-data.ts`) can distinguish "this is the
 * worker's Polish detail" from "this is our own English fallback" without
 * duplicating the literal — keeps the two in sync if the wording changes.
 */
export const WORKER_SUBJECT_PREFIX = "worker /subject-proposal responded";

/**
 * HTTP adapter for {@link PortSubjectData}, backed by the Python worker's
 * `/subject-proposal` endpoint (EGiB + MPZP integration).
 */
export function httpSubjectProposal(baseUrl: string): PortSubjectData {
  return {
    async fetchSubject(address: string): Promise<SubjectFetchResult> {
      const response = await fetch(`${baseUrl}/subject-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (response.status === 422) {
        // Non-retryable: address outside the supported EGiB/MPZP coverage
        // area. The worker's Polish `detail` tells the user to fill data
        // manually instead.
        const body = (await response.json()) as { detail?: string };
        return {
          kind: "outOfCoverage",
          message:
            body.detail ?? "Auto-pobieranie danych przedmiotu jest niedostępne dla tego adresu.",
        };
      }
      if (!response.ok) {
        let detail: string | undefined;
        try {
          const body = (await response.json()) as { detail?: string };
          detail = body.detail;
        } catch {
          // no JSON body — fall back below
        }
        throw new Error(
          detail ?? `${WORKER_SUBJECT_PREFIX} ${response.status} ${response.statusText}`,
        );
      }
      return { kind: "ok", proposal: (await response.json()) as SubjectProposal };
    },
  };
}
