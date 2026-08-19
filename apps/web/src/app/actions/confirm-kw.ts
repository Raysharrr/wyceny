"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";

export type ConfirmKwResult = { error: string } | undefined;

/**
 * Bulk-confirm the KW extract (mirrors confirmSample/confirmSubject):
 * flips the draft's kw group — and document-sourced area — to confirmed.
 */
export async function confirmKw(id: string): Promise<ConfirmKwResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    try {
      const updated = await valuationRepository.confirmKw(id, session.user);
      if (!updated) {
        return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
      }
    } catch (error) {
      await recordFailure({
        event: "confirmKw.failed",
        valuationId: id,
        actorId: session.user.id,
        error: error,
      });
      return { error: errorWithCode("Nie udało się potwierdzić danych KW — spróbuj ponownie.") };
    }

    revalidatePath(`/valuations/${id}`);
  });
}
