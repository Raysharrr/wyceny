import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { RcnConverter } from "./converter";

export const dynamic = "force-dynamic";

/** `/narzedzia/rcn-pdf` (T-22, makiety 3–6) — a tool beside the valuation flow: PDF in, XLSX out, nothing stored. */
export default async function RcnPdfPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-6 pb-10 pt-5">
      <div>
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
          Narzędzia
        </p>
        <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">
          Wydruk z RCN → Excel
        </h1>
        <p className="max-w-[80ch] text-[14.5px] text-muted-foreground">
          Wgraj wydruk transakcji pobrany z portalu i.Rzeczoznawca. Program przepisze go do arkusza
          w układzie, którego używa biuro — niczego nie interpretuje i nigdzie nie zapisuje pliku.
        </p>
      </div>
      <RcnConverter />
    </div>
  );
}
