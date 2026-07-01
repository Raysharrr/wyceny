"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { auth } from "@/auth/auth";

export type SignInState = {
  error: string | null;
};

/**
 * Server Action backing the login form (ADR-013). Delegates password
 * verification + session creation to Better Auth; the `nextCookies` plugin
 * on `auth` sets the session cookie automatically on success.
 */
export async function signInAction(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Podaj adres e-mail i hasło." };
  }

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch (error) {
    if (isAPIError(error)) {
      return { error: "Nieprawidłowy e-mail lub hasło." };
    }
    throw error;
  }

  redirect("/valuations");
}
