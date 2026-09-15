/**
 * Storage keys for the OC policy pages (ADR-020 cz. 1, D-60). One JPEG per
 * page under a prefix the profile row points at (`insurance_doc_key`).
 *
 * The prefix carries the UPLOAD, not just the appraiser: a re-uploaded policy
 * gets a fresh one. Reuse would mix pages — a five-page policy replacing a
 * seven-page one would leave pages 6 and 7 of the OLD document behind, and the
 * reader (which probes `page-001`, `page-002`, … until a key is missing) would
 * append them to the new one. The superseded pages stay in storage unreferenced;
 * no reader can reach them, since nothing points at the old prefix any more.
 *
 * Pure (F-10): no I/O, no env — the same function names the key on the write
 * path and on the read path, so the two cannot drift apart.
 */

export function insurancePrefix(userId: string, uploadId: string): string {
  return `polisa/${userId}/${uploadId}`;
}

/** `page-001.jpg` … — zero-padded so the keys sort in document order. */
export function insurancePageKey(prefix: string, pageIndex: number): string {
  return `${prefix}/page-${String(pageIndex + 1).padStart(3, "0")}.jpg`;
}
