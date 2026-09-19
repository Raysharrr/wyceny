"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { rcnPdf } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { mintWorkerToken } from "@/lib/worker-token";
import { withTrace } from "@/lib/trace";
import { RcnPdfError, type RcnConversion, type RcnRefusal } from "@/ports/rcn-pdf";

/**
 * The one Server Action behind `/narzedzia/rcn-pdf` (T-22), shaped like
 * `readCoopSheet`: session → token → port. Nothing is written anywhere — the
 * workbook travels back to the browser in the reply and is never stored, never
 * attached to a valuation.
 */
const REFUSAL_TEXT: Record<RcnRefusal, string> = {
  no_text_layer:
    "To jest skan — plik nie ma warstwy tekstowej. Pobierz wydruk z portalu jako PDF, nie skanuj wydruku papierowego.",
  not_rcn_printout:
    "Nie rozpoznaję tego układu. Narzędzie czyta wydruki „WYDRUK Z RCN” z portalu GEO-INFO i.Rzeczoznawca — wgraj PDF pobrany z zakładki Zamówienia.",
  no_transactions: "W pliku nie ma żadnej transakcji.",
};
const STATUS_TEXT: Record<number, string> = {
  413: "Plik jest za duży (limit 4 MB).",
  415: "To nie jest plik PDF.",
};
const FALLBACK = "Nie udało się przetworzyć pliku. Spróbuj ponownie.";
const NOT_CONFIGURED = "Narzędzie nie jest skonfigurowane — skontaktuj się z administratorem.";

export async function convertRcnPdf(
  formData: FormData,
): Promise<{ result: RcnConversion; error?: undefined } | { error: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  const file = formData.get("file");
  // Duck-typed: the runtime's File class may differ from the global one across the RSC boundary.
  if (!file || typeof file === "string" || file.size === 0) return { error: "Wybierz plik PDF." };
  const token = mintWorkerToken();
  if (!token) return { error: NOT_CONFIGURED };
  return withTrace(async () => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { result: await rcnPdf.convert({ bytes, name: file.name }, token) };
    } catch (err) {
      if (err instanceof RcnPdfError) {
        // A refused file is a statement about the PDF, not a fault of ours —
        // it belongs on the screen, not in the event log.
        const text = err.code ? REFUSAL_TEXT[err.code] : STATUS_TEXT[err.status];
        if (text) return { error: text };
      }
      await recordFailure({ event: "rcn_pdf.failed", error: err, actorId: session.user.id });
      return { error: FALLBACK };
    }
  });
}
