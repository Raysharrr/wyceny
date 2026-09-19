import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { TOOLS } from "@/components/tools-nav";

/** `/narzedzia` — rozdroże: jedna karta na narzędzie z `TOOLS`. */
export default async function NarzedziaPage() {
  if (!(await getSession())) redirect("/login");
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-6 py-10">
      <div>
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
          Narzędzia
        </p>
        <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">Narzędzia biura</h1>
        <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">
          Narzędzia wspólne dla całego biura, dostępne poza kreatorem wyceny.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <section
            key={t.href}
            className="flex flex-col rounded-xl border border-border bg-card p-5"
          >
            <h2 className="mb-1.5 text-[15px] font-semibold">{t.label}</h2>
            <p className="mb-4 flex-1 text-[13.5px] text-muted-foreground">{t.description}</p>
            <Button asChild variant="outline" className="self-start">
              <Link href={t.href}>Otwórz narzędzie</Link>
            </Button>
          </section>
        ))}
      </div>
    </div>
  );
}
