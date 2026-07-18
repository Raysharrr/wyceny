"use client";

import { Controller, useWatch, type Control } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { valuationFormSchema } from "@/lib/valuation-form-schema";

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

export type KwSource = "akt" | "odpis_kw" | "reczny";

export type KwFetchState =
  | { status: "idle" | "loading" }
  | { status: "done"; summary: string; typeMismatch: boolean }
  | { status: "invalidDoc"; message: string }
  | { status: "error"; message: string };

interface KwSectionProps {
  control: Control<FormInput, unknown, FormOutput>;
  state: KwFetchState;
  source: KwSource;
  onSourceChange: (source: KwSource) => void;
  onFileSelected: (file: File) => void;
  onRetry: () => void;
  onUseDocumentArea: () => void;
  areaMismatch: { form: number; doc: number } | null;
}

const nf = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCES: Array<{ value: KwSource; label: string }> = [
  { value: "akt", label: "Wgraj akt notarialny" },
  { value: "odpis_kw", label: "Wgraj odpis KW" },
  { value: "reczny", label: "Wpisz ręcznie" },
];

// Mirrors `NEXT_PUBLIC_SUBJECT_AUTOFETCH`: the upload buttons/file input render
// only when enabled; the manual (reczny) path is always available so the e2e
// smoke and any air-gapped deployment keep working.
const uploadEnabled = process.env.NEXT_PUBLIC_KW_UPLOAD !== "off";

function KwFetchStatusBar({ state, onRetry }: { state: KwFetchState; onRetry: () => void }) {
  // `switch` (not an if-chain): TS doesn't narrow away the two-literal
  // `{ status: "idle" | "loading" }` member across sequential equality checks,
  // but narrows correctly per `case` (same pattern as SubjectFetchStatusBar).
  switch (state.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <p data-testid="kw-fetch-status" className="text-sm text-muted-foreground">
          ⏳ Odczytuję dokument (może potrwać do pół minuty)…
        </p>
      );
    case "done":
      return (
        <div className="flex flex-col gap-1">
          <p data-testid="kw-fetch-status" className="text-sm text-muted-foreground">
            ✓ Odczytano: {state.summary} — do potwierdzenia
          </p>
          {state.typeMismatch ? (
            <p data-testid="kw-type-mismatch" className="text-sm text-amber-600">
              ⚠ Dokument wygląda na inny typ niż wybrany — dane wypełniono według typu wykrytego.
            </p>
          ) : null}
        </div>
      );
    case "invalidDoc":
      return (
        <p data-testid="kw-fetch-status" className="text-sm text-muted-foreground">
          ℹ {state.message}
        </p>
      );
    case "error":
      return (
        <div data-testid="kw-fetch-status" className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-amber-600">⚠ {state.message}</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Spróbuj ponownie
          </Button>
        </div>
      );
  }
}

// The document-sourced text fields. `kw.kwLokalu` is special-cased below: it's
// disabled when the "zakup deweloperski" checkbox is set (the lokal has no own
// KW — the data comes from the mother book of the grunt).
const EXTRACT_TEXT_FIELDS = [
  { name: "kw.kwLokalu", id: "kw-lokalu", label: "Nr KW lokalu" },
  { name: "kw.kwGruntu", id: "kw-gruntu", label: "Nr KW gruntu (księga macierzysta)" },
  { name: "kw.udzial", id: "kw-udzial", label: "Udział w nieruchomości wspólnej" },
  { name: "kw.sad", id: "kw-sad", label: "Sąd rejonowy" },
  { name: "kw.wydzial", id: "kw-wydzial", label: "Wydział ksiąg wieczystych" },
] as const;

const DZIAL_FIELDS = [
  {
    name: "kw.dzial3",
    tresc: "kw.dzial3.tresc",
    id: "kw-dzial3",
    label: "Dział III — prawa, roszczenia i ograniczenia",
  },
  { name: "kw.dzial4", tresc: "kw.dzial4.tresc", id: "kw-dzial4", label: "Dział IV — hipoteki" },
] as const;

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * "Stan prawny (KW)" section (Slice 6, mockup v3-r4 KwSourcePicker).
 * Presentation-only: upload/fetch/reset logic lives in the parent form —
 * this mirrors the SubjectSection split so RTL tests need no network. The UI
 * `source` prop ("akt"|"odpis_kw"|"reczny") is distinct from the extract's
 * own `kw.source` ("akt"|"odpis_kw"); "reczny" means no extract, flat kwNumber.
 */
