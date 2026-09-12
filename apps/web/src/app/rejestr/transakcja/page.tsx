import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { coopRegistry } from "@/app/valuations/_deps";
import { TransactionForm } from "./transaction-form";

export const dynamic = "force-dynamic";

/** `/rejestr/transakcja` (T-13, S2b Task 6; makieta RejestrFormularz). */
export default async function RejestrTransakcjaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const stats = await coopRegistry.stats();
  const cooperatives = Object.keys(stats.byCooperative).sort((a, b) => a.localeCompare(b, "pl"));
  return (
    <div className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col gap-5 px-6 py-10">
      <div>
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
          Rejestr spółdzielczy
        </p>
        <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">Dodaj transakcję</h1>
        <p className="max-w-[80ch] text-[14.5px] text-muted-foreground">
          Te same pola co przy imporcie z pliku — do pojedynczej transakcji, której nie ma w wykazie
          ze spółdzielni. Spółdzielnia jest atrybutem tej transakcji, nie osobnym rejestrem.
        </p>
      </div>
      <TransactionForm cooperatives={cooperatives} />
    </div>
  );
}
