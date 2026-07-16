/**
 * Port for the worker service (Python, num2words-backed /amount-in-words
 * endpoint).
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10).
 */
export interface PortWorker {
  /**
   * Converts a monetary amount to its Polish words representation
   * (e.g. "milion czterdzieści cztery tysiące czterysta złotych").
   *
   * Always resolves to the words string — never the raw number (F-11).
   */
  amountInWords(amount: number): Promise<string>;

  /**
   * Converts a rendered DOCX to PDF (LibreOffice runs worker-side, ADR-009).
   * Takes and returns file bytes only — never computed values (F-11).
   */
  convertToPdf(docx: Buffer): Promise<Buffer>;
}
