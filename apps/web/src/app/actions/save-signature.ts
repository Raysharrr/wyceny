"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { profileRepository } from "@/app/valuations/_deps";

export type SaveSignatureResult = { error: string } | undefined;

const MAX_BYTES = 1_000_000;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg"]);

/** Uploads the appraiser's signature scan (RODO: stored ONLY in Postgres,
 * never on disk / in the repo). Own profile only — the session user is the
 * only writable target. */
export async function saveSignature(formData: FormData): Promise<SaveSignatureResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Wybierz plik ze skanem podpisu (PNG lub JPEG)." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { error: "Dozwolone formaty: PNG lub JPEG." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "Plik jest za duży — maksymalnie 1 MB." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  await profileRepository.saveSignature(session.user.id, bytes, file.type);
  revalidatePath("/profile");
}
