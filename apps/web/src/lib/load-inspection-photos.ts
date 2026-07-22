import type { PortStorage } from "@/ports/storage";
import {
  INSPECTION_SECTIONS,
  totalInspectionPhotos,
  type InspectionSnapshot,
  type RenderPhotos,
} from "@/domain/inspection";

/**
 * Manifest -> frozen bytes. Photos differ from maps here: a manifest key
 * that fails to resolve is a HARD integrity error (the manifest is written
 * in the same tx as the bytes; maps could legally be absent via skipMaps).
 * Callers catch and refuse to approve/sign — never render a legal document
 * missing photos its inputs claim to have.
 */
export async function loadInspectionPhotos(
  storage: PortStorage,
  inspection: InspectionSnapshot | null | undefined,
): Promise<RenderPhotos | null> {
  if (!inspection || totalInspectionPhotos(inspection) === 0) return null;
  const photos = { otoczenie: [], budynekZewn: [], wnetrza: [] } as RenderPhotos;
  for (const section of INSPECTION_SECTIONS) {
    for (const key of inspection.photos[section]) {
      const bytes = await storage.get(key);
      if (!Buffer.isBuffer(bytes)) {
        throw new Error(`Inspection photo missing or unreadable: ${key}`);
      }
      photos[section].push(bytes);
    }
  }
  return photos;
}
