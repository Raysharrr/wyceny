/**
 * Kill switch for inspection photo upload (`NEXT_PUBLIC_PHOTO_UPLOAD`), read in
 * one place so the UI and the approval gate can never disagree.
 *
 * It matters for B-01 (M-1): the gate refuses an operat with no exterior photo
 * of the building, because since M-1 the first of those photos IS the cover.
 * But a build where upload is switched off cannot produce one, and a gate that
 * demands what the product has disabled would wedge every draft — which is how
 * the e2e suite runs (`playwright.config.ts` sets it to "off" so the run does
 * not depend on the worker's image pipeline). Same shape as
 * {@link proseEnabled} and FR-6: the switch removes the requirement, it does
 * not fake a satisfied one.
 */
export function photoUploadEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHOTO_UPLOAD !== "off";
}
