import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { HelpNav } from "@/components/help/help-nav";

/**
 * Help module landing page (Slice 13, Task 1) — RSC behind the session gate,
 * matching the `valuations`/`profile` pattern. Task 3 added the listing of
 * both content trees; the search box lands in a later task.
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
      <HelpNav />
    </main>
  );
}
