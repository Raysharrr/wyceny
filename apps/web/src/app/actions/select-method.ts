"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { methodSelectionSchema } from "./wizard-schemas";
import type { MethodSelection } from "@/domain/valuation";
import { recordFailure } from "./_record-failure";

export async function selectMethodAction(
  id: string,
  input: MethodSelection,
): Promise<{ ok: true } | { error: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  const parsed = methodSelectionSchema.safeParse(input);
  if (!parsed.success) return { error: "Wybierz i potwierdź metodę wyceny." };
  try {
    const updated = await valuationRepository.selectMethod(id, session.user, parsed.data);
    if (!updated) return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
  } catch (error) {
    await recordFailure({
      event: "selectMethodAction.failed",
      valuationId: id,
      actorId: session.user.id,
      error,
    });
    return { error: "Nie udało się zapisać metody. Odśwież wycenę i spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${id}`);
  return { ok: true };
}
