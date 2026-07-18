"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

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

  try {
    const updated = await valuationRepository.confirmKw(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("confirmKw failed", error);
    return { error: "Nie udało się potwierdzić danych KW — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
}
