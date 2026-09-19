/**
 * Turning a county "WYDRUK Z RCN" printout into the office's XLSX — the
 * worker's `POST /rcn-pdf-to-xlsx` behind a port (T-22). Zero interpretation:
 * the conversion carries counters and the workbook itself, nothing is
 * persisted and nothing is tied to a valuation.
 */

/** File-level refusals: the worker could not treat this PDF as a printout at all. */
export const RCN_REFUSALS = ["no_text_layer", "not_rcn_printout", "no_transactions"] as const;
export type RcnRefusal = (typeof RCN_REFUSALS)[number];

export type RcnConversion = {
  orderNumber: string;
  unit: string;
  count: number;
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
  convert(file: { bytes: Uint8Array; name: string }, token: string): Promise<RcnConversion>;
}
