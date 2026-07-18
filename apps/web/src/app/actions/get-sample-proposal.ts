"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { sampleProposal } from "@/app/valuations/_deps";
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
 * gated like `createValuation`; validates address/area with the same rules
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

  try {
    const proposal = await sampleProposal.fetchProposal(parsed.data.address, parsed.data.area);
    return { proposal };
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    if (message && !message.startsWith(WORKER_RESPONDED_PREFIX)) {
      return { error: message };
    }
    return { error: GENERIC_ERROR };
  }
}
