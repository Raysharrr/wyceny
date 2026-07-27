import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { HelpNav } from "@/components/help/help-nav";
import { HelpSearch } from "@/components/help/help-search";
import index from "@/content/pomoc/search-index.json";
import type { HelpIndexEntry } from "@/lib/help-search";

/**
 * Help module landing page (Slice 13, Task 1) — RSC behind the session gate,
 * matching the `valuations`/`profile` pattern. Task 3 added the listing of
 * both content trees, Task 4 the search box above them.
 *
 * `search-index.json` is generated and gitignored — `pnpm help-index` builds
 * it, wired into `pre{dev,build,typecheck,test}` so no consumer can meet a
 * missing file. The cast is the price of importing JSON: TypeScript widens
 * `tree` to `string`, while the generator types its own output as
 * `HelpIndexEntry[]` and refuses to emit a file it can't reconcile with the
 * manifest.
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
      <HelpSearch index={index as HelpIndexEntry[]} />
      <HelpNav />
    </main>
  );
}
