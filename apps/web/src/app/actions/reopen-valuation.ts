"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { NotReopenableError } from "@/domain/valuation";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";

export type ReopenValuationResult = { error: string } | undefined;

/**
 * „Cofnij zatwierdzenie i popraw” (ADR-020 reguła 6, spec §3 P9): an approved
 * operat nobody has signed goes back to editing, and the documents it already
 * issued stay in storage under the keys the `reopened` audit row names.
 *
 * Unlike `createNewVersionAction` this creates nothing and navigates nowhere:
 * the same valuation reopens in place, so the caller stays where it was and
 * only the cached view of it is refreshed.
 */
export async function reopenValuationAction(id: string): Promise<ReopenValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    try {
      const reopened = await valuationRepository.reopen(id, session.user);
      if (!reopened) {
        return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
      }
    } catch (error) {
      // Only the status refusal gets the status message. Anything else — a
      // dead connection, a failed audit insert — must not tell the appraiser
      // their operat is signed when it is not (contrast with the blanket
      // `catch` in create-new-version.ts).
      if (!(error instanceof NotReopenableError)) {
        await recordFailure({
          event: "reopenValuationAction.failed",
          valuationId: id,
          actorId: session.user.id,
          error,
        });
        return {
          error: errorWithCode("Nie udało się cofnąć zatwierdzenia — spróbuj ponownie."),
        };
      }
      return {
        error: "Cofnąć zatwierdzenie można tylko w operacie zatwierdzonym i jeszcze niepodpisanym.",
      };
    }

    // The flat view and the wizard both render this valuation's status, and
    // the list shows it too — all of them are now stale.
    revalidatePath(`/valuations/${id}`);
    revalidatePath("/valuations");
    return undefined;
  });
}
