"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository, mapImages } from "@/app/valuations/_deps";
import { ApprovalBlockedError } from "@/domain/valuation";
import { approvalGate } from "@/domain/provenance";
import {
  buildDocumentModel,
  documentFieldBlockers,
  type OperatPurpose,
} from "@/domain/document-model";
import { computeKcs } from "@/domain/kcs";
import { renderOperatDocx, type RenderMaps } from "@/adapters/docx-render";

export type ApproveValuationResult = { error: string; mapsUnavailable?: boolean } | undefined;

/**
 * Approve = F-4 gate + document generation, synchronously (spec §3).
 * Invariant: approved ⇔ operat exists. Files are stored FIRST, the status
 * flip (which re-runs the gate atomically, ADR-012) happens LAST — a failed
 * flip leaves harmless orphan files that the retry overwrites (same keys).
 *
 * Slice 9 (Task 6): also fetches + freezes the §8.1 WMS maps at the approve
 * moment (spec decision 1). `opts.skipMaps` is the user's conscious "approve
 * without maps" choice — audited on the approved row's meta. `mapImages ===
 * null` (MAPS_FETCH=off kill switch, CI e2e) silently renders the honest
 * "no maps" stub instead and is NOT audited as a skip.
 */
export async function approveValuation(
  id: string,
  opts?: { skipMaps?: boolean },
): Promise<ApproveValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const valuation = await valuationRepository.get(id, session.user);
  if (!valuation) {
    return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
  }

  // Status guard BEFORE any generation work: re-invoking approve on an
  // already-approved valuation must not regenerate (= overwrite) the stored
  // operat files — they are a frozen artifact. Without this, the overwrite
  // would happen and only then `assertDraft` inside repo.approve would fail.
  if (valuation.status !== "in_progress") {
    return { error: "Wycena jest już zatwierdzona." };
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
    const now = new Date();
    const kcs = computeKcs(valuation.inputs);
    const amountInWords = await worker.amountInWords(kcs.wr);

    // Slice 9: fetch + freeze maps at the approve moment (spec decision 1).
    // mapImages === null -> MAPS_FETCH=off (CI e2e): silent stub, NOT audited
    // as a skip — only the user's conscious "approve without maps" is.
    let maps: RenderMaps | null = null;
    if (!opts?.skipMaps && mapImages) {
      const mapsResult = await mapImages.fetchMaps(valuation.address);
      if (mapsResult.kind !== "ok") {
        return {
          error: `Nie udało się pobrać map do operatu — ${mapsResult.message}`,
          mapsUnavailable: true,
        };
      }
      maps = mapsResult.maps;
    }

    const model = buildDocumentModel({
      address: valuation.address,
      area: valuation.area,
      purpose: valuation.purpose as OperatPurpose,
      kwNumber: valuation.kwNumber ?? "",
      client: valuation.client ?? "",
      inspectionDate: valuation.inspectionDate ?? "",
      approvedAt: now,
      inputs: valuation.inputs,
      kcs,
      amountInWords,
    });
    if (maps) {
      await storage.put(`mapa-ewidencyjna-${id}.png`, maps.ewidencyjna);
      await storage.put(`mapa-orto-${id}.jpg`, maps.orto);
    } else {
      // skipMaps (user's conscious choice) or MAPS_FETCH=off kill switch:
      // approve proceeds with maps === null. A PRIOR failed approve attempt
      // (e.g. PDF conversion crash) may have already written these keys
      // before failing — left uncleaned, sign would find and embed maps this
      // approved document doesn't have (approve<->sign drift in a legal
      // document, final review Important #1). delete() is idempotent, so
      // this is a no-op on the common case where nothing was ever orphaned.
      await storage.delete(`mapa-ewidencyjna-${id}.png`);
      await storage.delete(`mapa-orto-${id}.jpg`);
    }
    const docx = renderOperatDocx(model, { maps });
    const pdf = await worker.convertToPdf(docx);
    const docxUrl = await storage.put(`operat-${id}.docx`, docx);
    const docUrl = await storage.put(`operat-${id}.pdf`, pdf);

    const updated = await valuationRepository.approve(
      id,
      session.user,
      { docUrl, docxUrl },
      now,
      opts?.skipMaps ? { mapsSkipped: true } : undefined,
    );
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
