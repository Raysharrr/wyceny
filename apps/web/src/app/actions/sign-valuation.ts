"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository, profileRepository } from "@/app/valuations/_deps";
import { NotSignableError } from "@/domain/valuation";
import { UnsignableDocxError, signOperatDocx } from "@/adapters/docx-render";
import { StorageNotFoundError } from "@/ports/storage";
import { approvedOperatKeys } from "@/lib/operat-doc-keys";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";

export type SignValuationResult = { error: string } | undefined;

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * Legacy refusal (ADR-020, spec §9.1): an operat approved before the signature
 * marker existed cannot take a signature; the way out is to reopen and approve
 * again. Wording proposed in the PR, pending the user's acceptance.
 */
const APPROVED_BEFORE_UPDATE =
  "Tego operatu nie można podpisać — zatwierdzono go przed aktualizacją programu. Użyj „Cofnij zatwierdzenie i popraw”, popraw operat i zatwierdź go ponownie.";

/**
 * Sign = the owner's scan on the STORED approved DOCX + irreversible status
 * flip (F-7, ADR-020 wariant a). Nothing is re-rendered: no template, no
 * document model, no maps or photos — the signed text is the approved text by
 * construction (I-21, docx-render-signature.test.ts). Mirrors
 * approve-valuation.ts: files stored first, the flip (CAS on 'approved' +
 * audit row with SHA-256 hashes, in one transaction) happens last; a failed
 * flip leaves orphan -signed files the retry overwrites.
 */
export async function signValuationAction(id: string): Promise<SignValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    const valuation = await valuationRepository.get(id, session.user);
    if (!valuation) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
    // `get` lets an admin see any owner's valuation (F-8), but only the owner
    // may sign (spec decision #5) — an admin must be refused here, before the
    // owner's signature scan is read or any -signed file is written.
    if (valuation.ownerId !== session.user.id) {
      return { error: "Tylko właściciel wyceny może ją podpisać." };
    }
    if (valuation.status === "signed") {
      return { error: "Wycena jest już podpisana." };
    }
    if (valuation.status !== "approved") {
      return { error: "Podpisać można tylko zatwierdzoną wycenę." };
    }
    if (!valuation.inputs || !valuation.docxUrl || !valuation.approvedAt) {
      return { error: "Wyceny starego typu nie można podpisać — utwórz ją ponownie." };
    }

    const signature = await profileRepository.getSignature(session.user.id);
    if (!signature) {
      return { error: "Brak skanu podpisu — wgraj go w profilu, a potem podpisz operat." };
    }

    // ADR-020 cz. 1 (I-18) — the signed document names the person signing it —
    // is satisfied WITHOUT a profile read here. Under cz. 2 wariant (a) signing
    // renders nothing, so there is no author block to fill: the one in the file
    // was written at approval, from the owner's profile, and only the owner may
    // sign. A read here would have nowhere to go, and re-rendering to use it is
    // exactly what this variant removes. The #57 test that pinned the read says
    // the same thing in its own comment.

    try {
      let approvedDocx: Buffer;
      try {
        approvedDocx = await storage.get(approvedOperatKeys(id, valuation.approvedAt).docx);
      } catch (error) {
        if (error instanceof StorageNotFoundError) {
          return { error: APPROVED_BEFORE_UPDATE };
        }
        // Anything else is storage being unavailable, not an old operat — the
        // appraiser must not be sent to reopen a valuation that is fine.
        await recordFailure({
          event: "signValuationAction.approvedDocxReadFailed",
          valuationId: id,
          actorId: session.user.id,
          error,
        });
        return {
          error: errorWithCode("Nie udało się odczytać zatwierdzonego operatu — spróbuj ponownie."),
        };
      }
      let docx: Buffer;
      try {
        docx = signOperatDocx(approvedDocx, signature.bytes);
      } catch (error) {
        if (error instanceof UnsignableDocxError) {
          return { error: APPROVED_BEFORE_UPDATE };
        }
        throw error;
      }
      const pdf = await worker.convertToPdf(docx);
      const docxUrl = await storage.put(`operat-${id}-signed.docx`, docx);
      const docUrl = await storage.put(`operat-${id}-signed.pdf`, pdf);

      const updated = await valuationRepository.sign(id, session.user, {
        docUrl,
        docxUrl,
        sha256Docx: sha256(docx),
        sha256Pdf: sha256(pdf),
      });
      if (!updated) {
        return { error: "Nie udało się podpisać wyceny — spróbuj ponownie." };
      }
    } catch (error) {
      if (error instanceof NotSignableError) {
        return { error: "Podpisać można tylko zatwierdzoną wycenę." };
      }
      await recordFailure({
        event: "signValuationAction.failed",
        valuationId: id,
        actorId: session.user.id,
        error: error,
      });
      return {
        error: errorWithCode(
          "Nie udało się wygenerować podpisanego operatu — worker lub magazyn dokumentów są niedostępne. Spróbuj ponownie.",
        ),
      };
    }

    revalidatePath(`/valuations/${id}`);
    revalidatePath("/valuations");
  });
}
