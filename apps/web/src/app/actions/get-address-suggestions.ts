"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/auth/session";
import { addressSuggest } from "@/app/valuations/_deps";
import { recordEvent, recordFailure } from "@/app/actions/_record-failure";
import { currentTraceId, withTrace } from "@/lib/trace";
import type { AddressSuggestion } from "@/ports/address-suggest";

// Min 3 mirrors the combobox's own gate; max 200 matches the form's address
// field ceiling. Anything outside is silently "no suggestions" — this action
// backs keystroke-driven UI, it must never surface a validation error.
const inputSchema = z.object({ query: z.string().trim().min(3).max(200) });

export type GetAddressSuggestionsResult = { suggestions: AddressSuggestion[] };

/**
 * Server Action backing the step-1 address combobox. Session-gated like the
 * other proposal actions; delegates to {@link addressSuggest} (worker
 * `/address-suggest` → UUG). Total on purpose — every failure is an empty
 * list, because suggestions are an enhancement and must never break typing.
 *
 * F-13: the typed query is deliberately absent from every log call — only
 * the suggestion count is recorded.
 */
export async function getAddressSuggestions(input: {
  query: string;
}): Promise<GetAddressSuggestionsResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { suggestions: [] };
  }

  return withTrace(async () => {
    try {
      const suggestions = await addressSuggest.suggest(parsed.data.query);
      await recordEvent({
        level: "info",
        event: "proposal.addressSuggest",
        traceId: currentTraceId(),
        actorId: session.user.id,
        meta: { count: suggestions.length },
      });
      return { suggestions };
    } catch (error) {
      await recordFailure({
        event: "getAddressSuggestions.failed",
        error,
        actorId: session.user.id,
      });
      return { suggestions: [] };
    }
  });
}
