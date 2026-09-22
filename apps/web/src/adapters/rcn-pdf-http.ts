import { z } from "zod";
import { RCN_REFUSALS, RcnPdfError, type PortRcnPdf, type RcnConversion } from "../ports/rcn-pdf";
import { traceHeaders } from "../lib/trace";

const wireSchema = z.object({
  orderNumber: z.string(),
  unit: z.string(),
  count: z.number(),
  byKind: z.object({
    lokale: z.number(),
    zabudowane: z.number(),
    niezabudowane: z.number(),
  }),
  flaggedRows: z.number(),
  fileWarnings: z.array(z.string()),
  xlsxBase64: z.string(),
});

/** 4 MB over a local/regional hop plus PDFium + openpyxl — well under a minute, same budget as `/coop-sheet`. */
const TIMEOUT_MS = 55_000;

/** HTTP adapter for {@link PortRcnPdf} — multipart to the worker's `POST /rcn-pdf-to-xlsx`, token-gated like `/coop-sheet`. */
export function httpRcnPdf(baseUrl: string): PortRcnPdf {
  return {
    async convert(file, token): Promise<RcnConversion> {
      const form = new FormData();
      // The file's OWN type, not a hard-coded "application/pdf": the worker's
      // 415 check reads `content_type`, so relabelling here would hide every
      // wrong-format upload behind a 422 about the layout.
      form.set(
        "file",
        new Blob([file.bytes as BlobPart], { type: file.type || "application/pdf" }),
        file.name,
      );
      form.set("token", token);
      const response = await fetch(`${baseUrl}/rcn-pdf-to-xlsx`, {
        method: "POST",
        headers: traceHeaders(),
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        // 422 answers with `{"detail": {"code": …}}` — a statement about the
        // file. Every other status answers with a plain Polish `detail`, which
        // the action maps by status instead.
        const body = (await response.json().catch(() => ({}))) as {
          detail?: { code?: string } | string;
        };
        const code = typeof body.detail === "object" ? body.detail?.code : undefined;
        throw new RcnPdfError(response.status, RCN_REFUSALS.find((c) => c === code) ?? null);
      }
      return wireSchema.parse(await response.json());
    },
  };
}
