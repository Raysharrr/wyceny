import type { KsiegaTresc, KwWalidacja } from "@/domain/kw-tresc";
import { kwTranscribeResponseSchema } from "@/domain/kw-tresc";

/**
 * Browser-side client for the worker's POST /kw-transcribe (b1-kw-read) —
 * the same road, the same token and the same worker as `kw-extract-client.ts`,
 * for the second, independent read of the very same PDF: `/kw-extract` reads a
 * handful of fields, this one transcribes the five dzialy in full.
 *
 * Two calls rather than one because the spike measured them as different jobs:
 * the field read runs on the cheaper model, the transcription needs
 * claude-opus-5 and about a minute. The caller fires both against ONE minted
 * token and writes the snapshot once, after both settle.
 *
 * NOTHING from the response may be logged — it carries persons' names and
 * PESELs on purpose (ADR-018 "Zmiana 15.09", F-13). This module therefore
 * returns error CLASSES, never the model's text, and never calls a logger.
 */

/**
 * The worker's error classes, verbatim from `TRANSCRIBE_ERRORS`
 * (apps/worker/app/main.py). There is no `kw_transkrypcja_odmowa`: a refusal
 * and a non-JSON answer both come back as `kw_transkrypcja_nieczytelna`,
 * because neither proves the book was too large.
 */
export type KwTranscribeErrorCode =
  "kw_transkrypcja_ucieta" | "kw_transkrypcja_nieczytelna" | "kw_transkrypcja_blad";

const KNOWN_CODES: readonly string[] = [
  "kw_transkrypcja_ucieta",
  "kw_transkrypcja_nieczytelna",
  "kw_transkrypcja_blad",
];

export type KwTranscribeResult =
  | { kind: "ok"; tresc: KsiegaTresc; walidacja: KwWalidacja }
  | { kind: "error"; code: KwTranscribeErrorCode };

/**
 * Anything the worker did not label: a 401 on the token, a proxy's 504, a
 * network drop, a body that fails `kwTranscribeResponseSchema`. All of them
 * mean the same thing to the appraiser — the transcription is not there and
 * the manual path is — so they collapse into the generic class rather than
 * multiplying banners nobody can act on differently.
 */
const GENERIC: KwTranscribeErrorCode = "kw_transkrypcja_blad";

async function codeOf(response: Response): Promise<KwTranscribeErrorCode> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === "string" && KNOWN_CODES.includes(body.code)
      ? (body.code as KwTranscribeErrorCode)
      : GENERIC;
  } catch {
    return GENERIC;
  }
}

export async function transcribeKw(args: {
  file: File;
  token: string;
  workerUrl: string;
}): Promise<KwTranscribeResult> {
  const form = new FormData();
  form.set("file", args.file);
  form.set("token", args.token);

  let response: Response;
  try {
    response = await fetch(`${args.workerUrl}/kw-transcribe`, { method: "POST", body: form });
  } catch {
    return { kind: "error", code: GENERIC };
  }

  // The code is read from the BODY, not guessed from the status: 422 carries
  // both `kw_transkrypcja_ucieta` and `kw_transkrypcja_nieczytelna`, and the
  // appraiser's next move differs between them (a smaller excerpt vs another
  // file). Matching on `detail` text instead would break on a copy edit.
  if (!response.ok) return { kind: "error", code: await codeOf(response) };

  const parsed = kwTranscribeResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: "error", code: GENERIC };

  const { walidacja, ...tresc } = parsed.data;
  return { kind: "ok", tresc, walidacja };
}
