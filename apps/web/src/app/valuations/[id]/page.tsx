import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/auth/session";
import { wycenyRepository } from "../_deps";

const STATUS_LABEL: Record<string, string> = {
  w_toku: "W toku",
  podpisany: "Podpisany",
};

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

/**
 * View page (Task 9) — RSC. `PortWyceny.get` enforces ownership isolation
 * (T7): a non-owner rzeczoznawca gets `null` back, not the row — shown here
 * as a Polish "not found / no access" state rather than surfacing which
 * case it was (avoids leaking existence of other users' wyceny).
 */
export default async function WycenaViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const wycena = await wycenyRepository.get(id, session.user);

  if (!wycena) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <h1 className="text-xl font-semibold text-foreground">Nie znaleziono wyceny</h1>
        <p className="text-sm text-muted-foreground">Wycena nie istnieje albo nie masz do niej dostępu.</p>
        <Button asChild variant="outline">
          <Link href="/valuations">Wróć do listy wycen</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Link href="/valuations" className="hover:text-primary">
            Wyceny
          </Link>{" "}
          / Operat
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{wycena.address}</h1>
          <Badge variant={wycena.status === "podpisany" ? "default" : "secondary"}>
            {STATUS_LABEL[wycena.status] ?? wycena.status}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Powierzchnia</p>
            <p className="text-base font-medium text-foreground">{wycena.area} m²</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Wartość rynkowa (WR)</p>
            <p className="text-base font-medium text-foreground">{currencyFormatter.format(wycena.stubWr)}</p>
          </div>
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Kwota słownie</p>
            <p className="text-base font-medium text-primary">{wycena.slownie ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {wycena.docUrl ? (
        <Button asChild variant="outline" className="w-fit">
          <a href={wycena.docUrl} target="_blank" rel="noreferrer">
            Otwórz dokument operatu (stub)
          </a>
        </Button>
      ) : null}
    </div>
  );
}
