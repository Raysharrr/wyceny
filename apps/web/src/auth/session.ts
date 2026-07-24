import { headers } from "next/headers";
import { auth } from "./auth";

export type Role = "admin" | "appraiser";

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
};

export type Session = {
  user: SessionUser;
};

/**
 * Server-side session helper (ADR-013). Reads the Better Auth session from
 * the incoming request's cookies via `headers()` — call this from Server
 * Components, Server Actions, and Route Handlers.
 *
 * Returns `null` when there is no signed-in user.
 */
export async function getSession(): Promise<Session | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return null;
  }

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      role: session.user.role as Role,
    },
  };
}
