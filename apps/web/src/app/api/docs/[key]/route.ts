import { NextResponse } from "next/server";
import { storage } from "@/app/wyceny/_deps";

/**
 * Doc-serving route (Task 9). `PortStorage.put` (T8, in-memory adapter)
 * returns URLs shaped `/api/docs/${key}` — this route is what makes those
 * links resolve locally. Serves the stub operat text as-is.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  try {
    const data = await storage.get(key);
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new NextResponse("Nie znaleziono dokumentu.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
