"use server";

import { createHmac, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

const TOKEN_TTL_SECONDS = 300;

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
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    return { error: "Upload nie jest skonfigurowany — skontaktuj się z administratorem." };
  }
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const nonce = randomBytes(8).toString("hex");
  const signature = createHmac("sha256", secret).update(`${exp}.${nonce}`).digest("hex");
  return { token: `${exp}.${nonce}.${signature}` };
}
