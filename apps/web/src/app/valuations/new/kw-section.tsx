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
import {
  kluczeLokalu,
  przepisanieGruntuZablokowane,
  trescGruntuDlaInnegoLokalu,
  type KluczeLokalu,
} from "@/domain/kw-klucze";
import { nazwyNiezgodnosci, podpisyPol, type PoleKarty } from "@/domain/kw-niezgodnosci";
import { kwRequirements } from "@/domain/kw-requirements";
import type { KwWerdykt } from "@/domain/kw-snapshot";
import {
  KODY_DZIALOW,
  brakujaceDzialy,
  dopiszWklejenie,
  dzialyWTekscie,
  htmlNaTekst,
  liczbaDzialow,
  listaDzialow,
} from "@/domain/kw-wklej";
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

/**
 * Label + input, in the mockup's two-column field grid. `hint` is the amber
 * caption of makieta 4: the walidator said this field disagrees with the
 * content, so the field itself says where to look — a banner alone leaves the
 * appraiser hunting through eight inputs. Never carries a value from the book
 * (F-13): the caption names the dział, never what stands in it.
 */
function TextField({
  id,
  label,
  value,
  onChange,
  className,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  hint?: string;
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
        className={cn(hint && "border-[var(--amber)]")}
      />
      {hint ? <span className="text-xs text-[var(--amber)]">{hint}</span> : null}
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
 * A variant with an empty basis blocks approval (`encumbranceDecisionNeeded`),
 * so the block says so under the field — the appraiser's report of 25.09.
 */
function EncumbranceChoice({
  value,
  onChange,
}: {
  value: { wariant?: string | null; podstawa?: string } | null | undefined;
  onChange: (value: { wariant: string | null; podstawa: string }) => void;
}) {
  const brakPodstawy = !!value?.wariant && !(value.podstawa ?? "").trim();
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
          Podstawa (wymagana)
        </label>
        <textarea
          id="kw-encumbrance-podstawa"
          aria-required="true"
          className={textareaClass}
          placeholder="np. Zgodnie z poleceniem Zleceniodawcy obciążenie nie zostaje uwzględnione, ponieważ …"
          value={value?.podstawa ?? ""}
          onChange={(e) => onChange({ wariant: value?.wariant ?? null, podstawa: e.target.value })}
        />
        {brakPodstawy ? (
          <span className="text-xs text-[var(--amber)]">
            Bez podstawy nie zatwierdzisz operatu.
          </span>
        ) : null}
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
            Nie udało się odczytać pól z pliku — wgraj inny plik albo wklej treść z przeglądarki KW.
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
  // Odrzucenia sprzed sieci (D9). Karta gruntu nie ma własnego paska statusu,
  // więc jej odmowy jadą tym samym banerem — i muszą mówić, co się stało z
  // PLIKIEM, a nie opisywać nieudaną transkrypcję (finding F3).
  kw_plik_nie_pdf: "Wgraj plik PDF.",
  // NOWY TEKST (do akceptacji w PR) — limit ciała żądania workera, mierzony w bajtach.
  kw_tekst_za_dlugi: "Wklejony tekst jest za długi (ponad 200 kB) — wklej zakładki po kolei.",
  kw_za_duzo_plikow: "Najwyżej pięć plików naraz.", // NOWY TEKST (do akceptacji w PR)
  kw_pliki_za_duze: "Pliki są za duże (łącznie maks. 32 MB).", // NOWY TEKST (do akceptacji w PR)
  // Ścieżka aktu czyta wyłącznie plik — akt nie ma działów do przepisania (F7).
  kw_kanal_niedozwolony:
    "Wklejona treść nie dotyczy aktu notarialnego — na tej ścieżce wgraj plik PDF aktu.", // NOWY TEKST (do akceptacji w PR)
  // Zatwierdzony przez usera 25.09 (HANDOFF kw-banner-fix, Z3): obejście zamiast skutku.
  kw_transkrypcja_ucieta:
    "Treść księgi jest zbyt obszerna, żeby przepisać ją w całości. Wklej z przeglądarki KW tylko wpisy dotyczące przedmiotowego lokalu: działki, budynek, jego wiersz na listach lokali oraz działy III i IV.",
  // Te dwa — WYŁĄCZNIE karta lokalu z PDF-a; resztę rozstrzyga `tekstPorazki` (ADR-024).
  kw_transkrypcja_nieczytelna:
    "Nie udało się przepisać treści działów z tego pliku — operat opisze działy na podstawie wpisanych pól, bez pełnej treści.",
  kw_transkrypcja_blad:
    "Nie udało się przepisać treści działów — odczytane pola zostają, a operat opisze działy bez pełnej treści. Wgraj plik ponownie, jeśli chcesz mieć w operacie treść księgi.",
};

// Teksty karty gruntu (ADR-024, spec §7) — zatwierdzone przez usera 26.09 (ADR-024).
const T1_GRUNT_ZABLOKOWANY =
  "Najpierw przepisz księgę lokalu — z niej program wie, który lokal przepisać.";
const T2_GRUNT_W_TOKU = "⏳ Przepisuję księgę gruntu (może potrwać do trzech minut)…";
const T4_INNY_LOKAL = "Księgę gruntu przepisano dla innego lokalu. Przepisz ją ponownie.";
const T6_PLIK =
  "Nie udało się przepisać treści księgi z tego pliku — spróbuj ponownie albo wklej treść z przeglądarki KW.";
// Zatwierdzony przez usera 26.09 (ADR-024) — T6 dla wklejenia, obie karty.
const T6_WKLEJ = "Nie udało się przepisać wklejonej treści — spróbuj ponownie albo wgraj PDF.";

/**
 * Tekst porażki. Dawne zdania o „działach na podstawie wpisanych pól" są
 * prawdziwe WYŁĄCZNIE na karcie lokalu z PDF-a (tam `/kw-extract` daje działy
 * III i IV); na karcie gruntu i przy wklejeniu treści tych pól nie ma i księga
 * zostaje do zbadania (review #94 R2, ADR-024).
 */
export function tekstPorazki(code: string, book: KwBookUi, kanal: KwKanalUi): string {
  const nieudana = code === "kw_transkrypcja_nieczytelna" || code === "kw_transkrypcja_blad";
  if (nieudana && kanal === "ekw_wklej") return T6_WKLEJ;
  if (nieudana && book === "grunt") return T6_PLIK;
  return TRANSCRIBE_FAILED_TEXT[code] ?? TRANSCRIBE_FAILED_TEXT.kw_transkrypcja_blad;
}

/**
 * T3a–T3c: co z list lokali weszło do treści gruntu. Wariant wybierają klucze
 * zapisane PRZY migawce (`kwGrunt.kluczeLokalu`), nie stan karty lokalu — status
 * mówi o tym, co przepisano, a nie o tym, co dziś stoi w polach.
 */
function statusOkGruntu(dzialy: string[], klucze: KluczeLokalu | null | undefined): string {
  const przepisano = `✓ Przepisano ${liczbaDzialow(dzialy.length)} (${dzialy.join(", ")})`;
  // T3a, T3b, T3c — zatwierdzone przez usera 26.09 (ADR-024).
  const listy = klucze?.nrLokalu
    ? `z list lokali tylko lokal nr ${klucze.nrLokalu}`
    : klucze
      ? "z list lokali tylko przedmiotowy lokal"
      : "bez list lokali";
  return `${przepisano}, ${listy}. Sprawdzenie treści wypadło pomyślnie.`;
}

/**
 * Jak poszło przepisanie. Od makiety 3 stan `ok` MÓWI — wymienia przepisane
 * działy, bo to jedyne miejsce, w którym rzeczoznawca widzi, ile księgi
 * faktycznie weszło do operatu. `idle` milczy: albo nic się jeszcze nie działo,
 * albo przepisanie się udało, ale walidator zgłosił niezgodności — wtedy mówi
 * baner werdyktu, który stoi PRZY migawce i przeżywa wyjście z kroku 1.
 */
function KwTranscribeStatus({
  state,
  book,
  kanal,
  klucze,
}: {
  state: KwTranscribeState;
  book: KwBookUi;
  kanal: KwKanalUi;
  klucze?: KluczeLokalu | null;
}) {
  switch (state.status) {
    case "idle":
      return null;
    case "ok":
      return (
        <p data-testid="kw-transcribe-status" className="text-sm text-muted-foreground">
          {book === "grunt" ? (
            statusOkGruntu(state.dzialy, klucze)
          ) : (
            <>
              ✓ Przepisano {liczbaDzialow(state.dzialy.length)} ({state.dzialy.join(", ")}) —
              sprawdzenie treści wypadło pomyślnie. Pola poniżej wypełniono z księgi.
            </>
          )}
        </p>
      );
    case "loading":
      return (
        <p data-testid="kw-transcribe-status" className="text-sm text-muted-foreground">
          {book === "grunt"
            ? T2_GRUNT_W_TOKU
            : "⏳ Przepisuję pełną treść działów księgi (może potrwać do dwóch minut)…"}
        </p>
      );
    // `warn`, not `error`: the file WAS read — the mockup's error banner ("Nie
    // udało się odczytać pliku PDF księgi") would be a false statement here.
    // What is left is the manual path's consequence, so it gets the manual
    // path's weight (spec §12a: warn = "wymaga uwagi, decyzja rzeczoznawcy").
    case "failed":
      return (
        <AutoBanner kind="warn">
          <span data-testid="kw-transcribe-warn">{tekstPorazki(state.code, book, kanal)}</span>
        </AutoBanner>
      );
  }
}

const BOOK_SOURCE_OPTIONS = [
  { value: "ekw_wklej", label: "Wklej z przeglądarki KW" },
  { value: "odpis_kw", label: "Wgraj PDF" },
] as const;

/** Księga w karcie: „lokal" albo „grunt" — ten sam układ, inne identyfikatory. */
export type KwBookUi = "lokal" | "grunt";

const EKW_URL = "https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/wyszukiwanieKW";
const PDF_HINT =
  "Wydruk z przeglądarki KW (jeden plik na zakładkę) albo e-odpis z Portalu Rejestrów Sądowych — PDF, łącznie do 32 MB.";

/** „201 kB", „1,2 MB" — rozmiar, który rzeczoznawca porówna z limitem 32 MB. */
const nfKb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`
    : `${Math.round(bytes / 1024)} kB`;
/** Polska liczba mnoga: 1 plik, 2–4 pliki, 5+ plików. */
const plikow = (n: number) =>
  n === 1 ? "1 plik" : n >= 2 && n <= 4 ? `${n} pliki` : `${n} plików`;

/**
 * Kanał tekstowy (makiety 1–2). Tekst jest stanem WYŁĄCZNIE tego panelu: do
 * migawki trafia dopiero przepisana treść z workera, nigdy surowe wklejenie.
 *
 * `onPaste` czyta `text/html`, bo przeglądarka KW oddaje działy jako tabele —
 * z samego `text/plain` kolumny zlewają się w jeden ciąg i nie wiadomo, gdzie
 * kończy się rubryka, a zaczyna wartość. Kolejne wklejenia DOPISUJĄ: każda
 * zakładka to osobna strona, więc rzeczoznawca wkleja do pięciu razy.
 */
function KwWklejPanel({
  book,
  onTekst,
  disabled,
}: {
  book: KwBookUi;
  onTekst: (tekst: string) => void;
  disabled: boolean;
}) {
  const [tekst, setTekst] = useState("");
  const dzialy = dzialyWTekscie(tekst);
  const brak = brakujaceDzialy(tekst);
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData("text/html");
    const fragment = html ? htmlNaTekst(html) : e.clipboardData.getData("text/plain");
    if (!fragment.trim()) return;
    e.preventDefault();
    setTekst((t) => dopiszWklejenie(t, fragment));
  };
  return (
    <>
      {book === "lokal" ? (
        <p className="text-xs text-muted-foreground">
          W{" "}
          <a href={EKW_URL} target="_blank" rel="noopener noreferrer" className="underline">
            przeglądarce ksiąg wieczystych
          </a>{" "}
          otwórz księgę i na każdej zakładce — Dział I-O, I-Sp, II, III, IV — zaznacz wszystko
          (Ctrl+A), skopiuj (Ctrl+C) i wklej poniżej. Możesz wkleić zakładki po kolei albo wszystkie
          naraz.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Tak samo jak dla księgi lokalu: pięć zakładek z przeglądarki KW, po kolei albo naraz.
        </p>
      )}
      <textarea
        data-testid={`kw-wklej-${book}`}
        aria-label="Treść z przeglądarki KW"
        className={cn(textareaClass, tekst && "min-h-[150px] font-mono")}
        placeholder="Wklej treść zakładki z przeglądarki KW…"
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        onPaste={onPaste}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          aria-label="Wklejone działy"
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span>Działy:</span>
          {KODY_DZIALOW.map((k) => (
            <Badge
              key={k}
              variant="outline"
              className={
                dzialy.includes(k)
                  ? "border-[var(--accent-100)] bg-[var(--accent-050)] text-[var(--accent-700)]"
                  : "text-muted-foreground opacity-60"
              }
            >
              {k}
              {dzialy.includes(k) ? " ✓" : ""}
            </Badge>
          ))}
          <span>{dzialy.length} z 5</span>
        </div>
        <Button
          type="button"
          data-testid={`kw-przepisz-${book}`}
          disabled={disabled || dzialy.length === 0}
          onClick={() => onTekst(tekst)}
        >
          Przepisz treść księgi
        </Button>
      </div>
      {dzialy.length > 0 && brak.length > 0 ? (
        <AutoBanner kind="note">
          {/* „Brakuje działu III” przy jednym — ta sama odmiana co w statusie (F2). */}
          Brakuje {brak.length === 1 ? "działu" : "działów"} <b>{listaDzialow(brak)}</b> — wklej
          pozostałe zakładki. Bez nich operat nie opisze praw, roszczeń ani hipotek.
        </AutoBanner>
      ) : null}
    </>
  );
}

/**
 * Kanał PDF (makieta 6). Lista plików jest lokalna, a wysyłka jawna: wydruk z
 * przeglądarki KW to jeden plik NA ZAKŁADKĘ, więc odczyt po pierwszym wybranym
 * pliku przepisałby jedną piątą księgi i zameldował sukces.
 */
function KwPdfPanel({
  book,
  onFiles,
  disabled,
}: {
  book: KwBookUi;
  onFiles: (files: File[]) => void;
  disabled: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const razem = files.reduce((sum, f) => sum + f.size, 0);
  return (
    <>
      <FileInput
        multiple
        accept="application/pdf"
        aria-label="Pliki księgi (PDF)"
        showSelected={false}
        data-testid={book === "lokal" ? "kw-file-input" : "kwg-file-input"}
        label="Wybierz pliki"
        hint={PDF_HINT}
        onChange={(e) => {
          const nowe = Array.from(e.target.files ?? []);
          // Plik w złym formacie idzie WPROST do strażnika rodzica (D9), nie na
          // listę: to on nazywa odmowę, a lista miała zawierać wyłącznie to, co
          // pojedzie do workera. Czekanie z odmową do kliknięcia „Odczytaj"
          // kazałoby rzeczoznawcy patrzeć na zdjęcie w spisie plików księgi.
          // Strażnik nie wysyła niczego, więc wolno go wołać także w trakcie
          // odczytu — i trzeba, bo unieważnia odczyt w locie.
          if (nowe.some((f) => f.type !== "application/pdf")) {
            onFiles(nowe);
            e.target.value = "";
            return;
          }
          if (nowe.length) setFiles((f) => [...f, ...nowe]);
          // Ten sam plik wybrany dwa razy z rzędu nie odpaliłby `change`,
          // gdyby wartość inputu została — a dokładanie zakładek po jednej to
          // tu norma, nie wyjątek.
          e.target.value = "";
        }}
      />
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="flex items-center gap-3 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{f.name}</span>
          <span className="text-xs text-muted-foreground">{nfKb(f.size)}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
          >
            Usuń
          </Button>
        </div>
      ))}
      {files.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {plikow(files.length)} · {nfKb(razem)}
          </span>
          <Button type="button" disabled={disabled} onClick={() => onFiles(files)}>
            Odczytaj i przepisz księgę
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Werdykt sprawdzenia treści — czytany z MIGAWKI (`kw.transkrypcja`), nie ze
 * stanu sekcji, więc wraca z każdym otwarciem szkicu, dopóki treść nie zostanie
 * przepisana na nowo. To ostrzeżenie, nie blokada (ADR-021 reg. 5), i baner
 * mówi to pierwszym zdaniem: treść jest zapisana, a do operatu trafi w obecnej
 * postaci — chyba że rzeczoznawca wklei lub wgra księgę ponownie.
 */
function KwWerdyktBanner({
  book,
  werdykt,
  dzialow,
}: {
  book: KwBookUi;
  werdykt: KwWerdykt | null | undefined;
  dzialow: number;
}) {
  if (!werdykt || werdykt.ok) return null;
  return (
    <AutoBanner kind="warn">
      <span data-testid={`kw-werdykt-${book}`}>
        <b>To ostrzeżenie — nie blokuje zatwierdzenia operatu.</b> Przepisano{" "}
        {liczbaDzialow(dzialow)}, ale w przepisanej treści coś się nie zgadza:{" "}
        <b>{nazwyNiezgodnosci(werdykt.bledy, book).join(", ")}</b>. Porównaj te miejsca z księgą.
        Jeśli się zgadzają, zostaw treść bez zmian; jeśli nie, wklej lub wgraj księgę ponownie. Do
        operatu trafi treść w obecnej postaci.
      </span>
    </AutoBanner>
  );
}

/**
 * Panel kanału jednej księgi: pole wklejania albo lista plików, dopóki treści
 * nie ma; potem status i przycisk powrotu do panelu.
 *
 * Widoczność wisi na TREŚCI (`tresc != null`), nigdy na `transcribe.status`:
 * przy werdykcie `ok:false` stan sekcji wraca jako `idle`, więc karta po udanym
 * przepisaniu z niezgodnościami wyglądałaby jak nietknięta i kusiła do
 * przepisania jeszcze raz.
 */
function KwKanalPanel({
  book,
  kanal,
  transcribe,
  tresc,
  werdykt,
  onTekst,
  onFiles,
  fetchBar,
  zablokowane = false,
  innyLokal = false,
  klucze,
}: {
  book: KwBookUi;
  kanal: KwKanalUi;
  transcribe: KwTranscribeState;
  tresc: { dzialy: ReadonlyArray<{ kod: string }> } | null | undefined;
  werdykt: KwWerdykt | null | undefined;
  onTekst: (tekst: string) => void;
  onFiles: (files: File[]) => void;
  /** Pasek odczytu PÓL — ma go wyłącznie karta lokalu (`/kw-extract`). */
  fetchBar?: React.ReactNode;
  /**
   * Karta gruntu przy własności bez numeru KW lokalu (decyzja usera 26.09):
   * przycisk nieaktywny + T1. Pole wklejania i wybór plików zostają czynne —
   * treść wolno przygotować, zanim przepisze się księgę lokalu.
   */
  zablokowane?: boolean;
  /** T4: treść gruntu przepisano dla innego numeru KW lokalu (ostrzeżenie, nie blokada). */
  innyLokal?: boolean;
  /** Klucze zapisane przy migawce gruntu — wybierają wariant T3. */
  klucze?: KluczeLokalu | null;
}) {
  const [ponownie, setPonownie] = useState(false);
  /**
   * Nowa treść zamyka panel otwarty przyciskiem „Wklej ponownie" — bez tego
   * rzeczoznawca po udanym przepisaniu dalej patrzyłby w puste pole.
   *
   * Porównanie idzie po WARTOŚCI, nie po tożsamości obiektu: `useWatch` oddaje
   * migawkę sklonowaną, więc pod `!==` każda poprawka sądu czy udziału
   * zatrzaskiwała pole w trakcie wklejania (zmierzone testem obok). Kluczem są
   * kody działów i chwila odczytu — jedyne dwie rzeczy, które zmienia nowe
   * przepisanie, a nie zmienia edycja pola.
   */
  const kluczTresci = `${(tresc?.dzialy ?? []).map((d) => d.kod).join(",")}|${werdykt?.at ?? ""}`;
  const [widziany, setWidziany] = useState(kluczTresci);
  if (kluczTresci !== widziany) {
    setWidziany(kluczTresci);
    if (ponownie) setPonownie(false);
  }
  const zajete = transcribe.status === "loading";
  const panel = tresc == null || ponownie;
  return (
    <>
      {panel ? (
        kanal === "odpis_kw" ? (
          <KwPdfPanel book={book} onFiles={onFiles} disabled={zajete || zablokowane} />
        ) : (
          <KwWklejPanel book={book} onTekst={onTekst} disabled={zajete || zablokowane} />
        )
      ) : null}
      {/* T1 tylko przy panelu, bo tylko tam stoi nieaktywny przycisk; przy
          schowanym panelu zmianę numeru lokalu zgłasza T4 poniżej. */}
      {panel && zablokowane ? (
        <p data-testid="kw-grunt-zablokowane" className="text-xs text-muted-foreground">
          {T1_GRUNT_ZABLOKOWANY}
        </p>
      ) : null}
      {fetchBar}
      <KwTranscribeStatus state={transcribe} book={book} kanal={kanal} klucze={klucze} />
      {innyLokal ? (
        <AutoBanner kind="warn">
          <span data-testid="kw-grunt-inny-lokal">{T4_INNY_LOKAL}</span>
        </AutoBanner>
      ) : null}
      <KwWerdyktBanner book={book} werdykt={werdykt} dzialow={tresc?.dzialy.length ?? 0} />
      {panel ? null : (
        <div className="flex">
          <Button type="button" variant="ghost" size="sm" onClick={() => setPonownie(true)}>
            {/* NOWY TEKST (do akceptacji w PR) — makiety pokazują tylko wariant tekstowy. */}
            {kanal === "odpis_kw" ? "Wgraj inne pliki" : "Wklej ponownie"}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Co zniknie po zmianie sposobu — lista z makiety 5. Pyta o to, co rzeczoznawca
 * WIDZI w karcie, a nie o nazwy pól migawki: „numer księgi, data badania, sąd i
 * wydział" to jeden wiersz, bo znikają razem.
 */
function coZniknie(
  book: KwBookUi,
  kw: FormInput["kw"] | null | undefined,
  kwGrunt: FormInput["kwGrunt"] | null | undefined,
  encumbrance: unknown,
): string[] {
  const out: string[] = [];
  if (book === "lokal") {
    if (kw?.kwLokalu || kw?.dataBadania || kw?.sad || kw?.wydzial)
      out.push("numer księgi, data badania, sąd i wydział");
    if (kw?.nrLokalu || kw?.powUzytkowaKw != null || kw?.udzial || kw?.kwGruntu)
      out.push("numer lokalu, powierzchnia, udział, numer księgi gruntu");
    if (kw?.akt?.rodzaj || kw?.akt?.rep)
      out.push(
        `podstawa nabycia (${[kw.akt.rodzaj, kw.akt.rep ? `Rep. A ${kw.akt.rep}` : ""]
          .filter(Boolean)
          .join(", ")})`,
      );
    // „i jej potwierdzenie" z makiety 5 nie istnieje — potwierdzeniem jest samo
    // wklejenie (decyzja usera 21.09), więc drukujemy sam opis treści.
    if (kw?.tresc)
      out.push(
        kw.tresc.dzialy.length === 5
          ? "przepisana treść pięciu działów"
          : `przepisana treść działów: ${kw.tresc.dzialy.map((d) => d.kod).join(", ")}`,
      );
    if (encumbrance) out.push("decyzja o uwzględnieniu obciążenia z działu III");
  } else {
    if (kwGrunt?.nrKsiegi || kwGrunt?.sad || kwGrunt?.wydzial)
      out.push("numer księgi, data badania, sąd i wydział");
    if (kwGrunt?.tresc)
      out.push(
        kwGrunt.tresc.dzialy.length === 5
          ? "przepisana treść pięciu działów"
          : `przepisana treść działów: ${kwGrunt.tresc.dzialy.map((d) => d.kod).join(", ")}`,
      );
  }
  return out;
}

/**
 * Makieta 5. Zmiana sposobu przy wpisanych danych jest WYCOFANIEM badania, więc
 * pyta o zgodę i wymienia, co zniknie — do 20.09 kasowała kartę bez słowa.
 * Panel w karcie, nie modal: pola, o których mówi, mają zostać na ekranie.
 */
function ZmianaSposobuPanel({
  ksiega,
  etykieta,
  pozycje,
  onConfirm,
  onCancel,
}: {
  ksiega: "lokalu" | "gruntu";
  etykieta: string;
  pozycje: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Zmiana sposobu wprowadzenia księgi"
      data-testid="kw-zmiana-sposobu"
      className="flex flex-col gap-3 rounded-lg border border-[var(--amber-line)] bg-[var(--amber-bg)] p-4 text-sm"
    >
      <p>
        Zmiana sposobu na „{etykieta}” usunie dane wpisane dla księgi {ksiega}:
      </p>
      <ul className="ml-4 list-disc">
        {pozycje.map((pozycja) => (
          <li key={pozycja}>{pozycja}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button type="button" onClick={onConfirm}>
          Zmień sposób i usuń dane
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Zostaw jak jest
        </Button>
      </div>
    </div>
  );
}

const ETYKIETA_KANALU: Record<KwKanalUi, string> = {
  ekw_wklej: "Wklej z przeglądarki KW",
  odpis_kw: "Wgraj PDF",
};

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
   * operat prints. `source` keeps its other two jobs (the Wklej z przeglądarki
   * KW / Wgraj PDF choice for the lokal's book — plus `akt` for the deed path —
   * and the section key `resetKwSection` resets on); it just stops being a
   * second place where "developer purchase" is written down. That duplication is what broke: a developer stub is saved
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
  // ADR-024: z wartości OBSERWOWANYCH, więc blokada (T1) i ostrzeżenie (T4)
  // reagują na każdą zmianę karty lokalu bez przeładowania.
  const zablokowaneGrunt = przepisanieGruntuZablokowane(propertyRight, kw, kwNumber);
  const innyLokal = trescGruntuDlaInnegoLokalu(
    kwGrunt as Parameters<typeof trescGruntuDlaInnegoLokalu>[0],
    kluczeLokalu(kw, kwNumber),
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

  /**
   * Wycofanie badania księgi gruntu. Kolejność jak w `retractExamination`:
   * najpierw reset sekcji rodzica (jego `resetField` przywraca DOMYŚLNĄ, czyli
   * w trybie edycji ZAPISANĄ migawkę), dopiero potem jawne `null` — odwrotnie
   * reset cofnąłby własne czyszczenie.
   */
  const retractGruntExamination = (next: KwKanalUi) => {
    props.grunt.onSourceChange(next);
    setKwGrunt(null);
  };

  /**
   * Zmiana sposobu przy niepustej karcie pyta o zgodę (makieta 5) — bez tego
   * jedno kliknięcie kasuje przepisaną księgę bez słowa. Pusta karta przełącza
   * się od razu: nie ma o co pytać.
   */
  const [pendingLokal, setPendingLokal] = useState<KwKanalUi | null>(null);
  const [pendingGrunt, setPendingGrunt] = useState<KwKanalUi | null>(null);
  const zniknieLokal = coZniknie("lokal", kw, kwGrunt, encumbrance);
  const zniknieGrunt = coZniknie("grunt", kw, kwGrunt, encumbrance);
  // Podpisy pól z werdyktu przy MIGAWCE — znikają razem z nią (makieta 4).
  // Każda karta czyta SWÓJ werdykt: niezgodność w księdze gruntu ma podpisać
  // pole na karcie gruntu, a nie na karcie lokalu.
  const podpisy: Partial<Record<PoleKarty, string>> = podpisyPol(kw?.transkrypcja?.bledy ?? []);
  const podpisyGruntu: Partial<Record<PoleKarty, string>> = podpisyPol(
    kwGrunt?.transkrypcja?.bledy ?? [],
  );

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
              — księga lokalu i księga gruntu. Wklej treść z przeglądarki KW albo wgraj PDF.
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
                    onChange={(next) =>
                      zniknieLokal.length
                        ? setPendingLokal(next)
                        : retractExamination({ source: next as KwSource })
                    }
                  />
                }
              >
                {pendingLokal ? (
                  <ZmianaSposobuPanel
                    ksiega="lokalu"
                    etykieta={ETYKIETA_KANALU[pendingLokal]}
                    pozycje={zniknieLokal}
                    onConfirm={() => {
                      retractExamination({ source: pendingLokal });
                      setPendingLokal(null);
                    }}
                    onCancel={() => setPendingLokal(null)}
                  />
                ) : null}
                {/* Panel kanału zostaje ZAMONTOWANY pod pytaniem, tylko schowany:
                    wklejony tekst jest jego stanem lokalnym, więc odmontowanie
                    kasowałoby zakładki, które „Zostaw jak jest" obiecuje zostawić
                    (finding F1). */}
                <div className={cn("flex flex-col gap-3", pendingLokal && "hidden")}>
                  <KwKanalPanel
                    book="lokal"
                    kanal={source === "odpis_kw" ? "odpis_kw" : "ekw_wklej"}
                    transcribe={props.lokal.transcribe}
                    tresc={kw?.tresc}
                    werdykt={kw?.transkrypcja}
                    onTekst={props.lokal.onTekst}
                    onFiles={props.lokal.onFiles}
                    /* While the transcription runs, ITS line stands alone: the
                       field read's "może potrwać do pół minuty" is true of that
                       read, but the card does not settle until both are back,
                       so showing it here would promise a wait we are not
                       keeping. Afterwards both speak — one about the fields,
                       one about the dzialy. */
                    fetchBar={
                      props.lokal.transcribe.status === "loading" ? null : (
                        <KwFetchStatusBar state={state} onRetry={props.lokal.onRetry} />
                      )
                    }
                  />
                </div>

                <div
                  className={cn("grid gap-4 sm:grid-cols-2", pendingLokal && "opacity-[.55]")}
                  aria-disabled={pendingLokal ? true : undefined}
                >
                  <div className="flex flex-col gap-1">
                    <TextField
                      id="kw-lokalu"
                      label="Numer księgi lokalu"
                      hint={podpisy.kwLokalu}
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
                    hint={podpisy.nrLokalu}
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
                    hint={podpisy.udzial}
                    value={kw?.udzial ?? ""}
                    onChange={(v) => patchKw({ udzial: v })}
                  />
                  <TextField
                    id="kw-gruntu"
                    label="Numer księgi gruntu"
                    hint={podpisy.kwGruntu}
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
                        hint={podpisy.rep}
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
                  onChange={(next) =>
                    zniknieGrunt.length
                      ? setPendingGrunt(next as KwKanalUi)
                      : retractGruntExamination(next as KwKanalUi)
                  }
                />
              }
            >
              {pendingGrunt ? (
                <ZmianaSposobuPanel
                  ksiega="gruntu"
                  etykieta={ETYKIETA_KANALU[pendingGrunt]}
                  pozycje={zniknieGrunt}
                  onConfirm={() => {
                    retractGruntExamination(pendingGrunt);
                    setPendingGrunt(null);
                  }}
                  onCancel={() => setPendingGrunt(null)}
                />
              ) : null}
              <div className={cn("flex flex-col gap-3", pendingGrunt && "hidden")}>
                <KwKanalPanel
                  book="grunt"
                  kanal={props.grunt.source}
                  transcribe={props.grunt.transcribe}
                  tresc={kwGrunt?.tresc}
                  werdykt={kwGrunt?.transkrypcja}
                  onTekst={props.grunt.onTekst}
                  onFiles={props.grunt.onFiles}
                  zablokowane={zablokowaneGrunt}
                  innyLokal={innyLokal}
                  klucze={kwGrunt?.kluczeLokalu}
                />
              </div>
              <div
                className={cn("grid gap-4 sm:grid-cols-2", pendingGrunt && "opacity-[.55]")}
                aria-disabled={pendingGrunt ? true : undefined}
              >
                <TextField
                  id="kwg-nr"
                  label="Numer księgi gruntu"
                  // Numer WŁASNY tej księgi: walidator nazywa go raz jako
                  // `numerKsiegi`/`kwLokalu` (nagłówek), raz jako `kwGruntu`
                  // (rubryka) — na tej karcie to jedno i to samo pole.
                  hint={podpisyGruntu.kwGruntu ?? podpisyGruntu.kwLokalu}
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
