"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository, mapImages } from "@/app/valuations/_deps";
import { mapsFrozenForCurrentAddress } from "@/domain/valuation";
import { buildDocumentModel, type OperatPurpose } from "@/domain/document-model";
import { computeKcs } from "@/domain/kcs";
import { renderOperatDocx, type RenderMaps, type RenderPhotos } from "@/adapters/docx-render";
import { loadInspectionPhotos } from "@/lib/load-inspection-photos";
import { previewDocKey } from "@/lib/preview-doc";

export type PreviewOperatResult =
  | { url: string }
  | {
      error: string;
      /** Same meaning as on approval: the WMS said no, so the caller may offer "podgląd bez map". */
      mapsUnavailable?: boolean;
    };

const ewidencyjnaKey = (id: string) => `mapa-ewidencyjna-${id}.png`;
const ortoKey = (id: string) => `mapa-orto-${id}.jpg`;

/**
 * Reads the frozen §8.1 maps back from storage, or `null` when they are not
 * there to read.
 *
 * ANY failure means "not frozen after all" here — deliberately unlike
 * `signValuationAction`, which treats everything but `StorageNotFoundError`
 * as a hard error. The two are protecting opposite things: a sign that
 * silently dropped maps would issue a signed document without them, whereas
 * a preview that fails to read them simply fetches them again. Falling back
 * to a fetch cannot lose maps; it can only cost seconds.
 */
async function readFrozenMaps(id: string): Promise<RenderMaps | null> {
  try {
    const ewidencyjna = await storage.get(ewidencyjnaKey(id));
    const orto = await storage.get(ortoKey(id));
    if (Buffer.isBuffer(ewidencyjna) && Buffer.isBuffer(orto)) {
      return { ewidencyjna, orto };
    }
  } catch (error) {
    console.error("previewOperat: reading frozen maps failed, re-fetching", error);
  }
  return null;
}

/**
 * Renders the operat the appraiser is about to take responsibility for, and
 * returns a URL the step-7 reader can embed (Slice 14, spec §C). The user's
 * original complaint was "I confirm things on step 7 that I cannot see" —
 * this is the seeing.
 *
 * Preview is NOT approval and deliberately runs NO F-4 gate: rendering a
 * draft that still has blockers is the whole point of the "Pokaż podgląd
 * mimo braków" path, and the appraiser learns more from an incomplete
 * document than from a list. Nothing here approves, and nothing writes
 * `docUrl`/`docxUrl` — those two columns mean *issued* (F-4). Nor does it
 * call the language model: it renders the prose already on the draft,
 * whatever state it is in.
 *
 * MAPS. The §8.1 maps are fetched at most once per address and frozen for
 * reuse — by the next preview and, from Task 12, by the issue itself. The
 * freeze remembers the ADDRESS it was made from, because maps are derived
 * from it (geocoder → parcel → bbox → WMS): without that, previewing,
 * correcting the address and issuing would put the PREVIOUS parcel's
 * cadastral map and orthophoto into a signed operat. Bytes are written
 * before the marker, for the same reason approve stores files before it
 * flips status: an orphaned byte pair is overwritten by the next render,
 * while a marker without bytes would be a claim that isn't true.
 *
 * `opts.skipMaps` is the appraiser's conscious "preview without maps" after
 * a WMS failure (the path that used to sit on approval, spec §C). It lifts
 * the freeze rather than ignoring it: a preview read without maps must not
 * be followed by an issue that silently embeds some.
 */
export async function previewOperat(
  id: string,
  opts?: { skipMaps?: boolean },
): Promise<PreviewOperatResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const valuation = await valuationRepository.get(id, session.user);
  if (!valuation) {
    return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
  }
  // Mirrors approve's fast status guard. An issued operat already has its own
  // document; re-rendering a preview beside it would produce a second file
  // differing only by its date — the confusion ruling 3 exists to prevent.
  if (valuation.status !== "in_progress") {
    return { error: "Wycena jest już zatwierdzona — otwórz wydany operat." };
  }
  if (!valuation.inputs) {
    return { error: "Brak danych wejściowych operatu — nie ma czego pokazać." };
  }

  try {
    let maps: RenderMaps | null = null;
    if (opts?.skipMaps) {
      // Marker FIRST here — the mirror image of the fetch path below, and for
      // the same reason. Lifting the freeze before dropping the bytes can only
      // leave a cleared marker over bytes that still exist, which costs one
      // re-fetch; the other order can leave bytes deleted under a marker that
      // still claims them, which is the lying-marker state this whole design
      // exists to prevent.
      await valuationRepository.freezeMaps(id, session.user, null);
      await storage.delete(ewidencyjnaKey(id));
      await storage.delete(ortoKey(id));
    } else {
      if (mapsFrozenForCurrentAddress(valuation)) {
        maps = await readFrozenMaps(id);
      }
      // `mapImages === null` is the MAPS_FETCH=off kill switch (CI e2e stays
      // network-free) — the preview then renders the same honest "no maps"
      // stub approval renders, and freezes nothing.
      if (!maps && mapImages) {
        const fetched = await mapImages.fetchMaps(valuation.address);
        if (fetched.kind !== "ok") {
          return {
            error: `Nie udało się pobrać map do operatu — ${fetched.message}`,
            mapsUnavailable: true,
          };
        }
        maps = fetched.maps;
        await storage.put(ewidencyjnaKey(id), maps.ewidencyjna);
        await storage.put(ortoKey(id), maps.orto);
        await valuationRepository.freezeMaps(id, session.user, valuation.address);
      }
    }

    let photos: RenderPhotos | null = null;
    try {
      photos = await loadInspectionPhotos(storage, valuation.inputs.inspection);
    } catch (error) {
      console.error("previewOperat: reading inspection photos failed", error);
      return {
        error: "Nie udało się odczytać zdjęć z oględzin — odśwież stronę i spróbuj ponownie.",
      };
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
      // The preview's "data sporządzenia" is TODAY; the issued operat gets
      // the date it was issued. That difference is why issuing re-renders
      // rather than promoting this file (spec §C).
      approvedAt: new Date(),
      inputs: valuation.inputs,
      kcs,
      amountInWords,
    });
    const docx = renderOperatDocx(model, { maps, photos });
    const pdf = await worker.convertToPdf(docx);
    await storage.put(previewDocKey(id), pdf);

    // The blob key is stable, so the URL must carry what changed — without
    // this the appraiser fixes a fact, re-previews, and the reader re-serves
    // the render they were trying to replace. Content-derived rather than a
    // clock: an identical re-render is genuinely the same document.
    const version = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
    return { url: `/api/podglad/${id}?v=${version}` };
  } catch (error) {
    console.error("previewOperat failed", error);
    return {
      error: "Nie udało się złożyć podglądu operatu — sprawdź dane wyceny i spróbuj ponownie.",
    };
  }
}
