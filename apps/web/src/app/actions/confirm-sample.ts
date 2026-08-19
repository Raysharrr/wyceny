"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";

export type ConfirmSampleResult = { error: string } | undefined;

/**
 * Bulk-confirm (spec §5): flips the draft's rcn rows to confirmed. Geocoding
 * left the sample group in T7 — `confirmSubject` owns it now.
 * Owner-only; the repo returns null for not-found/not-owner and throws for
 * non-draft status.
 */
export async function confirmSample(id: string): Promise<ConfirmSampleResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // The session guard stays OUTSIDE the traced block, here and in every
  // other action: Next implements `redirect()` by throwing, and that
  // control-flow throw has no business travelling through a scope whose
  // whole job is to record failures.
  return withTrace(async () => {
    try {
      const updated = await valuationRepository.confirmSample(id, session.user);
      if (!updated) {
        return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
      }
    } catch (error) {
      await recordFailure({
        event: "confirmSample.failed",
        valuationId: id,
        actorId: session.user.id,
        error: error,
      });
      return { error: errorWithCode("Nie udało się potwierdzić próby — spróbuj ponownie.") };
    }

    revalidatePath(`/valuations/${id}`);
  });
}
