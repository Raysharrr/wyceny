/**
 * Storage key of a valuation's operat PREVIEW (Slice 14, Task 9), shared by
 * the action that writes it and the `/api/podglad/[id]` route that serves it.
 *
 * Stable per valuation on purpose: every re-render overwrites the previous
 * one, so a draft owns exactly one preview blob however many times its facts
 * change. It is deliberately NOT registered in `docUrl`/`docxUrl` — those two
 * columns mean *issued*, and `/api/docs/[key]` authorizes against them, which
 * is why the preview needs a route of its own.
 */
export function previewDocKey(valuationId: string): string {
  return `podglad-${valuationId}.pdf`;
}
