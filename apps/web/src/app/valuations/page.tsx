import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSession } from "@/auth/session";
import { signOutAction } from "@/app/actions/sign-out";
import { valuationRepository } from "./_deps";

const STATUS_LABEL: Record<string, string> = {
  in_progress: "Szkic",
  approved: "Zatwierdzony",
  signed: "Podpisany",
};

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

/**
 * List page (Task 9) — RSC. Reads `PortValuation.listForUser`, which
 * enforces ownership isolation (T7): an appraiser sees only their own
 * valuations, an admin sees all.
 */
export default async function ValuationsListPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const isAdmin = session.user.role === "admin";
  const valuations = await valuationRepository.listForUser(session.user);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Wyceny
          </p>
          <h1 className="text-2xl font-semibold text-foreground">
            {isAdmin ? "Wszystkie wyceny biura" : "Twoje wyceny"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/valuations/new">
              <Plus data-icon="inline-start" />
              Nowa wycena
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/profile">Profil</Link>
          </Button>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              Wyloguj
            </Button>
          </form>
        </div>
      </div>

      <Card className="border-none bg-primary/5 py-3 ring-1 ring-primary/15">
        <CardContent className="text-sm text-foreground/80">
          {isAdmin
            ? "Jako administrator widzisz wszystkie wyceny biura."
            : "Jako rzeczoznawca widzisz wyłącznie wyceny przypisane do Ciebie."}
        </CardContent>
      </Card>

      {valuations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-10 text-center text-sm text-muted-foreground">
            <p>Brak wycen do wyświetlenia.</p>
            <p>
              Kliknij „Nowa wycena”, aby utworzyć
              {isAdmin ? " pierwszy operat biura" : " swój pierwszy operat"}.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Adres</TableHead>
                <TableHead className="px-4">Status</TableHead>
                <TableHead className="px-4 text-right">WR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {valuations.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="px-4">
                    <Link
                      href={`/valuations/${v.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {v.address}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4">
                    <Badge
                      variant={
                        v.status === "in_progress"
                          ? "secondary"
                          : v.status === "signed"
                            ? "outline"
                            : "default"
                      }
                      className={
                        v.status === "signed"
                          ? "border-green-600 text-green-700 dark:text-green-500"
                          : undefined
                      }
                    >
                      {STATUS_LABEL[v.status] ?? v.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 text-right tabular-nums">
                    {currencyFormatter.format(v.wr)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
