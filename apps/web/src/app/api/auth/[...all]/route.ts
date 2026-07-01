import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth/auth";

/** Mounts Better Auth's REST API (sign-in, sign-out, session, ...) under /api/auth/*. */
export const { GET, POST } = toNextJsHandler(auth);
