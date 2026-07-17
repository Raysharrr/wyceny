"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { subjectData } from "@/app/valuations/_deps";
import { WORKER_SUBJECT_PREFIX } from "@/adapters/subject-http";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import type { SubjectProposal } from "@/ports/subject";

const inputSchema = valuationFormSchema.pick({ address: true });

export type GetSubjectDataResult =
  { proposal: SubjectProposal } | { outOfCoverage: string } | { error: string };

const GENERIC_ERROR =
  "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie.";

/**
 * Server Action backing the "Pobierz dane przedmiotu" button. Session-gated
 * like `createValuation`; validates the address with the same rule as the
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

  try {
    const result = await subjectData.fetchSubject(parsed.data.address);
    if (result.kind === "outOfCoverage") {
      return { outOfCoverage: result.message };
    }
    return { proposal: result.proposal };
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    if (message && !message.startsWith(WORKER_SUBJECT_PREFIX)) {
      return { error: message };
    }
    return { error: GENERIC_ERROR };
  }
}
