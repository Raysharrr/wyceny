"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { PROSE_SECTIONS, type ProseSection } from "@/domain/prose-snapshot";
import { errFields, log } from "@/lib/log";
import { errorWithCode, withTrace } from "@/lib/trace";

export type ConfirmProseResult = { error: string } | undefined;

const NOT_FOUND = "Nie znaleziono wyceny albo nie masz do niej dostępu.";
const GENERIC = "Nie udało się zapisać opisów — spróbuj ponownie.";

/**
 * The appraiser's step-6 submit (ADR-014, FR-6): every non-blank field becomes
 * `rzeczoznawca`/`confirmed`, a blank one leaves the section empty for T7's
 * gate to block. Sibling of `confirmSample`/`confirmFeatures` — the whole step
 * at once, because the appraiser takes responsibility for the operat's text
 * with one deliberate click.
 *
 * The payload crosses the network, so it is rebuilt here rather than trusted:
 * exactly the six known sections, each coerced to a string. ADR-010 — the
 * browser sends TEXT and never provenance; `confirmed` is assigned on this
 * side of the boundary or not at all.
 */
export async function confirmProse(
  id: string,
  texts: Partial<Record<ProseSection, string>>,
): Promise<ConfirmProseResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    const payload = Object.fromEntries(
      PROSE_SECTIONS.map((section) => {
        const value = texts?.[section];
        return [section, typeof value === "string" ? value : ""];
      }),
    ) as Record<ProseSection, string>;

    try {
      const updated = await valuationRepository.confirmProse(id, session.user, payload);
      if (!updated) return { error: NOT_FOUND };
    } catch (error) {
      log.error({
        event: "confirmProse.failed",
        valuationId: id,
        actorId: session.user.id,
        ...errFields(error),
      });
      return { error: errorWithCode(GENERIC) };
    }

    revalidatePath(`/valuations/${id}`);
  });
}
