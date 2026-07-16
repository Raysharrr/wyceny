"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository } from "@/app/valuations/_deps";
import { ApprovalBlockedError } from "@/domain/valuation";
import { approvalGate } from "@/domain/provenance";
import {
  buildDocumentModel,
  documentFieldBlockers,
  type OperatPurpose,
} from "@/domain/document-model";
import { computeKcs } from "@/domain/kcs";
import { renderOperatDocx } from "@/adapters/docx-render";

export type ApproveValuationResult = { error: string } | undefined;

/**
 * Approve = F-4 gate + document generation, synchronously (spec §3).
 * Invariant: approved ⇔ operat exists. Files are stored FIRST, the status
 * flip (which re-runs the gate atomically, ADR-012) happens LAST — a failed
 * flip leaves harmless orphan files that the retry overwrites (same keys).
 */
export async function approveValuation(id: string): Promise<ApproveValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const valuation = await valuationRepository.get(id, session.user);
  if (!valuation) {
    return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
  }

  // Fail fast with the first blocker before any expensive generation work.
  if (valuation.inputs) {
    const gate = approvalGate(valuation.inputs);
    const blockers = [...(gate.ok ? [] : gate.blockers), ...documentFieldBlockers(valuation)];
    if (blockers.length > 0) {
      return { error: `Zatwierdzenie zablokowane — ${blockers[0].label}` };
    }
  }

  try {
    if (!valuation.inputs) {
      return { error: "Zatwierdzenie zablokowane — brak danych wejściowych operatu." };
    }
    const kcs = computeKcs(valuation.inputs);
    const amountInWords = await worker.amountInWords(kcs.wr);
    const model = buildDocumentModel({
      address: valuation.address,
      area: valuation.area,
      purpose: valuation.purpose as OperatPurpose,
      kwNumber: valuation.kwNumber ?? "",
      client: valuation.client ?? "",
      inspectionDate: valuation.inspectionDate ?? "",
      approvedAt: new Date(),
      inputs: valuation.inputs,
      kcs,
      amountInWords,
    });
    const docx = renderOperatDocx(model);
    const pdf = await worker.convertToPdf(docx);
    const docxUrl = await storage.put(`operat-${id}.docx`, docx);
    const docUrl = await storage.put(`operat-${id}.pdf`, pdf);

    const updated = await valuationRepository.approve(id, session.user, { docUrl, docxUrl });
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
    return {
      error:
        "Nie udało się wygenerować operatu — worker lub magazyn dokumentów są niedostępne. Spróbuj ponownie.",
    };
  }

  revalidatePath(`/valuations/${id}`);
  revalidatePath("/valuations");
}
