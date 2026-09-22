"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useState } from "react";
import { Controller, useController, useWatch, type Control } from "react-hook-form";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { AutoBanner } from "@/components/wizard/auto-banner";
import { SectionCard } from "@/components/wizard/section-card";
import { cn } from "@/lib/utils";
import { parseCoopNumber } from "@/domain/coop-import";
import { kwRequirements } from "@/domain/kw-requirements";
import { PROPERTY_RIGHT_LABEL, PROPERTY_RIGHTS } from "@/domain/property-right";
import { valuationFormSchema } from "@/lib/valuation-form-schema";

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

/** Klucz sekcji księgi LOKALU: kanał albo akt (ADR-021 — ścieżki ręcznej nie ma). */
export type KwSource = "akt" | "odpis_kw" | "ekw_wklej";
/** Klucz sekcji księgi GRUNTU: tylko kanał — grunt nie ma aktu. */
export type KwKanalUi = "odpis_kw" | "ekw_wklej";

export type KwFetchState =
  | { status: "idle" | "loading" }
  | { status: "done"; summary: string; typeMismatch: boolean }
  | { status: "invalidDoc"; message: string }
  | { status: "error"; message: string };

/**
 * How the transcription of ONE book went (ADR-021). Separate from
 * `KwFetchState` because the two reads fail independently and mean different
 * things: the field read failing means the document was not read at all, this
 * one failing means there is no content to print.
 *
 * There is no `invalid` member any more: a verdict that refused to vouch for
 * the content lives PRZY migawce (`kw.transkrypcja`), so its banner survives
 * leaving and re-entering step 1 — section state would not.
 */
export type KwTranscribeState =
  | { status: "idle" | "loading" }
  | { status: "ok"; dzialy: string[] }
  | { status: "failed"; code: string };

/** Co karta jednej księgi dostaje od rodzica — te same kanały dla obu ksiąg (R2). */
export interface KwBookProps<S extends string> {
  source: S;
  transcribe: KwTranscribeState;
  onSourceChange: (source: S) => void;
  onFiles: (files: File[]) => void;
  onTekst: (tekst: string) => void;
}

export interface KwSectionProps {
  control: Control<FormInput, unknown, FormOutput>;
  lokal: KwBookProps<KwSource> & { state: KwFetchState; onRetry: () => void };
  grunt: KwBookProps<KwKanalUi>;
  onUseDocumentArea: () => void;
  areaMismatch: { form: number; doc: number } | null;
  /**
   * Today, as the default examination date. A book never prints when it was
   * read, so that date can only come from the appraiser — this is the default
   * they overwrite, injected rather than read off the clock so tests can pin it.
   */
  today?: string;
}

const nf = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Tile styling shared by the property-right radio (T-12) and the encumbrance
// choice — the mockup's `.ds-tile`.
const TILE = "h-auto flex-col items-start gap-0.5 whitespace-normal rounded-lg px-4 py-3 text-left";
const TILE_SELECTED = "border-primary bg-[var(--accent-050)]";
const TILE_IDLE = "border-border bg-background";

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/** ISO day in the appraiser's own timezone — `toISOString()` would shift it. */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Two small buttons glued into one control (mockup `SegmentedChoice`): a book's
 * data source, and the Brak wpisów / Są wpisy answer for a dział. A radiogroup
 * rather than a checkbox pair because exactly one is true — and because
 * "neither chosen yet" has to stay expressible (`value === null`), which is
 * what keeps an unexamined dział out of the operat.
 */
function SegmentedChoice<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
}: {
  label?: string;
  labelledBy?: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className="flex w-fit rounded-lg border border-border p-0.5"
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            variant="ghost"
            size="sm"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md",
              selected && "bg-[var(--accent-050)] text-[var(--accent-700)]",
            )}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}

/** One book's card (mockup `KwBookCard`) — title, examined badge, its own fields. */
function KwBookCard({
  title,
  examined,
  head,
  testId,
  children,
}: {
  title: string;
  examined: boolean;
  head?: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <Badge
            variant="outline"
            className={
              examined
                ? "border-[var(--accent-100)] bg-[var(--accent-050)] text-[var(--accent-700)]"
                : "border-[var(--amber-line)] text-[var(--amber)]"
            }
          >
            {examined ? "Zbadana" : "Do zbadania"}
          </Badge>
        </div>
        {head}
      </div>
      {children}
    </div>
  );
}

