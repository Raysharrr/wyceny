import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { storage, valuationRepository } from "@/app/valuations/_deps";

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };

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

  const valuation = await valuationRepository.getByDocKey(key, session.user);
  if (!valuation) {
    return new NextResponse("Nie znaleziono dokumentu.", { status: 404, headers: TEXT_HEADERS });
  }

  try {
    const data = await storage.get(key);
    return new NextResponse(new Uint8Array(data), { status: 200, headers: TEXT_HEADERS });
  } catch {
    return new NextResponse("Nie znaleziono dokumentu.", { status: 404, headers: TEXT_HEADERS });
  }
}
