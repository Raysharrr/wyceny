import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/auth/session";
import { valuationRepository } from "../_deps";

const STATUS_LABEL: Record<string, string> = {
  in_progress: "W toku",
  signed: "Podpisany",
};

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

// RFC 4122-shaped (any version/variant) — the `id` route param is
// user-controlled and Postgres' `uuid` column rejects anything else with a
// raw "invalid input syntax for type uuid" error. Validate before it ever
// reaches the repo query, so a malformed id renders the same friendly
// not-found state as a well-formed-but-unknown/inaccessible one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-foreground">Nie znaleziono wyceny</h1>
      <p className="text-sm text-muted-foreground">
        Wycena nie istnieje albo nie masz do niej dostępu.
      </p>
      <Button asChild variant="outline">
        <Link href="/valuations">Wróć do listy wycen</Link>
      </Button>
    </div>
  );
}

/**
 * View page (Task 9) — RSC. `PortValuation.get` enforces ownership isolation
 * (T7): a non-owner appraiser gets `null` back, not the row — shown here as
 * a Polish "not found / no access" state rather than surfacing which case it
 * was (avoids leaking existence of other users' valuations).
 */
export default async function ValuationViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  if (!UUID_RE.test(id)) {
    return <NotFound />;
  }

  const valuation = await valuationRepository.get(id, session.user);

  if (!valuation) {
    return <NotFound />;
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
          <h1 className="text-2xl font-semibold text-foreground">{valuation.address}</h1>
          <Badge variant={valuation.status === "signed" ? "default" : "secondary"}>
            {STATUS_LABEL[valuation.status] ?? valuation.status}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Powierzchnia</p>
            <p className="text-base font-medium text-foreground">{valuation.area} m²</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Wartość rynkowa (WR)</p>
            <p className="text-base font-medium text-foreground" data-testid="wr-value">
              {currencyFormatter.format(valuation.wr)}
            </p>
          </div>
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Kwota słownie</p>
            <p className="text-base font-medium text-primary">{valuation.amountInWords ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {valuation.docUrl ? (
        <Button asChild variant="outline" className="w-fit">
          <a href={valuation.docUrl} target="_blank" rel="noreferrer">
            Otwórz dokument operatu
          </a>
        </Button>
      ) : null}
    </div>
  );
}
