"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

export type ConfirmSampleResult = { error: string } | undefined;

/**
 * Bulk-confirm (spec §5): flips the draft's rcn rows + geocode to confirmed.
 * Owner-only; the repo returns null for not-found/not-owner and throws for
 * non-draft status.
 */
export async function confirmSample(id: string): Promise<ConfirmSampleResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.confirmSample(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("confirmSample failed", error);
    return { error: "Nie udało się potwierdzić próby — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
}
