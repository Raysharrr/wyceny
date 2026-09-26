import type { KluczeLokalu } from "@/domain/kw-klucze";
import type { KartaKsiegi } from "@/domain/kw-niezgodnosci";
import type { KsiegaTresc, KwWalidacja } from "@/domain/kw-tresc";
import { kwTranscribeResponseSchema } from "@/domain/kw-tresc";

/**
 * Browser-side client for the worker's POST /kw-transcribe (b1-kw-read,
 * ADR-021) — the same road, the same token and the same worker as
 * `kw-extract-client.ts`. Transcribes the five dzialy out of one or many PDFs,
 * or out of the text pasted from the eKW browser: the unit's book in full, the
 * land book selectively — the land in full, and from the unit lists only the
 * row the unit's keys point at (ADR-024). `/kw-extract` reads its handful of
 * fields from the first PDF only.
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
 * mean the same thing to the appraiser — treści nie ma, a jedyne wyjście to
 * podać ją jeszcze raz, tym samym sposobem albo drugim (ścieżki ręcznego
 * wpisywania działów nie ma od ADR-021). Zwijają się więc w jedną klasę
 * ogólną, zamiast mnożyć banery, na które i tak reaguje się tak samo.
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
  files?: File[];
  tekst?: string;
  token: string;
  workerUrl: string;
  /** Która karta przepisuje — worker wymaga jej zawsze (bez niej 422, ADR-024). */
  karta: KartaKsiegi;
  /** Klucze przedmiotowego lokalu; znaczą coś tylko przy `karta: "grunt"`. */
  klucze?: KluczeLokalu | null;
}): Promise<KwTranscribeResult> {
  const form = new FormData();
  // Pole POWTARZANE, nie `files[]` — FastAPI czyta `list[UploadFile]` po nazwie.
  for (const file of args.files ?? []) form.append("files", file);
  if (args.tekst != null && args.tekst !== "") form.set("tekst", args.tekst);
  form.set("token", args.token);
  form.set("karta", args.karta);
  if (args.klucze) {
    form.set("kw_lokalu", args.klucze.kwLokalu);
    // Numer lokalu tylko niepusty: worker szuka wtedy wiersza po samym numerze KW.
    if (args.klucze.nrLokalu) form.set("nr_lokalu", args.klucze.nrLokalu);
  }

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
