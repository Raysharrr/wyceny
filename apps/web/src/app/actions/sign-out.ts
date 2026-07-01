"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth/auth";

/**
 * Server Action backing the "Wyloguj" button on the valuations list
 * (ADR-013 auth pattern). Mirrors `signInAction`: delegates to Better Auth,
 * whose `nextCookies` plugin clears the session cookie automatically.
 *
 * Exists mainly so the demo/walking-skeleton build can switch between the
 * seeded admin/appraiser accounts without clearing cookies by hand.
 */
export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
