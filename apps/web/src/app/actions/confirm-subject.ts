"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

export type ConfirmSubjectResult = { error: string } | undefined;

/**
 * Bulk-confirm the subject snapshot (mirrors `confirmSample`, F-5/spec §5):
 * flips the draft's ewidencja/mpzp provenance groups to confirmed.
 * Owner-only; the repo returns null for not-found/not-owner and throws for
 * non-draft status.
 */
export async function confirmSubject(id: string): Promise<ConfirmSubjectResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.confirmSubject(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("confirmSubject failed", error);
    return { error: "Nie udało się potwierdzić danych przedmiotu — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
}
