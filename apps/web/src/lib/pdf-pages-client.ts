/**
 * Browser-side client for the worker's POST /pdf-pages (ADR-020, D-60). The
 * OC policy PDF goes straight to the worker — same route, token and body shape
 * as `photo-process-client.ts`, for the same reason: Vercel's 4.5 MB body
 * limit would refuse the file on the way to a Server Action.
 *
 * The worker answers with one JPEG per page, in document order; the pages are
 * uploaded back one at a time (the same limit applies in that direction, and
 * ten rasterised A4 pages at 150 DPI comfortably exceed it in one payload).
 */

const GENERIC_ERROR = "Nie udało się odczytać pliku PDF polisy — spróbuj ponownie.";

export type PdfPage = { blob: Blob; width: number; height: number };

export type PdfPagesResult =
  { kind: "ok"; pages: PdfPage[] } | { kind: "error"; message: string; retryable: boolean };

async function detailOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail;
  } catch {
    return undefined;
  }
}

export async function renderPdfPages(args: {
  file: File;
  token: string;
  workerUrl: string;
}): Promise<PdfPagesResult> {
  const form = new FormData();
  form.set("file", args.file);
  form.set("token", args.token);
  let response: Response;
  try {
    response = await fetch(`${args.workerUrl}/pdf-pages`, { method: "POST", body: form });
  } catch {
    return { kind: "error", message: GENERIC_ERROR, retryable: true };
  }
  if (!response.ok) {
    // 413 (too large / too many pages) and 415 (not a readable PDF) carry a
    // Polish `detail` the appraiser can act on — show it verbatim rather than
    // flattening both into one unhelpful sentence.
    return {
      kind: "error",
      message: (await detailOf(response)) ?? GENERIC_ERROR,
      retryable: response.status >= 500,
    };
  }
  const body = (await response.json()) as {
    pages?: Array<{ image: string; width: number; height: number }>;
  };
  if (!body.pages?.length) {
    return { kind: "error", message: GENERIC_ERROR, retryable: false };
  }
  return {
    kind: "ok",
    pages: body.pages.map((page) => ({
      blob: new Blob([Uint8Array.from(atob(page.image), (c) => c.charCodeAt(0))], {
        type: "image/jpeg",
      }),
      width: page.width,
      height: page.height,
    })),
  };
}
