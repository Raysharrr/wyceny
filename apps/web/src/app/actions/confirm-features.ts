"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { errFields, log } from "@/lib/log";
import { errorWithCode, withTrace } from "@/lib/trace";

export type ConfirmFeaturesResult = { error: string } | undefined;

/**
 * Bulk-confirm the feature preset (mirrors confirmSample/confirmSubject/confirmKw):
 * flips the draft's weights + featureDefs provenance to confirmed.
 */
export async function confirmFeatures(id: string): Promise<ConfirmFeaturesResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    try {
      const updated = await valuationRepository.confirmFeatures(id, session.user);
      if (!updated) {
        return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
      }
    } catch (error) {
      log.error({
        event: "confirmFeatures.failed",
        valuationId: id,
        actorId: session.user.id,
        ...errFields(error),
      });
      return { error: errorWithCode("Nie udało się potwierdzić cech i wag — spróbuj ponownie.") };
    }

    revalidatePath(`/valuations/${id}`);
  });
}
