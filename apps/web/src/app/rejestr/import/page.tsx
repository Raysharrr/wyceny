import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { coopRegistry } from "@/app/valuations/_deps";
import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

/** `/rejestr/import` (T-13, S2b Tasks 3–5; makieta RejestrImport): three steps, one cooperative per file. */
export default async function RejestrImportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const stats = await coopRegistry.stats();
  const cooperatives = Object.keys(stats.byCooperative).sort((a, b) => a.localeCompare(b, "pl"));
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-6 py-10">
      <div>
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
          Rejestr spółdzielczy
        </p>
        <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">
          Import transakcji z pliku XLS
        </h1>
        <p className="max-w-[80ch] text-[14.5px] text-muted-foreground">
          Wiersze dopiszą się do wspólnego rejestru biura. Wskaż spółdzielnię dla całego pliku i to,
          która kolumna odpowiada któremu polu aplikacji — mapowanie zapamiętamy dla tej
          spółdzielni.
        </p>
      </div>
      <ImportWizard cooperatives={cooperatives} />
    </div>
  );
}