/** Label + input, in the mockup's two-column field grid. */
function TextField({
  id,
  label,
  value,
  onChange,
  className,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Input
        id={id}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * A numeric field whose STATE is the text that was typed, not the number it
 * parses to. Holding the number re-rendered "44," back as "44" between two
 * keystrokes, so the separator disappeared and "44,23" was stored as 4423
 * (staging, 16.09) — then the form warned that it disagreed with the document.
 * The two other numeric fields in the app (`subject-form`, the coop register)
 * both keep text for the same reason.
 *
 * Parsing goes through the register's own parser, which reads "48,10" and
 * "521 885,00" and refuses ambiguous "1.234" rather than guessing. A trailing
 * unit is stripped first: that parser keeps every digit it finds, so "44,23 m2"
 * pasted off a book would otherwise become 44,232 — a wrong number, quietly,
 * which is worse than refusing the input.
 *
 * The draft yields to the model only on a change from OUTSIDE (a KW PDF being
 * transcribed): after our own edit `value` already equals what the draft
 * parses to, so the comparison leaves the text alone.
 */
function NumberTextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const asText = (n: number | null) => (n == null ? "" : String(n));
  const [draft, setDraft] = useState(() => asText(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parseCoopNumber(draft) !== value) setDraft(asText(value));
  }
  return (
    <TextField
      id={id}
      label={label}
      value={draft}
      onChange={(v) => {
        setDraft(v);
        const withoutUnit = v.replace(/\s*m\s*[²2]\s*$/i, "");
        onChange(withoutUnit.trim() === "" ? null : parseCoopNumber(withoutUnit));
      }}
    />
  );
}

const ENCUMBRANCE_OPTIONS = [
  { value: "z_uwzglednieniem", strong: "z uwzględnieniem" },
  { value: "bez_uwzglednienia", strong: "bez uwzględnienia" },
] as const;

/**
 * B-07 (ADR-018 reg. 6). An entry in dział III of the LOKAL's book is not a
 * problem the app can solve — it is a decision the appraiser has to state, and
 * the operat prints it in §2, §3, §8.2 and §10.1. `podstawa` is required in
 * both variants, which is why it sits inside this block rather than beside it.
 */
function EncumbranceChoice({
  value,
  onChange,
}: {
  value: { wariant?: string | null; podstawa?: string } | null | undefined;
  onChange: (value: { wariant: string | null; podstawa: string }) => void;
}) {
  return (
    <div
      data-testid="kw-encumbrance"
      className="flex flex-col gap-3 rounded-lg border border-[var(--amber-line)] bg-[var(--amber-bg)] p-4"
    >
      <p className="text-[13.5px] text-[var(--amber)]">
        <strong>Księga lokalu ma wpis w dziale III.</strong> Wskaż, czy wartość uwzględnia to
        obciążenie.
      </p>
      <div
        role="radiogroup"
        aria-label="Uwzględnienie obciążenia"
        className="grid gap-2 sm:grid-cols-2"
      >
        {ENCUMBRANCE_OPTIONS.map((o) => {
          const selected = value?.wariant === o.value;
          return (
            <Button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              variant="outline"
              onClick={() => onChange({ wariant: o.value, podstawa: value?.podstawa ?? "" })}
              className={cn(TILE, selected ? TILE_SELECTED : TILE_IDLE)}
            >
              <span className="text-sm font-medium text-foreground">
                Wartość <strong>{o.strong}</strong> obciążenia
              </span>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="kw-encumbrance-podstawa" className="text-sm">
          Podstawa
        </label>
        <textarea
          id="kw-encumbrance-podstawa"
          className={textareaClass}
          placeholder="np. Zgodnie z poleceniem Zleceniodawcy obciążenie nie zostaje uwzględnione, ponieważ …"
          value={value?.podstawa ?? ""}
          onChange={(e) => onChange({ wariant: value?.wariant ?? null, podstawa: e.target.value })}
        />
      </div>
    </div>
  );
}

/**
 * The shape `kwSchema` demands, WITHOUT `source` — a snapshot is built whole,
 * never field by field, and the source is whichever channel wrote it (ADR-021).
 */
export const EMPTY_KW_FIELDS = {
  kwLokalu: null,
  kwGruntu: null,
  kwInne: [],
  deweloperski: false,
  powUzytkowaKw: null,
  udzial: null,
  sad: null,
  wydzial: null,
  dataDokumentu: null,
  dzial3: null,
  dzial4: null,
};

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
    // A failed read is a failed operation, not a warning about the data — hence
    // `error` and its `role="alert"` (spec §12a). The retry button stays beside
    // it: the commonest cause is a timeout, not a bad file.
    case "error":
      return (
        <div data-testid="kw-fetch-status" className="flex flex-col gap-2">
          <AutoBanner kind="error">
            Nie udało się odczytać pliku PDF księgi — wgraj inny plik albo wpisz dane ręcznie.
          </AutoBanner>
          {/* The cause, under the guidance: "wgraj inny plik" is useless advice
              if the appraiser cannot tell a timeout from a 40 MB scan. */}
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onRetry}>
            Spróbuj ponownie
          </Button>
        </div>
      );
  }
}

/**
 * Why the transcription is missing, in the appraiser's terms — the worker's
 * error classes, which are the only thing that crosses the boundary (the
 * detail text does not: it could quote the model, and the model was reading a
 * book full of names and PESELs — F-13).
 *
 * NEW COPY, not in the mockup (§3 of the handoff): the mockup has no
 * transcription state at all. Proposed for the user's acceptance in the PR.
 */
const TRANSCRIBE_FAILED_TEXT: Record<string, string> = {
  kw_transkrypcja_ucieta:
    "Treść księgi jest zbyt obszerna, żeby przepisać ją w całości — operat opisze działy na podstawie wpisanych pól, bez pełnej treści.",
  kw_transkrypcja_nieczytelna:
    "Nie udało się przepisać treści działów z tego pliku — operat opisze działy na podstawie wpisanych pól, bez pełnej treści.",
  kw_transkrypcja_blad:
    "Nie udało się przepisać treści działów — odczytane pola zostają, a operat opisze działy bez pełnej treści. Wgraj plik ponownie, jeśli chcesz mieć w operacie treść księgi.",
};

/** The banner for the transcription. Nothing renders for `idle`/`ok`: a book read in full needs no announcement. */
function KwTranscribeStatus({ state }: { state: KwTranscribeState }) {
  switch (state.status) {
    case "idle":
    case "ok":
      return null;
    case "loading":
      return (
        <p data-testid="kw-transcribe-status" className="text-sm text-muted-foreground">
          ⏳ Przepisuję pełną treść działów księgi (może potrwać do dwóch minut)…
        </p>
      );
    // `warn`, not `error`: the file WAS read — the mockup's error banner ("Nie
    // udało się odczytać pliku PDF księgi") would be a false statement here.
    // What is left is the manual path's consequence, so it gets the manual
    // path's weight (spec §12a: warn = "wymaga uwagi, decyzja rzeczoznawcy").
    case "failed":
      return (
        <AutoBanner kind="warn">
          <span data-testid="kw-transcribe-warn">
            {TRANSCRIBE_FAILED_TEXT[state.code] ?? TRANSCRIBE_FAILED_TEXT.kw_transkrypcja_blad}
          </span>
        </AutoBanner>
      );
  }
}

const BOOK_SOURCE_OPTIONS = [
  { value: "ekw_wklej", label: "Wklej z przeglądarki KW" },
  { value: "odpis_kw", label: "Wgraj PDF" },
] as const;

/**
 * TYMCZASOWY panel wklejania (S3a): pole na treść z przeglądarki KW i przycisk,
 * który oddaje ją rodzicowi. Wygląd wg makiet — licznik działów, podpowiedź o
 * pięciu zakładkach, obsługa `paste` z HTML-a — robi Task 4 w sesji S3b; tu
 * chodzi wyłącznie o to, żeby kanał tekstowy był przejezdny dla obu ksiąg.
 */
function KwWklejPanelTymczasowy({ onTekst }: { onTekst: (tekst: string) => void }) {
  const [tekst, setTekst] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="Treść z przeglądarki KW"
        className={textareaClass}
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onTekst(tekst)}
      >
        Przepisz treść księgi
      </Button>
    </div>
  );
}

