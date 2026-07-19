"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

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

  try {
    const updated = await valuationRepository.confirmFeatures(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("confirmFeatures failed", error);
    return { error: "Nie udało się potwierdzić cech i wag — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
}
