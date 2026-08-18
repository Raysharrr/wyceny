import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { storage, valuationRepository } from "@/app/valuations/_deps";
import { previewDocKey } from "@/lib/preview-doc";

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };

/**
 * Serves the operat PREVIEW rendered by `previewOperat` (Slice 14, Task 9).
 *
 * It needs a route of its own because `/api/docs/[key]` authorizes through
 * `getByDocKey`, which matches ONLY the `docUrl`/`docxUrl` columns — and the
 * preview must never be registered there: those two columns mean the operat
 * has been *issued*. So authorization here is ownership of the VALUATION
 * itself (`valuationRepository.get`, admin → any, appraiser → only their
 * own, F-8). Missing valuation, someone else's valuation and a draft with no
 * preview rendered yet all answer 404 alike — distinguishing them would leak
 * the existence of other people's work.
 *
 * `no-store`: the blob key is stable per valuation, so every re-render
 * overwrites it. The action's URL carries a content hash to defeat the
 * browser cache; this header stops any intermediary from serving a render
 * the appraiser has already corrected.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Wymagane zalogowanie.", { status: 401, headers: TEXT_HEADERS });
  }

  const valuation = await valuationRepository.get(id, session.user);
  if (!valuation) {
    return new NextResponse("Nie znaleziono podglądu.", { status: 404, headers: TEXT_HEADERS });
  }

  try {
    const data = await storage.get(previewDocKey(id));
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Nie znaleziono podglądu.", { status: 404, headers: TEXT_HEADERS });
  }
}
