import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { storage, valuationRepository } from "@/app/valuations/_deps";

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PHOTO_HEADERS = { "Content-Type": "image/jpeg", "Content-Disposition": "inline" };

/**
 * Inspection photo keys (Slice 10, FR-2), e.g.
 * "ogledziny-budynek-<uuid>-<valuationId>.jpg" — live only in
 * `inputs.inspection.photos` (the manifest), never in `docUrl`/`docxUrl`, so
 * `getByDocKey` can't see them (it matches only those two columns,
 * valuation-drizzle.ts). The key embeds its owning valuationId; authorize
 * via `valuationRepository.get` (owner + admin, F-8) AND membership in that
 * valuation's manifest — the key alone doesn't prove the caller may see it
 * (no fishing for orphaned/guessed keys).
 */
const PHOTO_KEY_RX =
  /^ogledziny-(?:otoczenie|budynek|wnetrza)-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/;

/**
 * Success-path Content-Type/-Disposition, derived from the key's file
 * extension (Slice 4 adds real PDF/DOCX artifacts alongside legacy text
 * stubs). PDF renders inline in the browser; DOCX downloads as an
 * attachment (browsers can't render it inline); anything else keeps the
 * original plain-text stub behavior.
 */
function successHeaders(key: string): Record<string, string> {
  if (key.endsWith(".pdf")) {
    return { "Content-Type": "application/pdf", "Content-Disposition": "inline" };
  }
  if (key.endsWith(".docx")) {
    return {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": 'attachment; filename="operat.docx"',
    };
  }
  return TEXT_HEADERS; // legacy text stubs
}

/**
 * Doc-serving route (Task 9; access-controlled in Task 11a now that
 * `PortStorage` is Postgres-backed and persists beyond a single process —
 * serving without auth was an accepted carry-forward only while storage
 * was in-memory/dev-only).
 *
 * `PortStorage.put` returns URLs shaped `/api/docs/${key}` — this route is
 * what makes those links resolve. Access control: the caller must have a
 * session, AND the Valuation that owns this doc key must be visible to them
 * under the same ownership rule as `PortValuation.get` (admin → any;
 * appraiser → only their own, F-8). No session → 401. No visible owning
 * Valuation (doesn't exist, or exists but isn't theirs) → 404 in both
 * cases, deliberately — distinguishing them would leak existence of other
 * users' docs.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Wymagane zalogowanie.", { status: 401, headers: TEXT_HEADERS });
  }

  const photoMatch = PHOTO_KEY_RX.exec(key);
  if (photoMatch) {
    const owning = await valuationRepository.get(photoMatch[1], session.user);
    const manifest = owning?.inputs?.inspection?.photos;
    const inManifest = manifest && Object.values(manifest).some((keys) => keys.includes(key));
    if (!inManifest) {
      return new NextResponse("Nie znaleziono dokumentu.", { status: 404, headers: TEXT_HEADERS });
    }
    try {
      const data = await storage.get(key);
      return new NextResponse(new Uint8Array(data), { status: 200, headers: PHOTO_HEADERS });
    } catch {
      return new NextResponse("Nie znaleziono dokumentu.", { status: 404, headers: TEXT_HEADERS });
    }
  }

  const valuation = await valuationRepository.getByDocKey(key, session.user);
  if (!valuation) {
    return new NextResponse("Nie znaleziono dokumentu.", { status: 404, headers: TEXT_HEADERS });
  }

  try {
    const data = await storage.get(key);
    return new NextResponse(new Uint8Array(data), { status: 200, headers: successHeaders(key) });
  } catch {
    return new NextResponse("Nie znaleziono dokumentu.", { status: 404, headers: TEXT_HEADERS });
  }
}
