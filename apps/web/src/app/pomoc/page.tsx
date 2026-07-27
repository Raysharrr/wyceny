import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

/**
 * Help module landing page (Slice 13, Task 1) — RSC behind the session gate,
 * matching the `valuations`/`profile` pattern. The two content trees and the
 * search box land in later tasks.
 */
export default async function Page() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <h1 className="mb-2 text-[25px] font-semibold tracking-[-0.015em]">Pomoc</h1>
      <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">
        Instrukcja obsługi aplikacji oraz opis metody, na której opieramy wyniki.
      </p>
    </main>
  );
}
