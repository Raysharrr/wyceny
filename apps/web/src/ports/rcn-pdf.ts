/**
 * Turning a county "WYDRUK Z RCN" printout into the office's XLSX — the
 * worker's `POST /rcn-pdf-to-xlsx` behind a port (T-22). Zero interpretation:
 * the conversion carries counters and the workbook itself, nothing is
 * persisted and nothing is tied to a valuation.
 */

/** File-level refusals: the worker could not treat this PDF as a printout at all. */
export const RCN_REFUSALS = ["no_text_layer", "not_rcn_printout", "no_transactions"] as const;
export type RcnRefusal = (typeof RCN_REFUSALS)[number];

/**
 * How many transactions landed on each sheet of the workbook — zero for a kind
 * the printout does not contain. A flat, a house and a bare plot answer
 * different questions, so they get different columns, different sheets, and a
 * sentence on the screen that says which.
 */
export type RcnByKind = {
  lokale: number;
  zabudowane: number;
  niezabudowane: number;
};

export type RcnConversion = {
  orderNumber: string;
  unit: string;
  count: number;
  byKind: RcnByKind;
  flaggedRows: number;
  fileWarnings: string[];
  /** The whole workbook, base64 — the browser turns it into a Blob, it never hits the server twice. */
  xlsxBase64: string;
};

/**
 * A failed conversion. `code` is set only for the worker's 422 refusals (a
 * statement about the file); for every other status it is null (a statement
 * about the call), which is what tells the Server Action whether to record a
 * failure or just show the message.
 */
export class RcnPdfError extends Error {
  constructor(
    readonly status: number,
    readonly code: RcnRefusal | null,
  ) {
    super(code ?? `worker /rcn-pdf-to-xlsx responded ${status}`);
    this.name = "RcnPdfError";
  }
}

export interface PortRcnPdf {
  /**
   * `type` is the browser's own MIME for the picked file and travels through
   * verbatim. The worker refuses a non-PDF with 415 ("To nie jest plik PDF."),
   * and it can only do that if we DON'T relabel every upload as
   * `application/pdf` on the way out — doing so turned a wrong-format file into
   * the misleading "Nie rozpoznaję tego układu" (caught in the live run).
   */
  convert(
    file: { bytes: Uint8Array; name: string; type: string },
    token: string,
  ): Promise<RcnConversion>;
}
