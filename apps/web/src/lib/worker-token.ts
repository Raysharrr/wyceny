import { createHmac, randomBytes } from "node:crypto";

/**
 * Short-lived HMAC token for a worker endpoint that the web calls without a
 * session of its own (`/kw-extract`, `/kw-transcribe`, `/prose-proposal`).
 * Stateless: the worker re-derives the signature from the shared secret.
 *
 * ONE token covers both reads of a KW upload: `b1-kw-read` fires `/kw-extract`
 * and `/kw-transcribe` at the same file, and this is a time-bounded bearer,
 * not a single-use nonce — minting two would cost a second round trip to the
 * server and leave the slower read with a shorter remaining life.
 *
 * Extracted from `app/actions/mint-kw-token.ts` when the prose action needed
 * the same token — a security primitive is worth one module, not two copies.
 * Server-only (`node:crypto`); never import this from a Client Component.
 */

const TOKEN_TTL_SECONDS = 300;

/** `exp.nonce.signature`, or null when WORKER_SHARED_SECRET is not configured. */
export function mintWorkerToken(): string | null {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const nonce = randomBytes(8).toString("hex");
  const signature = createHmac("sha256", secret).update(`${exp}.${nonce}`).digest("hex");
  return `${exp}.${nonce}.${signature}`;
}
