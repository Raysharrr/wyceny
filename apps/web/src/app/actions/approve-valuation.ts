"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository, mapImages } from "@/app/valuations/_deps";
import {
  ApprovalBlockedError,
  InputsChangedError,
  mapsFrozenForCurrentAddress,
} from "@/domain/valuation";
import { approvalGate, type Blocker } from "@/domain/provenance";
import { proseEnabled } from "@/lib/prose-enabled";
import {
  buildDocumentModel,
  documentFieldBlockers,
  type OperatPurpose,
} from "@/domain/document-model";
import { computeKcs } from "@/domain/kcs";
import { currentSectionFactsHashes } from "@/domain/prose-hash";
import { renderOperatDocx, type RenderMaps, type RenderPhotos } from "@/adapters/docx-render";
import { loadInspectionPhotos } from "@/lib/load-inspection-photos";
import { previewDocKey } from "@/lib/preview-doc";
import { dropMapBytesIfStillOurDraft, frozenMapKeys, readFrozenMaps } from "@/lib/frozen-maps";

export type ApproveValuationResult =
  | {
      error: string;
      mapsUnavailable?: boolean;
      /**
       * EVERY blocker the refusal rests on, not only the one `error` names
       * (T8, carried from the Task 4 review). The caller renders them as a
       * list with a link per step: once each blocker points at a different
       * screen, surfacing one at a time would make the appraiser discover the
       * second problem only after fixing the first and coming back.
       *
       * Absent on refusals that are not gate refusals (a draft with no inputs
       * snapshot, a maps failure, a drift retry) — the renderer must treat it
       * as optional.
       */
      blockers?: Blocker[];
    }
  | undefined;

