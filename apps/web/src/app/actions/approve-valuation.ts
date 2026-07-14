"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { ApprovalBlockedError } from "@/domain/valuation";

export type ApproveValuationResult = { error: string } | undefined;

/**
 * Approve (spec §5): re-runs the F-4 gate SERVER-SIDE inside the repo/domain
 * (ADR-012 — invariant, not UI). A client that enables the button via
 * devtools still bounces here.
 */
export async function approveValuation(id: string): Promise<ApproveValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.approve(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    if (error instanceof ApprovalBlockedError) {
      return {
        error: `Zatwierdzenie zablokowane — ${error.blockers[0]?.label ?? "operat zawiera niezweryfikowane wartości."}`,
      };
    }
    console.error("approveValuation failed", error);
    return { error: "Nie udało się zatwierdzić operatu — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
  revalidatePath("/valuations");
}
