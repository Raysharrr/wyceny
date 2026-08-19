"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { errFields, log } from "@/lib/log";
import { errorWithCode, withTrace } from "@/lib/trace";

export type ConfirmSubjectResult = { error: string } | undefined;

/**
 * Bulk-confirm the subject snapshot (mirrors `confirmSample`, F-5/spec §5):
 * flips the draft's ewidencja/mpzp groups — and, since T7, the address's
 * geocoding — to confirmed.
 * Owner-only; the repo returns null for not-found/not-owner and throws for
 * non-draft status.
 */
export async function confirmSubject(id: string): Promise<ConfirmSubjectResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    try {
      const updated = await valuationRepository.confirmSubject(id, session.user);
      if (!updated) {
        return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
      }
    } catch (error) {
      log.error({
        event: "confirmSubject.failed",
        valuationId: id,
        actorId: session.user.id,
        ...errFields(error),
      });
      return {
        error: errorWithCode("Nie udało się potwierdzić danych przedmiotu — spróbuj ponownie."),
      };
    }

    revalidatePath(`/valuations/${id}`);
  });
}
