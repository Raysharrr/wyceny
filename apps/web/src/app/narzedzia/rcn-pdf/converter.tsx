"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { plural } from "@/lib/coop-format";
import { convertRcnPdf } from "@/app/actions/rcn-pdf";
import type { RcnConversion } from "@/ports/rcn-pdf";

/**
 * The whole converter screen (T-22, makiety 3–6): pick a PDF, the conversion
 * starts at once, the result is counters plus a download. There is deliberately
 * NO table preview and no column description (user's decision 19.09) — the
 * appraiser has no say in what gets generated, and reads the outcome in the
 * workbook. What the sheet leaves empty (`RODZAJ BUD`) is explained by the cell
 * comment in the workbook and by the Pomoc page, not by this screen.
 *
 * The download is the app's first from-base64 path: `/api/docs/[key]` authorises
 * through a valuation, and this file belongs to no valuation and is never
 * stored — so the bytes go straight from the reply to a Blob in the browser.
 */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The same sentence the action returns for breakage it catches itself (spec §7.4). */
const FALLBACK = "Nie udało się przetworzyć pliku. Spróbuj ponownie.";

/** Next signals a redirect by throwing; `digest` is how it is recognised across the RSC boundary. */
function isRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

const FILE_WARNING_TEXT: Record<string, string> = {
  lp_gap: "Numeracja transakcji w wydruku ma przerwę — porównaj liczbę wierszy z wydrukiem.",
};

type State =
  | { kind: "idle" }
  | { kind: "pending"; name: string }
  | { kind: "done"; name: string; result: RcnConversion }
  | { kind: "failed"; name: string; message: string };

/**
 * The order number is parsed out of an uploaded PDF, so it is untrusted text in
 * a file name (review 1 R6). Anything outside word characters, dot and dash
 * collapses to `_`; a number that was only punctuation or blanks falls back to
 * a fixed name rather than producing "   .xlsx".
 */
function fileName(orderNumber: string): string {
  const safe = orderNumber.replace(/[^\w.-]+/g, "_").replace(/^[_.]+|_+$/g, "");
  return `${safe || "wydruk-rcn"}.xlsx`;
}

function download(result: RcnConversion) {
  const bytes = Uint8Array.from(atob(result.xlsxBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(result.orderNumber);
  // In the document and revoked a tick later (review 1 R5): WebKit and Firefox
  // can abort a download whose anchor was never in the DOM, or whose object URL
  // is revoked in the same task as the click. The office may well be on Safari,
  // and no gate of ours runs anything but Chromium.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function RcnConverter() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function onFile(file: File | null) {
    if (!file) return;
    setState({ kind: "pending", name: file.name });
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      try {
        const outcome = await convertRcnPdf(formData);
        setState(
          "result" in outcome
            ? { kind: "done", name: file.name, result: outcome.result }
            : { kind: "failed", name: file.name, message: outcome.error },
        );
      } catch (err) {
        // The action itself can reject, not just return an error: a file over
        // the Server Action body limit, a dead session store, a deploy in
        // flight. Without this the screen would sit in "Odczytywanie
        // transakcji…" for ever. A redirect is NOT an error — Next signals an
        // expired session by throwing one, and swallowing it would strand the
        // appraiser on a screen that can no longer work.
        if (isRedirect(err)) throw err;
        setState({ kind: "failed", name: file.name, message: FALLBACK });
      }
    });
  }

  const picked = state.kind === "idle" ? null : state.name;

  return (
    <div className="flex flex-col gap-5">
      {state.kind === "failed" ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      {state.kind === "done" ? (
        <Result result={state.result} onReset={() => setState({ kind: "idle" })} />
      ) : (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-semibold">Plik z portalu</h2>
            <span className="text-xs text-muted-foreground">PDF „WYDRUK Z RCN”</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <FileInput
              name="file"
              accept="application/pdf"
              aria-label="Plik PDF"
              label={picked ? "Zmień plik" : "Wybierz plik"}
              hint={picked ?? "PDF, do 4 MB"}
              showSelected={false}
              disabled={state.kind === "pending"}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                // Forget the pick straight away: after a refusal the appraiser
                // may well choose the SAME file again (re-downloaded, renamed),
                // and an unchanged input value fires no second change event.
                e.target.value = "";
                onFile(file);
              }}
            />
            {state.kind === "pending" ? (
              <span aria-live="polite" className="text-sm text-muted-foreground">
                Odczytywanie transakcji…
              </span>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

function Result({ result, onReset }: { result: RcnConversion; onReset: () => void }) {
  const { count, flaggedRows, orderNumber, unit, fileWarnings } = result;
  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--accent-100)] bg-[var(--accent-050)] p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-[var(--accent-700)]">
          <Check className="size-4" />
          Odczytano {count} {plural(count, "transakcję", "transakcje", "transakcji")}.
        </p>
        <p data-testid="rcn-result-summary">
          Zamówienie <span className="font-mono text-[13px]">{orderNumber}</span> · {unit}.
          {flaggedRows > 0
            ? ` ${flaggedRows} ${plural(flaggedRows, "wiersz wymaga", "wiersze wymagają", "wierszy wymaga")} sprawdzenia — w arkuszu ma żółte tło i komentarz.`
            : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => download(result)}>
            <Download data-icon="inline-start" />
            Pobierz plik XLSX
          </Button>
          <Button type="button" variant="outline" onClick={onReset}>
            Wgraj inny plik
          </Button>
        </div>
      </div>
      {fileWarnings.length > 0 ? (
        <div
          role="status"
          data-testid="rcn-file-warnings"
          className="flex flex-col gap-2 rounded-lg border border-[#ecd9a6] bg-[#fbf2dd] p-4 text-sm text-[#b07a16]"
        >
          {fileWarnings.map((code) => (
            <p key={code} className="flex items-start gap-2 font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{FILE_WARNING_TEXT[code] ?? code}</span>
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}
