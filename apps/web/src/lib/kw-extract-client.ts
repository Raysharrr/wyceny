import { z } from "zod";
import { kwDzialSchema } from "@/lib/valuation-form-schema";
import type { KwMetaSnapshot, KwSnapshot } from "@/domain/kw-snapshot";

/**
 * Browser-side client for the worker's POST /kw-extract (Slice 6). Runs in
 * the client component — the file goes straight to the worker (Vercel body
 * limit), authorized by a server-minted HMAC token. The response is
 * zod-validated; on submit the extract is re-validated server-side by
 * `valuationFormSchema` like any other client input.
 */
const wireSchema = z.object({
  extract: z.object({
    docType: z.enum(["akt", "odpis_kw", "nieznany"]),
    kwLokalu: z.string().nullable(),
    kwGruntu: z.string().nullable(),
    kwInne: z.array(z.string()),
    deweloperski: z.boolean(),
    powUzytkowaKw: z.number().nullable(),
    powPrzezOdwolanie: z.boolean(),
    udzial: z.string().nullable(),
    sad: z.string().nullable(),
    wydzial: z.string().nullable(),
    dataDokumentu: z.string().nullable(),
    dzial3: kwDzialSchema.nullable(),
    dzial4: kwDzialSchema.nullable(),
  }),
  docTypeDetected: z.enum(["akt", "odpis_kw"]),
  typeMismatch: z.boolean(),
  model: z.string(),
});

export type KwExtractResult =
  | { kind: "ok"; extract: KwSnapshot; meta: KwMetaSnapshot; typeMismatch: boolean }
  | { kind: "invalidDoc"; message: string }
  | { kind: "error"; message: string; retryable: boolean };

const GENERIC_ERROR = "Nie udało się odczytać dokumentu — spróbuj ponownie.";

async function detailOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail;
  } catch {
    return undefined;
  }
}

export async function extractKw(args: {
  file: File;
  expectedType: "akt" | "odpis_kw";
  token: string;
  workerUrl: string;
}): Promise<KwExtractResult> {
  const form = new FormData();
  form.set("file", args.file);
  form.set("token", args.token);
  form.set("expected_type", args.expectedType);

  let response: Response;
  try {
    response = await fetch(`${args.workerUrl}/kw-extract`, { method: "POST", body: form });
  } catch {
    return { kind: "error", message: GENERIC_ERROR, retryable: true };
  }

  if (response.status === 422) {
    return {
      kind: "invalidDoc",
      message:
        (await detailOf(response)) ??
        "To nie wygląda na akt notarialny ani odpis księgi wieczystej.",
    };
  }
  if (!response.ok) {
    return {
      kind: "error",
      message: (await detailOf(response)) ?? GENERIC_ERROR,
      retryable: response.status === 502,
    };
  }

  const parsed = wireSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return { kind: "error", message: GENERIC_ERROR, retryable: true };
  }
  const { extract, docTypeDetected, typeMismatch, model } = parsed.data;
  return {
    kind: "ok",
    extract: {
      source: docTypeDetected,
      kwLokalu: extract.kwLokalu,
      kwGruntu: extract.kwGruntu,
      kwInne: extract.kwInne,
      deweloperski: extract.deweloperski,
      powUzytkowaKw: extract.powUzytkowaKw,
      udzial: extract.udzial,
      sad: extract.sad,
      wydzial: extract.wydzial,
      dataDokumentu: extract.dataDokumentu,
      dzial3: extract.dzial3,
      dzial4: extract.dzial4,
    },
    meta: {
      model,
      extractedAt: new Date().toISOString(),
      docTypeDetected,
      docTypeDeclared: args.expectedType,
    },
    typeMismatch,
  };
}
