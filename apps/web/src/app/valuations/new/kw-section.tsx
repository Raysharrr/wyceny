"use client";

import { FileText } from "lucide-react";
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
import { kwRequirements } from "@/domain/kw-requirements";
import { PROPERTY_RIGHT_LABEL, PROPERTY_RIGHTS } from "@/domain/property-right";
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

// Mirrors `NEXT_PUBLIC_SUBJECT_AUTOFETCH`: the upload surface renders only when
// enabled; the manual path is always available so the e2e smoke and any
// air-gapped deployment keep working.
const uploadEnabled = process.env.NEXT_PUBLIC_KW_UPLOAD !== "off";

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
  children,
}: {
  title: string;
  examined: boolean;
  head?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Input id={id} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const DZIAL_OPTIONS = [
  { value: "brak", label: "Brak wpisów" },
  { value: "sa", label: "Są wpisy" },
] as const;

/**
 * A dział: the Brak wpisów / Są wpisy answer, plus its text when there are
 * entries. Value in, change out — deliberately NOT a `useController` on
 * `kw.dzialN`: registering a nested path mounts `kw` as `{ dzial3: undefined }`,
 * a truthy object that fails `kwSchema` with an error on a path no field
 * displays, so the form refuses to submit and says nothing (the W4 dead-end).
 * Every field of the manual snapshot writes through `patchKw` for that reason.
 *
 * Entries Unanswered stays unanswered — `null` is not "no entries", and the
 * operat renders neither sentence for it. The 14.09 failure was exactly this:
 * a dział III described as clean that nobody had read.
 */
function DzialField({
  dzial,
  onChange,
  id,
  label,
}: {
  dzial: { wpisy: boolean; tresc: string[] } | null | undefined;
  onChange: (dzial: { wpisy: boolean; tresc: string[] }) => void;
  id: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span id={`${id}-label`} className="text-sm">
        {label}
      </span>
      <SegmentedChoice
        labelledBy={`${id}-label`}
        options={DZIAL_OPTIONS}
        value={dzial == null ? null : dzial.wpisy ? "sa" : "brak"}
        onChange={(v) =>
          onChange(
            v === "brak" ? { wpisy: false, tresc: [] } : { wpisy: true, tresc: dzial?.tresc ?? [] },
          )
        }
      />
      {dzial?.wpisy ? (
        <textarea
          id={id}
          aria-labelledby={`${id}-label`}
          className={textareaClass}
          value={(Array.isArray(dzial.tresc) ? dzial.tresc : []).join("\n")}
          onChange={(e) => onChange({ wpisy: true, tresc: e.target.value.split("\n") })}
        />
      ) : null}
    </div>
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

/** The shape `kwSchema` demands — a manual snapshot is built whole, never field by field. */
const EMPTY_MANUAL_KW = {
  source: "ekw_reczne" as const,
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

const BOOK_SOURCE_OPTIONS = [
  { value: "odpis_kw", label: "Wgraj PDF" },
  { value: "reczny", label: "Wpisz ręcznie" },
] as const;

const MANUAL_WARNING =
  "Dane wpisane ręcznie trafią do operatu jako opis — bez pełnej treści działów księgi. Aby operat zawierał treść księgi, wgraj PDF.";

/**
 * "Księga wieczysta" — the property right, then the examination of both books
 * (ADR-018). Presentation-only: upload/fetch/reset logic lives in the parent
 * form, mirroring the SubjectSection split so RTL tests need no network.
 *
 * The UI `source` ("akt"|"odpis_kw"|"reczny") is the section key the parent
 * resets on; the snapshot's own `kw.source` is what gets persisted, and since
 * ADR-018 the manual path persists one too (`ekw_reczne`) rather than a bare
 * number. `akt` is the deweloperski path: a lokal with no book of its own.
 */
export function KwSection(props: KwSectionProps) {
  // `onSourceChange` deliberately NOT destructured: it is the parent's full
  // section reset, and `retractExamination` below is the only thing allowed to
  // call it. Pulling it into render scope invites a future control to fire it
  // straight and skip the clears — which is precisely how three of the four
  // handlers here lost a field each.
  const { control, state, source } = props;
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

  // Every edit writes the whole snapshot back, so the manual path builds one
  // object rather than registering a Controller per field — mounting those
  // earlier turned `kw` into a truthy-but-invalid object and swallowed the
  // schema's "no document, no number" issue (the W4 dead-end).
  const patchKw = (patch: Record<string, unknown>) => {
    const base = { ...EMPTY_MANUAL_KW, ...(kw ?? {}) };
    // Seeded AFTER the existing snapshot, like `nrKsiegi` below: a draft saved
    // before ADR-018 (or an extract) carries `dataBadania: null`, which would
    // otherwise win over the default and leave the book permanently "Do
    // zbadania" while the field on screen showed today's date.
    setKw({ ...base, dataBadania: base.dataBadania ?? today, ...patch });
  };
  const patchKwGrunt = (patch: Record<string, unknown>) => {
    const base = {
      source: "ekw_reczne" as const,
      nrKsiegi: null as string | null,
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
   */
  const retractExamination = (next: {
    source: KwSource;
    kw?: Record<string, unknown> | null;
    grunt?: boolean;
  }) => {
    props.onSourceChange(next.source);
    setKw(next.kw ?? null);
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
                        retractExamination({ source: "reczny", kw: null, grunt: true });
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
              Krok 3 pobierze próbę z <strong>rejestru biura</strong> (zakładka{" "}
              <strong>Rejestr spółdzielczy</strong>).
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
                    source: checked === true ? "akt" : "reczny",
                    kw:
                      checked === true
                        ? { ...EMPTY_MANUAL_KW, deweloperski: true, dataBadania: today }
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
                {uploadEnabled ? (
                  <FileInput
                    accept="application/pdf"
                    aria-label="Plik dokumentu (PDF)"
                    data-testid="kw-file-input"
                    label="Wgraj inny plik"
                    hint="Akt notarialny (PDF, do 32 MB)"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) props.onFileSelected(file);
                    }}
                  />
                ) : null}
                <KwFetchStatusBar state={state} onRetry={props.onRetry} />
              </div>
            ) : (
              <KwBookCard
                title="Księga lokalu"
                examined={required.lokalZbadana}
                head={
                  uploadEnabled ? (
                    <SegmentedChoice
                      label="Źródło danych księgi lokalu"
                      options={BOOK_SOURCE_OPTIONS}
                      value={source === "reczny" ? "reczny" : "odpis_kw"}
                      onChange={(next) => retractExamination({ source: next as KwSource })}
                    />
                  ) : undefined
                }
              >
                {source === "reczny" ? (
                  <AutoBanner kind="warn">{MANUAL_WARNING}</AutoBanner>
                ) : (
                  <>
                    {uploadEnabled ? (
                      <FileInput
                        accept="application/pdf"
                        aria-label="Plik dokumentu (PDF)"
                        data-testid="kw-file-input"
                        label="Wgraj inny plik"
                        hint="Odpis księgi wieczystej (PDF, do 32 MB)"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) props.onFileSelected(file);
                        }}
                      />
                    ) : null}
                    <KwFetchStatusBar state={state} onRetry={props.onRetry} />
                  </>
                )}

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
                  <TextField
                    id="kw-nr-lokalu"
                    label="Numer lokalu"
                    value={kw?.nrLokalu ?? ""}
                    onChange={(v) => patchKw({ nrLokalu: v })}
                  />
                  <TextField
                    id="kw-pow"
                    label="Powierzchnia użytkowa wg księgi"
                    value={kw?.powUzytkowaKw == null ? "" : String(kw.powUzytkowaKw)}
                    onChange={(v) => {
                      const n = Number(v.replace(",", "."));
                      patchKw({ powUzytkowaKw: v.trim() === "" || Number.isNaN(n) ? null : n });
                    }}
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

                  <DzialField
                    dzial={kw?.dzial3}
                    onChange={(d) => patchKw({ dzial3: d })}
                    id="kw-dzial3"
                    label="Dział III — prawa, roszczenia i ograniczenia"
                  />
                  <DzialField
                    dzial={kw?.dzial4}
                    onChange={(d) => patchKw({ dzial4: d })}
                    id="kw-dzial4"
                    label="Dział IV — hipoteka"
                  />
                </div>
              </KwBookCard>
            )}

            {/* The grunt's book: manual only in paczka 1 (§P1.8 pkt 7) — reading
                its PDF waits for the files from the office, so the card offers
                no upload at all rather than a switch that leads nowhere. */}
            <KwBookCard title="Księga gruntu" examined={required.gruntZbadana}>
              <AutoBanner kind="warn">{MANUAL_WARNING}</AutoBanner>
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
                <DzialField
                  dzial={kwGrunt?.dzial3}
                  onChange={(d) => patchKwGrunt({ dzial3: d })}
                  id="kwg-dzial3"
                  label="Dział III — prawa, roszczenia i ograniczenia"
                />
                <DzialField
                  dzial={kwGrunt?.dzial4}
                  onChange={(d) => patchKwGrunt({ dzial4: d })}
                  id="kwg-dzial4"
                  label="Dział IV — hipoteka"
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
