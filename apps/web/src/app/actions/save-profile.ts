"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { profileRepository, storage } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";
import { insurancePageKey, insurancePrefix } from "@/domain/insurance-doc";
import { StorageNotFoundError } from "@/ports/storage";

/**
 * The appraiser's own profile (ADR-020 cz. 1). Every action here writes the
 * SESSION user's row and nothing else — there is no writable target other than
 * yourself, so no id ever travels from the browser.
 *
 * F-13: nothing from the profile (name, licence number, policy) is written to
 * `event_log`; failures are recorded by event name only.
 */

/** Per-field errors keyed by form field name; `error` is the whole-form failure. */
export type SaveProfileResult =
  { fieldErrors?: Record<string, string>; error?: string } | undefined;

const MAX_FIELD = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The browser's `crypto.randomUUID()` — validated because it becomes a storage key. */
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PAGE_BYTES = 2_000_000;
/** These bytes end up full-page in the operat, so the type is checked twice —
 * the declared one (as `save-signature.ts` does) and the first three bytes,
 * which a caller cannot relabel. */
const PAGE_MIME = "image/jpeg";
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
/** Mirrors the worker's own MAX_PAGES — a page past it can only be a forged call. */
const MAX_PAGES = 10;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Author, licence number and office block — the three fields B-15 asks for. */
export async function saveAuthorProfile(formData: FormData): Promise<SaveProfileResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return withTrace(async () => {
    const fullName = text(formData, "fullName");
    const licenseNo = text(formData, "licenseNo");
    const officeBlock = text(formData, "officeBlock");

    const fieldErrors: Record<string, string> = {};
    if (!fullName) fieldErrors.fullName = "Podaj imię i nazwisko.";
    if (!licenseNo) fieldErrors.licenseNo = "Podaj numer uprawnień zawodowych.";
    if (!officeBlock) fieldErrors.officeBlock = "Podaj dane biura.";
    for (const [name, value] of Object.entries({ fullName, licenseNo, officeBlock })) {
      if (value.length > MAX_FIELD)
        fieldErrors[name] = `Za długi tekst — maksymalnie ${MAX_FIELD} znaków.`;
    }
    if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

    try {
      await profileRepository.saveAuthor(session.user.id, { fullName, licenseNo, officeBlock });
    } catch (error) {
      await recordFailure({ event: "saveAuthorProfile.failed", actorId: session.user.id, error });
      return { error: errorWithCode("Nie udało się zapisać profilu — spróbuj ponownie.") };
    }
    revalidatePath("/profile");
  });
}

/**
 * One rasterised page of the OC policy, stored under the upload's own prefix.
 *
 * Page by page rather than in one payload: ten A4 pages at 150 DPI exceed the
 * Server Action body limit together, and the browser already holds them
 * separately (`renderPdfPages`). Nothing is written to the profile here — the
 * row starts pointing at this prefix only once `finishInsuranceUpload` says
 * every page arrived, so a half-finished upload leaves the previous policy in
 * place instead of a truncated new one.
 */
export async function uploadInsurancePage(
  uploadId: string,
  pageIndex: number,
  formData: FormData,
): Promise<SaveProfileResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return withTrace(async () => {
    if (!UPLOAD_ID.test(uploadId)) return { error: "Nieprawidłowy identyfikator wgrywania." };
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= MAX_PAGES) {
      return { error: "Nieprawidłowy numer strony polisy." };
    }
    const page = formData.get("page");
    if (!(page instanceof File) || page.size === 0) {
      return { error: "Brak strony polisy do zapisania." };
    }
    if (page.size > MAX_PAGE_BYTES) {
      return { error: "Strona polisy jest za duża." };
    }
    if (page.type !== PAGE_MIME) {
      return { error: "Strona polisy musi być obrazem JPEG." };
    }
    try {
      const bytes = Buffer.from(await page.arrayBuffer());
      // The declared type is a claim by the caller; these three bytes are not.
      // Whatever lands here is printed full-page in somebody's operat, so it
      // has to really be the image the worker returned.
      if (!bytes.subarray(0, 3).equals(JPEG_MAGIC)) {
        return { error: "Strona polisy musi być obrazem JPEG." };
      }
      await storage.put(
        insurancePageKey(insurancePrefix(session.user.id, uploadId), pageIndex),
        bytes,
      );
    } catch (error) {
      await recordFailure({ event: "uploadInsurancePage.failed", actorId: session.user.id, error });
      return { error: errorWithCode("Nie udało się zapisać strony polisy — spróbuj ponownie.") };
    }
  });
}

/** Points the profile at the freshly uploaded pages and records the expiry date. */
export async function finishInsuranceUpload(
  uploadId: string,
  validUntil: string,
): Promise<SaveProfileResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return withTrace(async (): Promise<SaveProfileResult> => {
    if (!UPLOAD_ID.test(uploadId)) return { error: "Nieprawidłowy identyfikator wgrywania." };
    if (!ISO_DATE.test(validUntil)) {
      return { fieldErrors: { insuranceValidUntil: "Podaj datę ważności polisy." } };
    }
    const docKey = insurancePrefix(session.user.id, uploadId);
    // B-16 only asks whether the column is non-empty, so a key pointing at
    // nothing would degrade the gate to "a string exists" and let an operat
    // be issued with an empty Załącznik nr 1. The first page is enough to
    // tell an upload that happened from one that did not: pages are written
    // in order and this call is the last step of the same flow.
    try {
      await storage.get(insurancePageKey(docKey, 0));
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        return { fieldErrors: { policy: "Nie wgrano żadnej strony polisy — spróbuj ponownie." } };
      }
      await recordFailure({
        event: "finishInsuranceUpload.pageCheckFailed",
        actorId: session.user.id,
        error,
      });
      return { error: errorWithCode("Nie udało się zapisać polisy — spróbuj ponownie.") };
    }
    try {
      await profileRepository.saveInsurance(session.user.id, { docKey, validUntil });
    } catch (error) {
      await recordFailure({
        event: "finishInsuranceUpload.failed",
        actorId: session.user.id,
        error,
      });
      return { error: errorWithCode("Nie udało się zapisać polisy — spróbuj ponownie.") };
    }
    revalidatePath("/profile");
  });
}
