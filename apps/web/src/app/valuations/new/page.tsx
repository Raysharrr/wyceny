import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { NewValuationForm } from "./new-valuation-form";

// The "Pobierz próbę z RCN" button calls a live worker fetch (typically
// 5-10s, worst case ~25s per the worker's own timeouts) — raise the
// platform's function timeout so it never cuts the request off before the
// worker's Polish error message has a chance to surface.
export const maxDuration = 60;

export default async function NewValuationPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Wyceny</p>
        <h1 className="text-2xl font-semibold text-foreground">Nowa wycena</h1>
        <p className="text-sm text-muted-foreground">
          Podaj adres nieruchomości i powierzchnię — wartość rynkową i operat przygotuje system.
        </p>
      </div>
      <NewValuationForm />
    </div>
  );
}
