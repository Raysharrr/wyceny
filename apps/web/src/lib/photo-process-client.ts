/**
 * Browser-side client for the worker's POST /photo-process (Slice 10). The
 * file goes straight to the worker (Vercel body limit bypass, KW pattern);
 * the base64 response is decoded to a Blob the upload server action accepts.
 */

const GENERIC_ERROR = "Nie udało się przetworzyć zdjęcia — spróbuj ponownie.";

export type ProcessPhotoResult =
  { kind: "ok"; blob: Blob } | { kind: "error"; message: string; retryable: boolean };

async function detailOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail;
  } catch {
    return undefined;
  }
}

export async function processPhoto(args: {
  file: File;
  token: string;
  workerUrl: string;
}): Promise<ProcessPhotoResult> {
  const form = new FormData();
  form.set("file", args.file);
  form.set("token", args.token);
  let response: Response;
  try {
    response = await fetch(`${args.workerUrl}/photo-process`, { method: "POST", body: form });
  } catch {
    return { kind: "error", message: GENERIC_ERROR, retryable: true };
  }
  if (!response.ok) {
    return {
      kind: "error",
      message: (await detailOf(response)) ?? GENERIC_ERROR,
      retryable: response.status >= 500,
    };
  }
  const body = (await response.json()) as { photo?: string };
  if (!body.photo) {
    return { kind: "error", message: GENERIC_ERROR, retryable: false };
  }
  const bytes = Uint8Array.from(atob(body.photo), (c) => c.charCodeAt(0));
  return { kind: "ok", blob: new Blob([bytes], { type: "image/jpeg" }) };
}