/**
 * Approve = F-4 gate + document generation, synchronously (spec §3).
 * Invariant: approved ⇔ operat exists. Files are stored FIRST, the status
 * flip (which re-runs the gate atomically, ADR-012) happens LAST — a failed
 * flip leaves harmless orphan files that the retry overwrites (same keys).
 *
 * Slice 14 (Task 12): the §8.1 WMS maps are REUSED from the freeze the
 * step-7 preview made, and fetched only when there is nothing to reuse
 * (spec §C). `opts.skipMaps` is the appraiser's conscious "without maps",
 * now made on the preview and carried here by the screen that made it —
 * audited on the approved row's meta. `mapImages === null` (MAPS_FETCH=off
 * kill switch, CI e2e) silently renders the honest "no maps" stub instead
 * and is NOT audited as a skip.
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

  // FR-6: whether the operat's descriptive sections are part of the F-4
  // invariant is a deployment decision (the NEXT_PUBLIC_PROSE kill switch),
  // so the APP layer resolves it and hands the answer to the gate — both
  // here and, through the repo, inside the write transaction (ADR-012).
  // `domain/` reads no env (F-10). Unset means enabled, like every other
  // NEXT_PUBLIC_* switch in this app.
  const requireProse = proseEnabled();

  // Fail fast with the first blocker before any expensive generation work.
  if (valuation.inputs) {
    const gate = approvalGate(valuation.inputs, {
      requireProse,
      // Lets the gate see the sections whose facts have since moved on (T6
      // review, I-2; per section since T4). Derived here, never taken from
      // the client.
      currentSectionHashes: requireProse
        ? currentSectionFactsHashes({ address: valuation.address, inputs: valuation.inputs })
        : undefined,
    });
    const blockers = [...(gate.ok ? [] : gate.blockers), ...documentFieldBlockers(valuation)];
    if (blockers.length > 0) {
      // `error` stays the one-line summary it has always been; `blockers`
      // carries the rest, so the action bar can show them all with their steps.
      return { error: `Zatwierdzenie zablokowane — ${blockers[0].label}`, blockers };
    }
  }

  try {
    if (!valuation.inputs) {
      return { error: "Zatwierdzenie zablokowane — brak danych wejściowych operatu." };
    }
    const now = new Date();
    const kcs = computeKcs(valuation.inputs);
    const amountInWords = await worker.amountInWords(kcs.wr);

    // Slice 14 (Task 12): issuing REUSES the maps the appraiser just read.
    // They are fetched and frozen by the step-7 preview, and the issue reads
    // them back — so the document under the signature is the document that
    // was on the screen, in the one part of the operat that comes from
    // outside this application.
    //
    // The fetch is still here, and it is load-bearing rather than vestigial:
    // the issue button sits on the same screen as the preview, so it can be
    // clicked before the render that freezes them has finished, and a marker
    // can outlive its bytes. Both cases mean "nothing to reuse", and the
    // answer is to fetch — never to issue without maps, because map absence
    // is never silent (Slice 9, spec decision 4).
    //
    // The maps and the address they depict travel together, so that no path
    // can record one without the other: the audit row is the only lasting
    // evidence of which parcel the images inside the issued document show.
    //
    // mapImages === null -> MAPS_FETCH=off (CI e2e): silent stub, NOT audited
    // as a skip — only the user's conscious "without maps" is.
    let embedded: { maps: RenderMaps; address: string } | null = null;
    if (!opts?.skipMaps && mapImages) {
      if (mapsFrozenForCurrentAddress(valuation) && valuation.mapsFrozenFor) {
        const frozenMaps = await readFrozenMaps(storage, id, "approveValuation");
        // The address comes off the MARKER, not the row. They are equal here
        // by construction — that is what `mapsFrozenForCurrentAddress`
        // compares — and taking it from the marker anyway is what keeps the
        // claim and its evidence in one place: the row says which parcel the
        // valuation is about, the marker says which parcel these bytes show.
        if (frozenMaps) embedded = { maps: frozenMaps, address: valuation.mapsFrozenFor };
      }
      if (!embedded) {
        const mapsResult = await mapImages.fetchMaps(valuation.address);
        if (mapsResult.kind !== "ok") {
          return {
            error: `Nie udało się pobrać map do operatu — ${mapsResult.message}`,
            mapsUnavailable: true,
          };
        }
        embedded = { maps: mapsResult.maps, address: valuation.address };
        const keys = frozenMapKeys(id);
        await storage.put(keys.ewidencyjna, embedded.maps.ewidencyjna);
        await storage.put(keys.orto, embedded.maps.orto);
        // Slice 14: the marker moves WITH the bytes — bytes first, marker
        // second, the order the preview freezes in. Writing one without the
        // other needs no concurrency to go wrong: preview at address A,
        // correct it to B, this fetch stores B's maps and then the issue
        // fails (photos, conversion, the drift check), revert to A — and a
        // marker still saying A hands the next reader B's parcel under A's
        // address.
        const frozen = await valuationRepository.freezeMaps(id, session.user, valuation.address);
        if (!frozen) {
          // The write did NOT happen, and `null` does not say why. Whether
          // these bytes are ours to delete is decided by a fresh read
          // (`dropMapBytesIfStillOurDraft`) — the loser of two concurrent
          // approves would otherwise delete the WINNER's frozen bytes, and
          // the winner's signature would go on a document without the §8.1
          // maps its approved copy carries.
          //
          // The refusal, on the other hand, is unconditional. Whatever those
          // keys hold, this issue cannot vouch for it, and nothing has been
          // committed yet — so refusing costs a retry and no more. A `null`
          // here also means `repo.approve` was going to fail anyway, for the
          // same two reasons.
          console.error(`approveValuation: could not record the map freeze on ${id} — refusing`);
          await dropMapBytesIfStillOurDraft(
            { storage, valuationRepository },
            id,
            session.user,
            "approveValuation",
          );
          // The message promises no retry: `freezeMaps` returns null when the
          // row is gone, when the caller is not its owner, or when it is no
          // longer a draft — and none of those clears by trying again.
          return {
            error:
              "Nie udało się zapisać stanu map operatu. Sprawdź, czy wycena jest nadal Twoim szkicem.",
          };
        }
      }
    }
    const maps = embedded?.maps ?? null;

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
    // Keyed on "nothing embedded", never on "did not fetch". Today the two
    // coincide — every branch that produces maps sets `embedded` — but only
    // the first stays correct if a third way of obtaining them is ever added,
    // and the failure it guards against is not recoverable: this arm reached
    // after a REUSE would delete the very bytes the document was rendered
    // from, and `signValuationAction` re-renders from those keys and reads
    // their absence as "approved without maps", silently. The office would
    // then hold an illustrated operat and send out an unillustrated signed
    // one. (Pinned by "reuse touches neither the bytes nor the marker";
    // verified by mutating this condition to fire on the reuse path.)
    //
    // A PRIOR failed approve attempt (e.g. a PDF conversion crash) may have
    // left these keys behind; uncleaned, sign would find and embed maps this
    // approved document does not have. delete() is idempotent, so this is a
    // no-op on the common case where nothing was ever orphaned.
    if (!embedded) {
      const keys = frozenMapKeys(id);
      await storage.delete(keys.ewidencyjna);
      await storage.delete(keys.orto);
      // ...and the freeze marker with them, while this is still a draft
      // (`freezeMaps` refuses anything else). A marker left standing over
      // deleted bytes would tell the next reader — the step-7 preview, and
      // now the issue itself — that this valuation has maps frozen for its
      // address when it has none.
      await valuationRepository.freezeMaps(id, session.user, null);
    }

    // Slice 10 (Task 8): the photo manifest lives in inputs.inspection —
    // unlike maps, a manifest key that fails to resolve is a HARD integrity
    // error (manifest + bytes are written in the same tx) and aborts the
    // approve before repo.approve is ever called.
    let photos: RenderPhotos | null = null;
    try {
      photos = await loadInspectionPhotos(storage, valuation.inputs.inspection);
    } catch (error) {
      console.error("approveValuation: reading inspection photos failed", error);
      return {
        error: "Nie udało się odczytać zdjęć z oględzin — odśwież stronę i spróbuj ponownie.",
      };
    }
    const docx = renderOperatDocx(model, { maps, photos });
    const pdf = await worker.convertToPdf(docx);
    const docxUrl = await storage.put(`operat-${id}.docx`, docx);
    const docUrl = await storage.put(`operat-${id}.pdf`, pdf);

    const updated = await valuationRepository.approve(
      id,
      session.user,
      { docUrl, docxUrl },
      now,
      // One of the two, never both: the appraiser's conscious "without maps",
      // or — when maps ARE embedded — the address they were fetched for
      // (Slice 14). Neither when the kill switch left this document mapless
      // without anyone choosing it.
      opts?.skipMaps
        ? { mapsSkipped: true }
        : embedded
          ? { mapsFrozenFor: embedded.address }
          : undefined,
      valuation.inputs,
      { requireProse },
    );
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }

    // Slice 14: the preview is now spent — from here on the issued operat is
    // the document that counts, and two PDFs differing only by their date
    // are an invitation to send the wrong one.
    //
    // AFTER the commit, and in its own try/catch, for two reasons. The
    // storage adapter holds its own db handle and `PortStorage` has no
    // transaction-aware call, so this could not have joined `repo.approve`'s
    // transaction even if we wanted it to. And it must not be able to fail
    // the action: the status flip is already committed, so an error here
    // would send the appraiser back to re-approve an operat that has been
    // issued — an orphan blob is by far the lesser problem, and the next
    // render of this key overwrites it anyway.
    try {
      await storage.delete(previewDocKey(id));
    } catch (error) {
      console.error("approveValuation: dropping the preview blob failed (approval stands)", error);
    }
  } catch (error) {
    if (error instanceof InputsChangedError) {
      return {
        error:
          "Dane wyceny zmieniły się w trakcie zatwierdzania — odśwież stronę i spróbuj ponownie.",
      };
    }
    if (error instanceof ApprovalBlockedError) {
      return {
        error: `Zatwierdzenie zablokowane — ${error.blockers[0]?.label ?? "operat zawiera niezweryfikowane wartości."}`,
        blockers: error.blockers,
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
