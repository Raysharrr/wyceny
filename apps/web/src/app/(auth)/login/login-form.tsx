"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

/** Seeded demo users (see `scripts/seed.ts`) — credentials are for local/demo use only. */
const DEMO_ACCOUNTS = [
  {
    role: "admin" as const,
    label: "Administrator (Aneta)",
    email: "aneta@wyceny.test",
    password: "Admin123!",
  },
  {
    role: "appraiser" as const,
    label: "Rzeczoznawca (Zenon)",
    email: "zenon@wyceny.test",
    password: "Rzeczoznawca123!",
  },
];

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Zaloguj się</CardTitle>
          <CardDescription>Wprowadź adres e-mail i hasło, aby uzyskać dostęp do wycen.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Adres e-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Hasło</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {state.error ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="mt-1">
              {pending ? "Logowanie…" : "Zaloguj się"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <p className="text-center text-xs text-muted-foreground">Konta demonstracyjne</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((account) => (
            <Card key={account.role} size="sm">
              <CardHeader>
                <CardTitle className="text-sm">{account.label}</CardTitle>
                <CardDescription className="text-xs">{account.email}</CardDescription>
              </CardHeader>
              <CardContent>
                <form action={formAction}>
                  <input type="hidden" name="email" value={account.email} />
                  <input type="hidden" name="password" value={account.password} />
                  <Button type="submit" variant="outline" disabled={pending} className="w-full px-2 text-xs">
                    Zaloguj jako {account.role === "admin" ? "administrator" : "rzeczoznawca"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
