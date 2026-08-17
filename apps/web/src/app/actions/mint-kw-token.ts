"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { mintWorkerToken } from "@/lib/worker-token";

/**
 * Mints a short-lived HMAC token for the browser's direct-to-worker KW
 * upload (spec §Architektura: Vercel's 4.5 MB body limit forces the
 * bypass). Stateless: the worker re-derives the signature from the shared
 * secret. Session-gated like every other action.
 */
export async function mintKwUploadToken(): Promise<{ token: string } | { error: string }> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const token = mintWorkerToken();
  if (!token) {
    return { error: "Upload nie jest skonfigurowany — skontaktuj się z administratorem." };
  }
  return { token };
}