export function KwSection(props: KwSectionProps) {
  const { control, state, source, onSourceChange } = props;
  // Single subscription to the whole `kw` subtree. `hasExtract` gates the
  // editable extract fields: they mount ONLY once a real extract exists (from
  // an upload, or a harness default). Mounting them earlier would register
  // `kw.kwLokalu` etc. and turn `kw` into a truthy-but-invalid object — which
  // fools the schema's `!kw` manual-vs-document check, silently swallowing the
  // "no document, no number" issue in upload mode (the W4 dead-end).
  const kw = useWatch({ control, name: "kw" });
  const hasExtract = !!kw;
  const deweloperski = kw?.deweloperski;
  const dzialPresent: Record<string, boolean> = {
    "kw.dzial3": !!kw?.dzial3,
    "kw.dzial4": !!kw?.dzial4,
  };

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">Stan prawny (KW)</legend>

      <div className="flex flex-wrap gap-2">
        {SOURCES.filter((s) => uploadEnabled || s.value === "reczny").map((s) => (
          <Button
            key={s.value}
            type="button"
            variant={source === s.value ? "default" : "outline"}
            onClick={() => onSourceChange(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {source !== "reczny" && uploadEnabled ? (
        <input
          type="file"
          accept="application/pdf"
          aria-label="Plik dokumentu (PDF)"
          data-testid="kw-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onFileSelected(file);
          }}
        />
      ) : null}

      <KwFetchStatusBar state={state} onRetry={props.onRetry} />

      {/* kwNumber stays registered in both modes: the manual input in "reczny",
          and (upload mode) the visible surface for the schema's silent
          "no document, no number" issue (W4). */}
      <Controller
        control={control}
        name="kwNumber"
        render={({ field, fieldState }) =>
          source === "reczny" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="kwNumber" className="text-sm">
                Numer księgi wieczystej
              </label>
              <Input id="kwNumber" autoComplete="off" {...field} value={field.value ?? ""} />
              {fieldState.error ? (
                <p className="text-sm text-destructive">{fieldState.error.message}</p>
              ) : null}
            </div>
          ) : fieldState.error ? (
            <p data-testid="kw-upload-error" className="text-sm text-destructive">
              Wgraj dokument albo przełącz na wpis ręczny.
            </p>
          ) : (
            <span />
          )
        }
      />

      {source !== "reczny" && hasExtract ? (
        <>
          <Controller
            control={control}
            name="kw.deweloperski"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="kw-deweloperski"
                  checked={field.value ?? false}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
                <label htmlFor="kw-deweloperski" className="text-sm">
                  Lokal bez własnej KW (zakup deweloperski) — dane z księgi macierzystej
                </label>
              </div>
            )}
          />

          {deweloperski ? (
            <p
              data-testid="kw-developer-banner"
              className="rounded-md border border-amber-500 bg-amber-500/10 p-2 text-sm"
            >
              Lokal bez własnej KW (zakup deweloperski) — dane z księgi macierzystej gruntu.
            </p>
          ) : null}

          {EXTRACT_TEXT_FIELDS.map((f) => (
            <Controller
              key={f.name}
              control={control}
              name={f.name}
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <label htmlFor={f.id} className="text-sm">
                    {f.label}
                  </label>
                  <Input
                    id={f.id}
                    autoComplete="off"
                    {...field}
                    disabled={f.name === "kw.kwLokalu" && !!deweloperski}
                    value={field.value == null ? "" : String(field.value)}
                  />
                </div>
              )}
            />
          ))}

          {DZIAL_FIELDS.filter((d) => dzialPresent[d.name]).map((d) => (
            <Controller
              key={d.tresc}
              control={control}
              name={d.tresc}
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <label htmlFor={d.id} className="text-sm">
                    {d.label}
                  </label>
                  <textarea
                    id={d.id}
                    className={textareaClass}
                    value={(Array.isArray(field.value) ? field.value : []).join("\n")}
                    onChange={(e) => field.onChange(e.target.value.split("\n"))}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  />
                </div>
              )}
            />
          ))}

          {props.areaMismatch ? (
            <div
              data-testid="kw-area-mismatch"
              className="flex flex-col gap-2 rounded-md border border-amber-500 bg-amber-500/10 p-2 text-sm"
            >
              <p>
                Powierzchnia w formularzu ({nf.format(props.areaMismatch.form)} m²) różni się od
                powierzchni w dokumencie ({nf.format(props.areaMismatch.doc)} m²).
              </p>
              <Button type="button" variant="outline" onClick={props.onUseDocumentArea}>
                Użyj wartości z dokumentu
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
