import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/auth/session";
import { computeKcs, type KcsInput } from "@/domain/kcs";
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

const plnPerM2 = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

const RATING_LABEL: Record<string, string> = {
  gorsza: "gorsza",
  przecietna: "przeciętna",
  lepsza: "lepsza",
};

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

function KcsBreakdown({ inputs }: { inputs: KcsInput }) {
  const r = computeKcs(inputs);
  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        {/* T2 — ceny jednostkowe */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Ceny jednostkowe próby (T2)</h2>
          <dl className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-muted-foreground">Cmin</dt>
              <dd>{plnPerM2.format(r.cmin)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cmax</dt>
              <dd>{plnPerM2.format(r.cmax)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cśr</dt>
              <dd>{plnPerM2.format(r.csr)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vmin</dt>
              <dd>{r.vmin.toFixed(3)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vmax</dt>
              <dd>{r.vmax.toFixed(3)}</dd>
            </div>
          </dl>
        </section>
        {/* T3 — współczynniki korygujące */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Współczynniki korygujące (T3)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Cecha</th>
                <th className="py-1 font-medium">Waga</th>
                <th className="py-1 font-medium">Ocena</th>
                <th className="py-1 text-right font-medium">Ui</th>
              </tr>
            </thead>
            <tbody>
              {r.ui.map((u) => (
                <tr key={u.name} className="border-t border-border">
                  <td className="py-1">{u.name}</td>
                  <td className="py-1">{Math.round(u.weight * 100)}%</td>
                  <td className="py-1">{RATING_LABEL[u.rating]}</td>
                  <td className="py-1 text-right tabular-nums">{u.value.toFixed(4)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="py-1" colSpan={3}>
                  Suma współczynników (ΣUi)
                </td>
                <td className="py-1 text-right tabular-nums">{r.sumUi.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        {/* T4 — wartość rynkowa */}
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="text-sm font-semibold text-foreground">Wartość rynkowa (T4)</h2>
          <p className="text-muted-foreground">
            WR = Cśr × ΣUi × P = {plnPerM2.format(r.unitValue)}/m² × {inputs.area} m²
          </p>
          <p className="font-medium text-foreground">
            {plnPerM2.format(r.wrUnrounded)} → po zaokrągleniu{" "}
            <span className="text-primary">{plnPerM2.format(r.wr)}</span>
          </p>
        </section>
      </CardContent>
    </Card>
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

      {valuation.inputs ? <KcsBreakdown inputs={valuation.inputs} /> : null}

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
