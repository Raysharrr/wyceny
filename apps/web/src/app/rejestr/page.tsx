import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { getSession } from "@/auth/session";
import { coopRegistry } from "@/app/valuations/_deps";
import { Button } from "@/components/ui/button";
import { fmtDate, plural } from "@/lib/coop-format";
import { PERIODS, RegistryFilters, type PeriodKey } from "./registry-filters";
import { periodFrom } from "./period";
import { RegistryTable } from "./registry-table";

export const dynamic = "force-dynamic";

const PAGE = 50;

/**
 * `/rejestr` (T-13, S2b Task 2; makieta RejestrLista): one register for the
 * whole office. Filters and paging are URL state; the port's `hasMore` drives
 * "Pokaż więcej", and `truncated` — the 5 000-row ceiling — is said out loud.
 */
export default async function RejestrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const okres = (PERIODS.some((p) => p.key === one("okres")) ? one("okres") : "24m") as PeriodKey;
  const sm = one("sm");
  const q = one("q");
  const needsFix = one("lokalizacja") === "do-poprawki";
  const pages = Math.max(1, Number.parseInt(one("strona") || "1", 10) || 1);

  const [stats, list] = await Promise.all([
    coopRegistry.stats(),
    coopRegistry.list(
      {
        cooperative: sm || undefined,
        from: periodFrom(okres),
        text: q || undefined,
        needsFix: needsFix || undefined,
        limit: PAGE * pages,
        offset: 0,
      },
      session.user,
    ),
  ]);
  const cooperatives = Object.keys(stats.byCooperative).sort((a, b) => a.localeCompare(b, "pl"));
  const moreHref = (() => {
    const next = new URLSearchParams();
    if (sm) next.set("sm", sm);
    if (okres !== "24m") next.set("okres", okres);
    if (q) next.set("q", q);
    if (needsFix) next.set("lokalizacja", "do-poprawki");
    next.set("strona", String(pages + 1));
    return `/rejestr?${next.toString()}`;
  })();

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
            Rejestr
          </p>
          <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">
            Rejestr spółdzielczy
          </h1>
          <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">
            Jeden rejestr transakcji dla całego biura. Spółdzielnia jest atrybutem transakcji, nie
            osobnym zbiorem.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/rejestr/transakcja">
              <Plus data-icon="inline-start" />
              Dodaj transakcję
            </Link>
          </Button>
          <Button asChild>
            <Link href="/rejestr/import">
              <Upload data-icon="inline-start" />
              Importuj XLS
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Tile label="Łącznie transakcji">
          <span className="font-mono text-2xl font-semibold">{stats.total}</span>
        </Tile>
        <Tile label="Spółdzielnie">
          <span className="text-sm leading-6">
            {cooperatives.length === 0
              ? "—"
              : cooperatives.map((c, i) => (
                  <span key={c}>
                    {i > 0 ? " · " : ""}
                    {c} <b className="font-mono">{stats.byCooperative[c]}</b>
                  </span>
                ))}
          </span>
        </Tile>
        <Tile label="Ostatni import">
          {stats.lastImport ? (
            <>
              <span className="font-mono text-lg font-semibold">
                {fmtDate(stats.lastImport.at)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {stats.lastImport.file} · {stats.lastImport.rows}{" "}
                {plural(stats.lastImport.rows, "wiersz", "wiersze", "wierszy")}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">jeszcze nie było</span>
          )}
        </Tile>
        <Tile label="Do poprawki" warn>
          <span className="text-sm leading-6">
            <b className="font-mono">{stats.needsGeocoding}</b>{" "}
            {plural(stats.needsGeocoding, "adres", "adresy", "adresów")} bez lokalizacji — nie wejdą
            do doboru po promieniu.{" "}
            <Link href="/rejestr?lokalizacja=do-poprawki&okres=all" className="underline">
              Pokaż
            </Link>
          </span>
        </Tile>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <RegistryFilters cooperatives={cooperatives} value={{ sm, okres, q }} />
        {needsFix ? (
          <p className="mt-3 text-sm text-[#b07a16]">
            Pokazano tylko wiersze bez lokalizacji.{" "}
            <Link href="/rejestr" className="underline">
              Pokaż wszystkie
            </Link>
          </p>
        ) : null}
      </div>

      {list.truncated ? (
        <p className="rounded-lg border border-[#ecd9a6] bg-[#fbf2dd] px-4 py-2 text-sm text-[#b07a16]">
          Lista jest niekompletna — rejestr ma więcej niż 5 000 wierszy spełniających filtry. Zawęź
          spółdzielnię, okres albo wyszukiwanie.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <RegistryTable rows={list.rows} />
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Pokazano {list.rows.length} z {list.total} · sortowanie: data malejąco
        </span>
        {list.hasMore ? (
          <Button asChild variant="outline" size="sm">
            <Link href={moreHref}>Pokaż więcej</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Tile({
  label,
  warn,
  children,
}: {
  label: string;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        warn
          ? "rounded-xl border border-[#ecd9a6] bg-[#fbf2dd] p-4 text-[#b07a16]"
          : "rounded-xl border border-border bg-card p-4"
      }
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
