"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository, profileRepository } from "@/app/valuations/_deps";
import { NotSignableError } from "@/domain/valuation";
import { buildDocumentModel, type OperatPurpose } from "@/domain/document-model";
import { computeKcs } from "@/domain/kcs";
import { renderOperatDocx } from "@/adapters/docx-render";

export type SignValuationResult = { error: string } | undefined;

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * Sign = final re-render of the FROZEN inputs with the owner's signature
 * scan + irreversible status flip (F-7). Mirrors approve-valuation.ts:
 * files stored first, the flip (CAS on 'approved' + audit row with SHA-256
 * hashes, in one transaction) happens last; a failed flip leaves orphan
 * -signed files the retry overwrites. data_sporzadzenia derives from the
 * persisted approvedAt, so the signed text is identical to the approved one
 * (drift guard test in docx-render-signature.test.ts).
 */
export async function signValuationAction(id: string): Promise<SignValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const valuation = await valuationRepository.get(id, session.user);
  if (!valuation) {
    return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
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

  try {
    const kcs = computeKcs(valuation.inputs);
    const amountInWords = await worker.amountInWords(kcs.wr);
    const model = buildDocumentModel({
      address: valuation.address,
      area: valuation.area,
      purpose: valuation.purpose as OperatPurpose,
      kwNumber: valuation.kwNumber ?? "",
      client: valuation.client ?? "",
      inspectionDate: valuation.inspectionDate ?? "",
      approvedAt: valuation.approvedAt,
      inputs: valuation.inputs,
      kcs,
      amountInWords,
    });
    const docx = renderOperatDocx(model, { signature: signature.bytes });
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
    console.error("signValuationAction failed", error);
    return {
      error:
        "Nie udało się wygenerować podpisanego operatu — worker lub magazyn dokumentów są niedostępne. Spróbuj ponownie.",
    };
  }

  revalidatePath(`/valuations/${id}`);
  revalidatePath("/valuations");
}
