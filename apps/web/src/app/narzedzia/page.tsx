import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { TOOLS } from "@/components/tools";

export const dynamic = "force-dynamic";

/**
 * `/narzedzia` — the crossroads (T-22, makieta `1-propozycja-narzedzia`). Built
 * from the same `TOOLS` list as `ToolsNav`, which does not render here: on this
 * screen the cards ARE the navigation.
 */
export default async function NarzedziaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-6 py-10">
      <div>
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
          Narzędzia
        </p>
        <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">Narzędzia biura</h1>
        <p className="max-w-[80ch] text-[14.5px] text-muted-foreground">
          Rejestr biura i pomocnicze narzędzia, z których korzystasz obok wycen.
        </p>
      </div>
      <div className="grid max-w-[900px] gap-5 sm:grid-cols-2">
        {TOOLS.map(({ href, label, description, icon: Icon }) => (
          <section
            key={href}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid size-[34px] place-items-center rounded-lg bg-[var(--accent-050)] text-[var(--accent-700)]">
                <Icon className="size-[18px]" />
              </span>
              <h2 className="text-[15px] font-semibold">{label}</h2>
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{description}</p>
            <div>
              <Button asChild variant="outline">
                <Link href={href}>
                  <ArrowRight data-icon="inline-start" />
                  Otwórz
                </Link>
              </Button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
