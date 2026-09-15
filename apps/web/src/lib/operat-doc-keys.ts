/**
 * Storage keys of the operat files ONE approval issues (ADR-020), shared by the
 * approve action that writes them and the sign action that reads the DOCX back
 * to put the signature on it.
 *
 * Keyed on `approvedAt`, so every approval owns its files: after „Cofnij
 * zatwierdzenie i popraw” the next approval writes new ones, and the previous
 * stay in storage under the keys the `reopened` audit row names (reguła 6).
 * A row approved before this key existed has nothing under it — which is how
 * sign recognises a DOCX without the signature marker.
 */
export function approvedOperatKeys(valuationId: string, approvedAt: Date) {
  const stem = `operat-${valuationId}-${approvedAt.getTime()}`;
  return { docx: `${stem}.docx`, pdf: `${stem}.pdf` };
}

/**
 * The storage key behind a `docUrl`/`docxUrl` — the inverse of what the
 * storage adapters return (`/api/docs/${encodeURIComponent(key)}`). Used by
 * the `reopened` audit row, which has to name the withdrawn documents by the
 * key they are stored under rather than by the URL that pointed at them.
 */
export function storageKeyOf(docUrl: string | null): string | null {
  if (!docUrl?.startsWith("/api/docs/")) return null;
  return decodeURIComponent(docUrl.slice("/api/docs/".length));
}
