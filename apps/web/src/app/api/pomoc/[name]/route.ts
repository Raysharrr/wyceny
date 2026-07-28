import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };

/**
 * `private` (never `public`/`s-maxage`): these bytes are session-gated, so a
 * shared CDN cache must not keep a copy that could be replayed to an
 * anonymous caller. The browser may keep its own copy — help screenshots
 * only change when the docs change.
 */
const PNG_HEADERS = {
  "Content-Type": "image/png",
  "Content-Disposition": "inline",
  "Cache-Control": "private, max-age=3600",
};

/**
 * The screenshots sit next to the `.mdx` pages that reference them
 * (`src/content/pomoc/`), deliberately OUTSIDE `public/` — anything under
 * `public/` is served as a static asset, before any route handler runs, so
 * `getSession()` never gets a say. `outputFileTracingIncludes` in
 * `next.config.ts` ships this directory with the serverless bundle for this
 * route, the same way the DOCX operat template is shipped for
 * `/valuations/[id]`; `process.cwd()` is the app root at runtime
 * (`adapters/docx-render.ts` relies on the same contract).
 */
const IMG_DIR = path.join(process.cwd(), "src", "content", "pomoc", "img");

/**
 * Allow-list, not a deny-list: only lowercase-kebab `.png` basenames exist in
 * `IMG_DIR`, and this shape can express neither a separator nor a `..`
 * segment. The containment check below is deliberately redundant with it —
 * defence in depth, so a future loosening of the pattern cannot on its own
 * turn `[name]` into an arbitrary file read.
 */
const NAME_RX = /^[a-z0-9-]+\.png$/;

/**
 * Serves the Pomoc screenshots to signed-in users only (Slice 13,
 * follow-up).
 *
 * Failure shapes mirror `/api/docs/[key]`: no session → 401 plain text; a
 * name that is not a known screenshot → 404, whether it was rejected by the
 * pattern, escaped the directory, or simply does not exist. The three are
 * not distinguished on purpose — a probing caller learns nothing about what
 * lives on disk.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Wymagane zalogowanie.", { status: 401, headers: TEXT_HEADERS });
  }

  const notFound = () =>
    new NextResponse("Nie znaleziono zrzutu.", { status: 404, headers: TEXT_HEADERS });

  if (!NAME_RX.test(name)) {
    return notFound();
  }

  const filePath = path.resolve(IMG_DIR, name);
  if (filePath !== path.join(IMG_DIR, path.basename(filePath))) {
    return notFound();
  }

  try {
    const data = await readFile(filePath);
    return new NextResponse(new Uint8Array(data), { status: 200, headers: PNG_HEADERS });
  } catch {
    return notFound();
  }
}