/**
 * "Księga wieczysta" — the property right, then the examination of both books
 * (ADR-018, ADR-021). Presentation-only: upload/fetch/reset logic lives in the
 * parent form, mirroring the SubjectSection split so RTL tests need no network.
 *
 * The UI `source` ("akt"|"odpis_kw"|"ekw_wklej") is the section key the parent
 * resets on; the snapshot's own `kw.source` is what gets persisted. `akt` is
 * the deweloperski path: a lokal with no book of its own.
 */
export function KwSection(props: KwSectionProps) {
  // `lokal.onSourceChange` deliberately NOT pulled into a bare name: it is the parent's full
  // section reset, and `retractExamination` below is the only thing allowed to
  // call it. Pulling it into render scope invites a future control to fire it
  // straight and skip the clears — which is precisely how three of the four
  // handlers here lost a field each.
  const { control } = props;
  const state = props.lokal.state;
  const source = props.lokal.source;
  const today = props.today ?? localToday();
  const kw = useWatch({ control, name: "kw" });
  const kwGrunt = useWatch({ control, name: "kwGrunt" });
  const encumbrance = useWatch({ control, name: "encumbranceTreatment" });
  const kwNumber = useWatch({ control, name: "kwNumber" });
  // T-12: the right decides the wording below and, in the gate, which books are
  // demanded at all. Absent (pre-block harness) reads as własność.
  const propertyRight = useWatch({ control, name: "propertyRight" }) ?? "wlasnosc_lokalu";
  const coop = propertyRight === "spoldzielcze_wlasnosciowe";
  /**
   * ONE carrier, and it is the record — the thing the gate counts and the
   * operat prints. `source` keeps its other two jobs (the Wgraj PDF / Wpisz
   * ręcznie choice for the lokal's book, and the section key `resetKwSection`
   * resets on); it just stops being a second place where "developer purchase"
   * is written down. That duplication is what broke: a developer stub is saved
   * as `ekw_reczne` (nothing was read from a document), so the section key
   * reopened the draft with the box UNTICKED over a record that still said
   * `true`, and §8.2 would have printed the developer variant behind the
   * appraiser's back.
   *
   * No `?? source === "akt"` fallback — that would COVER the duplication, not
   * remove it, and it is unreachable anyway: the sole emitter of `"akt"` is
   * this section's own checkbox (below), whose handler writes a non-null
   * snapshot in the same call, and the mount initializer reaches `"akt"` only
   * from `kw.source`, which means a record exists.
   */
  const deweloperski = kw?.deweloperski === true;
  // The one rule, asked once, for the banner's counter and both badges — the
  // same predicate the F-4 gate uses, so a card can never say "Zbadana" about a
  // book step 7 would block on (R-10).
  const required = kwRequirements(
    propertyRight,
    kw as Parameters<typeof kwRequirements>[1],
    kwGrunt as Parameters<typeof kwRequirements>[2],
  );
  // Only the setter: switching back to własność clears the basement, so a box
  // ticked under the coop right never rides hidden into an ownership valuation.
  const setBasement = useController({ control, name: "hasBasement" }).field.onChange;
  const setKw = useController({ control, name: "kw" }).field.onChange;
  const setKwGrunt = useController({ control, name: "kwGrunt" }).field.onChange;
  const kwNumberField = useController({ control, name: "kwNumber" });
  const setKwNumber = kwNumberField.field.onChange;
  const setEncumbrance = useController({ control, name: "encumbranceTreatment" }).field
    .onChange as (value: { wariant: string | null; podstawa: string } | null) => void;
  // Only the setter, and only for the retraction: `kwMeta` is written by the
  // parent's extraction, never edited here.
  const setKwMeta = useController({ control, name: "kwMeta" }).field.onChange as (
    value: null,
  ) => void;

  // Every edit writes the whole snapshot back, so the manual path builds one
  // object rather than registering a Controller per field — mounting those
  // earlier turned `kw` into a truthy-but-invalid object and swallowed the
  // schema's "no document, no number" issue (the W4 dead-end).
  const patchKw = (patch: Record<string, unknown>) => {
    // Źródło to kanał, którym karta stoi otworem — nigdy `ekw_reczne`
    // (ADR-021; bramka `fitness-kw-source.test.ts`).
    const base = { ...EMPTY_KW_FIELDS, source, ...(kw ?? {}) };
    // Seeded AFTER the existing snapshot, like `nrKsiegi` below: a draft saved
    // before ADR-018 (or an extract) carries `dataBadania: null`, which would
    // otherwise win over the default and leave the book permanently "Do
    // zbadania" while the field on screen showed today's date.
    setKw({ ...base, dataBadania: base.dataBadania ?? today, ...patch });
  };
  const patchKwGrunt = (patch: Record<string, unknown>) => {
    const base = {
      source: props.grunt.source,
      nrKsiegi: null as string | null,
      sad: null as string | null,
      wydzial: null as string | null,
      dataBadania: today,
      dzial3: null,
      dzial4: null,
      ...(kwGrunt ?? {}),
    };
    // The suggestion is applied AFTER the existing snapshot, not before it:
    // spread the other way round and the first patch to this card (say,
    // answering dział III while the lokal's "Numer księgi gruntu" is still
    // blank) freezes `nrKsiegi: null` for good, while the field goes on
    // DISPLAYING the suggestion — a filled screen over an empty save, the
    // same mismatch as the missing `.pick()` entry.
    setKwGrunt({ ...base, nrKsiegi: base.nrKsiegi ?? kw?.kwGruntu ?? null, ...patch });
  };

  /**
   * THE one place that decides what disappears when the lokal's examination is
   * withdrawn. Three controls withdraw it — the source switch, the developer
   * checkbox and the property-right radio — and before this existed each wrote
   * its own subset of the five carriers (`kw`, `kwGrunt`,
   * `encumbranceTreatment`, `kwNumber`, `kwSource`). Three of the three had
   * already forgotten one, in three separate rounds of review; `b1-kw-read`
   * adds a sixth carrier right after this PR, and a fourth near-miss is not
   * worth waiting for.
   *
   * Two rules are baked in here so no caller can get them wrong again:
   *
   * 1. `onSourceChange` goes FIRST. It is `resetKwSection`, whose `resetField`
   *    restores the form's DEFAULT — in edit mode the STORED snapshot — so a
   *    caller that reset last would silently undo its own clears.
   * 2. Every clear is an explicit VALUE, never a reliance on that reset. Same
   *    reason: on a loaded draft `resetField` means "put back what was saved".
   *    `null`, not `undefined` — `setValue(…, undefined)` is not a reliable
   *    clear in RHF, and all three fields are `.nullish()` so the schema
   *    accepts the retraction instead of failing on a path no field renders.
   *
   * `kwGrunt` is opt-in: only a change of property right invalidates the
   * mother book. Switching the lokal's source, or declaring a developer
   * purchase, leaves it standing — it is still required and still true.
   *
   * `kwMeta` is NOT opt-in: it is the provenance OF the lokal's examination
   * (which model read the document, and when), so it goes wherever `kw` goes.
   * It used to be left to `resetKwSection`'s `resetField`, which in edit mode
   * means "put the STORED meta back" — an orphan that was harmless only while
   * nothing rendered it. `b1-kw-read` renders it, in §7's examination
   * protocol, so a leftover would date and attribute an examination that does
   * not exist (ADR-018 reg. 4, I-19).
   */
  const retractExamination = (next: {
    source: KwSource;
    kw?: Record<string, unknown> | null;
    grunt?: boolean;
  }) => {
    props.lokal.onSourceChange(next.source);
    setKw(next.kw ?? null);
    setKwMeta(null);
    setEncumbrance(null);
    if (next.grunt) setKwGrunt(null);
  };

  return (
    <SectionCard
      icon={FileText}
      title="Księga wieczysta"
      right={
        state.status === "done" ? <Badge variant="secondary">dokument wgrany</Badge> : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {/* T-12 — rodzaj prawa, first thing on the card: like "zakup deweloperski"
            it decides which KW facts the form can even ask for. */}
        <Controller
          control={control}
          name="propertyRight"
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              <span id="property-right-label" className="text-sm font-medium">
                Rodzaj prawa
              </span>
              <div
                role="radiogroup"
                aria-labelledby="property-right-label"
                className="grid gap-2 sm:grid-cols-2"
              >
                {PROPERTY_RIGHTS.map((r) => {
                  const selected = propertyRight === r;
                  return (
                    <Button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      variant="outline"
                      onClick={() => {
                        // Compared against the RAW field value, not the
                        // defaulted `propertyRight`: on a form whose value is
                        // still undefined, the first click must set it.
                        if (r === field.value) return;
                        field.onChange(r);
                        if (r === "wlasnosc_lokalu") setBasement(false);
                        // A different right is a different legal object: the
                        // books examined for the old one, and any encumbrance
                        // decision made about them, must not ride along. Under
                        // the coop right `b1-template` prints the encumbrance
                        // phrase on the cover, so a leftover here is a false
                        // legal claim in the operat, not just stale state.
                        // A different right is a different legal object: the
                        // books examined for the old one, the mother book, and
                        // any encumbrance decision made about them must not
                        // ride along. Under the coop right `b1-template` prints
                        // the encumbrance phrase on the cover, so a leftover is
                        // a false legal claim, not just stale state.
                        //
                        // `grunt: true` — this is the ONE retraction that also
                        // invalidates the mother book. The full section reset
                        // that rides along is wanted here too: `kwNumber` and a
                        // document-seeded area belong to the abandoned right.
                        retractExamination({ source: "ekw_wklej", kw: null, grunt: true });
                      }}
                      onBlur={field.onBlur}
                      className={cn(TILE, selected ? TILE_SELECTED : TILE_IDLE)}
                    >
                      <span className="text-sm font-medium text-foreground">
                        {PROPERTY_RIGHT_LABEL[r]}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        />

        {coop ? (
          <>
            <p
              data-testid="property-right-coop-info"
              className="rounded-md border border-border bg-muted/40 p-2 text-sm"
            >
              {/* T-22: rejestr przestał być zakładką w nagłówku, więc zamiast
                  opisywać drogę przez menu awatara prowadzimy wprost do niego. */}
              Krok 3 pobierze próbę z <strong>rejestru biura</strong> (
              <Link href="/rejestr" className="underline">
                Rejestr spółdzielczy
              </Link>
              ).
            </p>
            <Controller
              control={control}
              name="hasBasement"
              render={({ field }) => (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="has-basement"
                    checked={field.value ?? false}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  />
                  <div className="flex flex-col">
                    <label htmlFor="has-basement" className="text-sm">
                      Lokal ma przynależną piwnicę
                    </label>
                    <span className="text-xs text-muted-foreground">
                      Dodaje klauzulę o pomieszczeniu przynależnym do operatu.
                    </span>
                  </div>
                </div>
              )}
            />
            {/* A coop right has no book of its own (T-12): one optional number,
                no examination — so the whole block below is skipped for it. */}
            <Controller
              control={control}
              name="kwNumber"
              render={({ field, fieldState }) => (
                <div className="flex flex-col gap-1">
                  <label htmlFor="kwNumber" className="text-sm">
                    Numer księgi wieczystej
                  </label>
                  <Input id="kwNumber" autoComplete="off" {...field} value={field.value ?? ""} />
                  <p data-testid="kw-number-coop-hint" className="text-xs text-muted-foreground">
                    Dla spółdzielczego własnościowego prawa KW nie jest wymagana
                  </p>
                  {fieldState.error ? (
                    <p className="text-sm text-destructive">{fieldState.error.message}</p>
                  ) : null}
                </div>
              )}
            />
          </>
        ) : (
          <>
            <h4 className="text-sm font-medium">Badanie ksiąg wieczystych</h4>

            <AutoBanner kind="note">
              Zbadane księgi:{" "}
              <b>
                {required.zbadane} z {required.wymagane}
              </b>{" "}
              — księga lokalu i księga gruntu. Wgraj PDF księgi albo wpisz dane ręcznie.
            </AutoBanner>

            {/* §P1.8 pkt 4: the mockup does not show this path, so it keeps the
                wording it has today. Ticking it swaps the lokal's card for the
                deed upload — a lokal bought from a developer has no book yet. */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="kw-deweloperski"
                checked={deweloperski}
                onCheckedChange={(checked) => {
                  // The record carries "developer purchase", so ticking writes
                  // a FRESH stub — never a spread of `kw`, which the retraction
                  // has just dropped. Unticking withdraws to nothing, which
                  // also restores the "type a KW number" demand that a
                  // number-less snapshot would switch off.
                  retractExamination({
                    source: checked === true ? "akt" : "ekw_wklej",
                    kw:
                      checked === true
                        ? {
                            ...EMPTY_KW_FIELDS,
                            source: "akt" as const,
                            deweloperski: true,
                            dataBadania: today,
                          }
                        : null,
                  });
                }}
              />
              <label htmlFor="kw-deweloperski" className="text-sm">
                Lokal bez własnej KW (zakup deweloperski) — dane z księgi macierzystej
              </label>
            </div>

            {deweloperski ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
                <p data-testid="kw-developer-banner" className="text-sm">
                  Lokal bez własnej KW (zakup deweloperski) — dane z księgi macierzystej gruntu.
                </p>
                <FileInput
                  accept="application/pdf"
                  aria-label="Plik dokumentu (PDF)"
                  data-testid="kw-file-input"
                  label="Wgraj inny plik"
                  hint="Akt notarialny (PDF, do 32 MB)"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) props.lokal.onFiles([file]);
                  }}
                />
                <KwFetchStatusBar state={state} onRetry={props.lokal.onRetry} />
              </div>
            ) : (
              <KwBookCard
                title="Księga lokalu"
                testId="kw-book-lokal"
                examined={required.lokalZbadana}
                head={
                  <SegmentedChoice
                    label="Źródło danych księgi lokalu"
                    options={BOOK_SOURCE_OPTIONS}
                    value={source === "odpis_kw" ? "odpis_kw" : "ekw_wklej"}
                    onChange={(next) => retractExamination({ source: next as KwSource })}
                  />
                }
              >
                {source === "odpis_kw" ? (
                  <FileInput
                    accept="application/pdf"
                    aria-label="Plik dokumentu (PDF)"
                    data-testid="kw-file-input"
                    label="Wgraj inny plik"
                    hint="Odpis księgi wieczystej (PDF, do 32 MB)"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) props.lokal.onFiles([file]);
                    }}
                  />
                ) : (
                  <KwWklejPanelTymczasowy onTekst={props.lokal.onTekst} />
                )}
                {/* While the transcription runs, ITS line stands alone: the
                    field read's "może potrwać do pół minuty" is true of that
                    read, but the card does not settle until both are back,
                    so showing it here would promise a wait we are not
                    keeping. Afterwards both speak — one about the fields,
                    one about the dzialy. */}
                {props.lokal.transcribe.status === "loading" ? null : (
                  <KwFetchStatusBar state={state} onRetry={props.lokal.onRetry} />
                )}
                <KwTranscribeStatus state={props.lokal.transcribe} />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <TextField
                      id="kw-lokalu"
                      label="Numer księgi lokalu"
                      // A draft saved before ADR-018 has the number in the flat
                      // `kw_number` column and no snapshot — it shows up here,
                      // in the field that now owns it, rather than vanishing.
                      value={kw?.kwLokalu ?? kwNumber ?? ""}
                      onChange={(v) => {
                        patchKw({ kwLokalu: v });
                        // The operat's header field IS the lokal book's number,
                        // and step 7 blocks on it — typing it twice would be
                        // the appraiser doing the app's bookkeeping.
                        setKwNumber(v);
                      }}
                    />
                    {/* The schema's "no document, no number" issue (W4) has to
                        land on a field the appraiser can see; it used to be
                        raised against an input that was not on screen. */}
                    {kwNumberField.fieldState.error ? (
                      <p data-testid="kw-upload-error" className="text-sm text-destructive">
                        {kwNumberField.fieldState.error.message}
                      </p>
                    ) : null}
                  </div>
                  <TextField
                    id="kw-data-badania"
                    label="Data badania"
                    value={kw?.dataBadania ?? today}
                    onChange={(v) => patchKw({ dataBadania: v })}
                  />
                  {/* The court the operat names in the Wyciąg and in §2. The
                      PDF path reads it off the book's header; typed by hand it
                      had no field at all, so the document fell back to a dash
                      while the template printed one fixed court for everyone.
                      Two fields, because the operats use two forms: the Wyciąg
                      names the wydział, §2 names the court alone. */}
                  <TextField
                    id="kw-sad"
                    label="Sąd prowadzący księgi"
                    placeholder="np. Sąd Rejonowy Poznań – Stare Miasto w Poznaniu"
                    value={kw?.sad ?? ""}
                    onChange={(v) => patchKw({ sad: v })}
                  />
                  <TextField
                    id="kw-wydzial"
                    label="Wydział ksiąg wieczystych"
                    placeholder="np. V Wydział Ksiąg Wieczystych"
                    value={kw?.wydzial ?? ""}
                    onChange={(v) => patchKw({ wydzial: v })}
                  />
                  <TextField
                    id="kw-nr-lokalu"
                    label="Numer lokalu"
                    value={kw?.nrLokalu ?? ""}
                    onChange={(v) => patchKw({ nrLokalu: v })}
                  />
                  <NumberTextField
                    id="kw-pow"
                    label="Powierzchnia użytkowa wg księgi"
                    value={kw?.powUzytkowaKw ?? null}
                    onChange={(powUzytkowaKw) => patchKw({ powUzytkowaKw })}
                  />
                  <TextField
                    id="kw-udzial"
                    label="Udział w nieruchomości wspólnej"
                    value={kw?.udzial ?? ""}
                    onChange={(v) => patchKw({ udzial: v })}
                  />
                  <TextField
                    id="kw-gruntu"
                    label="Numer księgi gruntu"
                    value={kw?.kwGruntu ?? ""}
                    onChange={(v) => patchKw({ kwGruntu: v })}
                  />

                  {/* Three fields, not the mockup's one (decyzja usera 15.09):
                      the operat prints the title, the Rep. number and the date
                      in separate sentences, so it must not have to split a
                      string back apart. */}
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <span className="text-sm">Podstawa nabycia — dział II</span>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <TextField
                        id="kw-akt-rodzaj"
                        label="Tytuł aktu"
                        value={kw?.akt?.rodzaj ?? ""}
                        onChange={(v) =>
                          patchKw({ akt: { rep: "", data: "", ...(kw?.akt ?? {}), rodzaj: v } })
                        }
                      />
                      <TextField
                        id="kw-akt-rep"
                        label="Rep. A"
                        value={kw?.akt?.rep ?? ""}
                        onChange={(v) =>
                          patchKw({ akt: { rodzaj: "", data: "", ...(kw?.akt ?? {}), rep: v } })
                        }
                      />
                      <TextField
                        id="kw-akt-data"
                        label="Data"
                        value={kw?.akt?.data ?? ""}
                        onChange={(v) =>
                          patchKw({ akt: { rodzaj: "", rep: "", ...(kw?.akt ?? {}), data: v } })
                        }
                      />
                    </div>
                  </div>

                  {/* Działy III i IV nie mają już pól: liczy je `dzialyZTresci`
                      z przepisanej treści (ADR-021 reg. 1). */}
                </div>
              </KwBookCard>
            )}

            {/* Księga gruntu ma od ADR-021 te same kanały co księga lokalu (R2):
                wklejenie treści z przeglądarki KW albo PDF. */}
            <KwBookCard
              title="Księga gruntu"
              testId="kw-book-grunt"
              examined={required.gruntZbadana}
              head={
                <SegmentedChoice
                  label="Źródło danych księgi gruntu"
                  options={BOOK_SOURCE_OPTIONS}
                  value={props.grunt.source}
                  onChange={(next) => props.grunt.onSourceChange(next as KwKanalUi)}
                />
              }
            >
              {props.grunt.source === "odpis_kw" ? (
                <FileInput
                  accept="application/pdf"
                  aria-label="Plik księgi gruntu (PDF)"
                  data-testid="kwg-file-input"
                  label="Wgraj inny plik"
                  hint="Odpis księgi wieczystej (PDF, do 32 MB)"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) props.grunt.onFiles([file]);
                  }}
                />
              ) : (
                <KwWklejPanelTymczasowy onTekst={props.grunt.onTekst} />
              )}
              <KwTranscribeStatus state={props.grunt.transcribe} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="kwg-nr"
                  label="Numer księgi gruntu"
                  // Suggested from the lokal's book, which states it — retyping
                  // it is how the two come to disagree.
                  value={kwGrunt?.nrKsiegi ?? kw?.kwGruntu ?? ""}
                  onChange={(v) => {
                    patchKwGrunt({ nrKsiegi: v });
                    // Mirrored back, the way "Numer księgi lokalu" mirrors into
                    // `kwNumber`: the operat's §8.2 reads `kw.kwGruntu`, so a
                    // number typed only here would print as "—".
                    patchKw({ kwGruntu: v });
                  }}
                />
                <TextField
                  id="kwg-data-badania"
                  label="Data badania"
                  value={kwGrunt?.dataBadania ?? today}
                  onChange={(v) => patchKwGrunt({ dataBadania: v })}
                />
                {/* Sąd i wydział księgi gruntu — kanał tekstowy bierze je z
                    nagłówka, ale rzeczoznawca musi móc je poprawić (R2). */}
                <TextField
                  id="kwg-sad"
                  label="Sąd prowadzący księgę gruntu"
                  placeholder="np. Sąd Rejonowy Poznań – Stare Miasto w Poznaniu"
                  value={kwGrunt?.sad ?? ""}
                  onChange={(v) => patchKwGrunt({ sad: v })}
                />
                <TextField
                  id="kwg-wydzial"
                  label="Wydział ksiąg wieczystych księgi gruntu"
                  placeholder="np. V Wydział Ksiąg Wieczystych"
                  value={kwGrunt?.wydzial ?? ""}
                  onChange={(v) => patchKwGrunt({ wydzial: v })}
                />
              </div>
            </KwBookCard>

            {kw?.dzial3?.wpisy || encumbrance ? (
              <EncumbranceChoice value={encumbrance} onChange={setEncumbrance} />
            ) : null}

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
        )}
      </div>
    </SectionCard>
  );
}
