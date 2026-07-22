"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, valuationRepository } from "@/app/valuations/_deps";
import { InspectionLimitError } from "@/domain/valuation";
import {
  MAX_INSPECTION_PHOTOS,
  buildPhotoKey,
  isOwnPhotoKey,
  type InspectionSection,
  INSPECTION_SECTIONS,
} from "@/domain/inspection";
import { hasApp1, isJpeg, jpegDimensions } from "@/lib/jpeg";

/** Processed-photo hard ceiling: worker emits ~150-250 KB at 1200 px q85. */
const MAX_PROCESSED_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_CHARS = 5000;
const MAX_DIM = 1200;

export type UploadInspectionPhotoResult = { key: string } | { error: string };

/**
 * TRUST BOUNDARY (spec §Bezpieczeństwo): unlike maps (server-fetched), these
 * bytes come from the CLIENT — a tampered client could bypass the worker and
 * post an unprocessed photo with GPS EXIF straight into a legal document.
 * Every guarantee is therefore re-checked here on raw bytes: JPEG magic,
 * APP1/Exif absence (the RODO guarantee), size and dimensions.
 */
export async function uploadInspectionPhoto(
  valuationId: string,
  section: InspectionSection,
  form: FormData,
): Promise<UploadInspectionPhotoResult> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!INSPECTION_SECTIONS.includes(section)) {
    return { error: "Nieznana sekcja zdjęć." };
  }
  const photo = form.get("photo");
  if (!(photo instanceof Blob)) {
    return { error: "Brak pliku zdjęcia." };
  }
  const bytes = Buffer.from(await photo.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PROCESSED_BYTES) {
    return { error: "Nieprawidłowy plik zdjęcia." };
  }
  const dims = jpegDimensions(bytes);
  if (!isJpeg(bytes) || hasApp1(bytes) || !dims || Math.max(dims.width, dims.height) > MAX_DIM) {
    return { error: "Nieprawidłowy plik zdjęcia." };
  }

  const key = buildPhotoKey(section, randomUUID(), valuationId);
  try {
    await storage.put(key, bytes);
    const updated = await valuationRepository.updateInspection(valuationId, session.user, {
      kind: "add_photo",
      section,
      key,
    });
    if (!updated) {
      await storage.delete(key); // compensation — no manifest entry, no orphan bytes
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    if (error instanceof InspectionLimitError) {
      return { error: `Limit ${MAX_INSPECTION_PHOTOS} zdjęć na wycenę został osiągnięty.` };
    }
    console.error("uploadInspectionPhoto failed", error);
    return { error: "Nie udało się zapisać zdjęcia — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
  return { key };
}

export async function removeInspectionPhoto(
  valuationId: string,
  section: InspectionSection,
  key: string,
): Promise<{ error: string } | undefined> {
  const session = await getSession();
  if (!session) redirect("/login");
  try {
    const updated = await valuationRepository.updateInspection(valuationId, session.user, {
      kind: "remove_photo",
      section,
      key,
    });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
    // Manifest first, bytes second: a failed delete leaves an unreferenced
    // row (harmless), the reverse would leave a manifest key with no bytes
    // (sign would abort). Inherited keys (versioning) are NEVER deleted —
    // they belong to the superseded valuation's frozen history.
    if (isOwnPhotoKey(key, valuationId)) {
      await storage.delete(key);
    }
  } catch (error) {
    console.error("removeInspectionPhoto failed", error);
    return { error: "Nie udało się usunąć zdjęcia — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
}

export async function saveInspectionNote(
  valuationId: string,
  note: string,
): Promise<{ error: string } | undefined> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (note.length > MAX_NOTE_CHARS) {
    return { error: `Notatka może mieć najwyżej ${MAX_NOTE_CHARS} znaków.` };
  }
  try {
    const updated = await valuationRepository.updateInspection(valuationId, session.user, {
      kind: "set_note",
      note,
    });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("saveInspectionNote failed", error);
    return { error: "Nie udało się zapisać notatki — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
}
