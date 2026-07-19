"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

export type CreateNewVersionResult = { error: string } | undefined;

/** NFR-3: the ONLY way to "change" a signed valuation — a fresh linked
 * draft; the signed original stays frozen forever (DB trigger). */
export async function createNewVersionAction(id: string): Promise<CreateNewVersionResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  let newId: string;
  try {
    const draft = await valuationRepository.createNewVersion(id, session.user);
    if (!draft) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
    newId = draft.id;
  } catch {
    return { error: "Nową wersję można utworzyć tylko z podpisanego operatu." };
  }

  revalidatePath("/valuations");
  redirect(`/valuations/${newId}`);
}
