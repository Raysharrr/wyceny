/**
 * Prose facts — the ONLY thing the language model is allowed to write from
 * (ADR-014, FR-6). Pure: zero I/O, zero adapter imports (F-10), no clock
 * (F-2), no `node:` builtins (the sha256 lives in `prose-hash.ts`).
 *
 * Two invariants make this file load-bearing:
 *
 *  - **Numbers come from the document's own formatters.** The worker's guard
 *    compares WRITTEN FORMS: every number in the generated text must appear
 *    verbatim in these facts. Formatting a price here even one decimal apart
 *    from `buildDocumentModel` would make the operat contradict itself, so
 *    `formatPln`/`formatNumber` are reused rather than re-implemented (the
 *    NBSP thousands separator included — the worker normalises `\s`).
 *  - **F-11: no market value ever leaves the web.** Neither `wr` nor the
 *    result's `unitValue` is sent; the result's standing in the sample
 *    travels as the categorical string from {@link resultPosition}.
 *
 * Sample transactions travel OUTSIDE the facts (see
 * {@link buildProseTransactions}): the worker collapses them into a
 * deterministic trend and keeps them out of the prompt, because raw prices in
 * the facts would authorise the model to write any of them anywhere.
 */

import { cityFromAddress, formatNumber, formatPln, LEVEL_LABEL } from "./document-model";
import { computeKcs, type Comparable, type KcsInput, type KcsResult } from "./kcs";
import { PROSE_SECTIONS, type ProseSection, type ProseSnapshot } from "./prose-snapshot";
import { sourced, type Sourced } from "@wyceny/shared";

/**
 * Market description — flats on the secondary market, in the subject's own
 * city. The city is load-bearing, not decoration: the few-shot examples carry
 * it here ("wtórny, lokale mieszkalne, Nowogród") and their prose opens with
 * "analizę rynku lokalnego m. Nowogród, obręb nr …". Sending it without the
 * city, a staging run produced "przeprowadzono analizę rynku lokalnego obręb
 * Golęcin" — the model, having no city to place, glued the bare obręb onto the
 * sentence in the wrong grammatical case. Polish declension is decided by what
 * the phrase is attached to, so the fact has to arrive shaped.
 */
const RYNEK_BASE = "wtórny, lokale mieszkalne";

/** Date-range separator of the section prompts' few-shot: EN DASH between plain spaces. */
const RANGE_SEPARATOR = "–";

export type ProseSampleFacts = {
  /** The ONE numeric leaf the worker accepts as a number — everything else is a PL string. */
  liczba_transakcji: number;
  zakres_dat?: string;
  pow_min_m2?: string;
  pow_max_m2?: string;
  cena_min_zl_m2: string;
  cena_srednia_zl_m2: string;
  cena_max_zl_m2: string;
  cena_calkowita_min_zl?: string;
  cena_calkowita_max_zl?: string;
};

/** Keys mirror the `### DANE` blocks of `apps/worker/app/prompts/prose/*.md`. */
export type ProseFacts = {
  adres: string;
  dzielnica?: string;
  obreb?: string;
  pow_uzytkowa: string;
  rynek: string;
  proba?: ProseSampleFacts;
  nr_dzialki?: string;
  pow_dzialki_m2?: string;
  uzytek?: string;
  budynek_rodzaj?: string;
  kondygnacje?: string;
  rok_budowy?: string;
  notatka_uklad?: string;
  notatka_otoczenie?: string;
  notatka_standard?: string;
  notatka_zagospodarowanie?: string;
  oceny_cech?: Record<string, string>;
  pozycja_wyniku?: string;
};

/**
 * What each section may write from — the subset of facts its few-shot shows
 * it. This is the basis of per-section staleness: a fact outside a section's
 * subset changing must NOT invalidate that section's text.
 *
 * Verified empirically before adoption (wiki-repo
 * `tools/spike/2026-08-18-odcisk-per-sekcja/`): across 3 runs x 6 sections,
 * no section used a fact outside its subset. The model receives the FULL
 * facts dict — the prompt is unchanged, only the fingerprint is scoped.
 *
 * `prose-section-facts.test.ts` pins this against the prompt files.
 */
export const PROSE_SECTION_FACTS: Record<ProseSection, readonly (keyof ProseFacts)[]> = {
  analiza_rynku: ["adres", "obreb", "pow_uzytkowa", "rynek", "proba"],
  opis_lokalu: ["pow_uzytkowa", "notatka_uklad"],
  otoczenie: ["notatka_otoczenie"],
  zagospodarowanie: [
    "nr_dzialki",
    "obreb",
    "pow_dzialki_m2",
    "uzytek",
    "budynek_rodzaj",
    "kondygnacje",
    "rok_budowy",
    "notatka_zagospodarowanie",
  ],
  standard: ["notatka_standard", "oceny_cech"],
  uzasadnienie: ["pozycja_wyniku", "proba"],
};

/**
 * Sections whose text reflects the sample's price trend. The trend is derived
 * by the worker FROM THE TRANSACTIONS, which travel outside `fakty`, so these
 * two sections must fingerprint the transactions too or a reordered-in-time
 * sample would leave a contradicted trend claim in the operat.
 *
 * `uzasadnienie` stays in this set even though its prompt never mentions
 * `trend_cen` — that is a deliberate over-approximation, not an oversight to
 * "clean up". Its facts include `proba`, whose min/mean/max/count move
 * whenever the transaction sample moves, so the section is exposed to sample
 * edits regardless of the trend. The asymmetry that matters is legal, not
 * computational: under-approximating staleness here would leave stale prose
 * standing in a SIGNED appraisal — a legal defect — while over-approximating
 * merely costs one redundant LLM call. Do not drop it from this set.
 */
export const SECTIONS_USING_TRANSACTIONS: ReadonlySet<ProseSection> = new Set([
  "analiza_rynku",
  "uzasadnienie",
]);

/** Worker wire shape: `data` is "MM-RRRR" and `cena_m2` a NUMBER (a PL string → 422). */
export type ProseTransactionPayload = { data: string; cena_m2: number };

export type ProseFactsInput = { address: string; inputs: KcsInput };

/** m² per hectare — EGiB reports the parcel in ha, the prompt in m². */
const M2_PER_HA = 10_000;

type Month = { order: number; label: string };

/**
 * "2026-03" (or a longer ISO prefix, like `maskMonth` tolerates) → the
 * prompt's "MM-RRRR" plus a CHRONOLOGICAL sort key. Sorting the labels as
 * strings is wrong: "03-2025" < "11-2024" lexicographically.
 */
function monthOf(date: string | undefined): Month | null {
  if (!date || !/^\d{4}-\d{2}/.test(date.trim())) return null;
  const [year, month] = date.trim().slice(0, 7).split("-");
  const m = Number(month);
  if (m < 1 || m > 12) return null;
  return { order: Number(year) * 12 + m, label: `${month}-${year}` };
}

function minMax(values: number[]): { min: number; max: number } | null {
  return values.length === 0 ? null : { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * `computeKcs`, or null when the draft cannot feed the engine yet — prose is
 * offered on an inspection-only draft too. The three conditions mirror the
 * engine's own three preconditions (kcs.ts) rather than swallowing its throw.
 */
function proseKcs(inputs: KcsInput): KcsResult | null {
  const usable =
    inputs.comparables.length > 0 &&
    inputs.area > 0 &&
    inputs.comparables.every((c) => c.pricePerM2 > 0);
  return usable ? computeKcs(inputs) : null;
}

/** Relative distance from the sample mean below which the result reads as "average". */
const NEAR_AVERAGE = 0.01;

/**
 * Where the result sits in the sample — CATEGORICAL, never an amount (F-11).
 * The unit value and the market value stay on this side of the wire; this
 * string is all the `uzasadnienie` section gets to reason from.
 */
export function resultPosition(kcs: KcsResult): string {
  if (kcs.unitValue < kcs.cmin) return "poniżej przedziału cen próby";
  if (kcs.unitValue > kcs.cmax) return "powyżej przedziału cen próby";
  if (Math.abs(kcs.unitValue - kcs.csr) / kcs.csr < NEAR_AVERAGE) {
    return "w przedziale cen próby, zbliżona do średniej";
  }
  return kcs.unitValue > kcs.csr
    ? "w przedziale cen próby, powyżej średniej"
    : "w przedziale cen próby, poniżej średniej";
}

/**
 * The facts dictionary sent for ALL requested sections at once (one shared
 * dict, per the T3 contract — never per-section subsets). Absent data is
 * OMITTED, never guessed: a key the draft cannot back is a key the model must
 * not see.
 */
export function buildProseFacts({ address, inputs }: ProseFactsInput): ProseFacts {
  const kcs = proseKcs(inputs);
  const subject = inputs.subject ?? null;
  const note = inputs.inspection?.note ?? null;

  // ALL-OR-NOTHING, for the months here and for the areas below. `date` and
  // `area` are both OPTIONAL on a manually entered comparable, so a mixed
  // sample is a normal flow — while `liczba_transakcji` counts EVERY
  // comparable. An aggregate built from a subset would therefore attribute the
  // subset's span to the whole sample ("3 transakcje" spanning
  // "11-2024 – 11-2024"), and the worker's number guard cannot catch it,
  // because every number in it IS in the facts. A missing aggregate is honest;
  // a partial one is a falsifiable untruth inside an operat.
  const months = inputs.comparables.map((c) => monthOf(c.date)).filter((m) => m !== null);
  const ordered =
    months.length === inputs.comparables.length
      ? [...months].sort((a, b) => a.order - b.order)
      : [];
  const withArea = inputs.comparables.filter(
    (c): c is Comparable & { area: number } => c.area != null && c.area > 0,
  );
  const everyAreaKnown = withArea.length === inputs.comparables.length;
  const areas = everyAreaKnown ? minMax(withArea.map((c) => c.area)) : null;
  // Each comparable's OWN area — "what those flats actually sold for". The
  // subject's area × sample prices would put a number adjacent to WR in front
  // of the model (F-11).
  const totals = everyAreaKnown ? minMax(withArea.map((c) => c.pricePerM2 * c.area)) : null;

  const proba: ProseSampleFacts | null = kcs
    ? {
        liczba_transakcji: inputs.comparables.length,
        ...(ordered.length > 0
          ? {
              zakres_dat: `${ordered[0].label} ${RANGE_SEPARATOR} ${ordered[ordered.length - 1].label}`,
            }
          : {}),
        ...(areas
          ? { pow_min_m2: formatNumber(areas.min, 2), pow_max_m2: formatNumber(areas.max, 2) }
          : {}),
        cena_min_zl_m2: formatPln(kcs.cmin),
        cena_srednia_zl_m2: formatPln(kcs.csr),
        cena_max_zl_m2: formatPln(kcs.cmax),
        ...(totals
          ? {
              cena_calkowita_min_zl: formatNumber(totals.min, 0),
              cena_calkowita_max_zl: formatNumber(totals.max, 0),
            }
          : {}),
      }
    : null;

  // Weight-0 features stay out of the operat entirely (buildDocumentModel does
  // the same), so they stay out of the prose the operat will quote.
  const rated = inputs.features.filter((f) => f.weight > 0);
  // A result computed from zero effective weight is a confident falsehood
  // (sumUi 0 → unitValue 0 → "below the sample"), so the position is offered
  // only when at least one feature actually carries weight.
  const position = kcs && rated.length > 0 ? resultPosition(kcs) : null;

  return {
    adres: address,
    // No `dzielnica` anywhere in the snapshot — omitted rather than guessed
    // from the address (the prompt tolerates its absence).
    ...(subject?.obreb ? { obreb: subject.obreb } : {}),
    pow_uzytkowa: formatNumber(inputs.area, 2),
    rynek: `${RYNEK_BASE}, ${cityFromAddress(address)}`,
    ...(proba ? { proba } : {}),
    ...(subject?.nrDzialki ? { nr_dzialki: subject.nrDzialki } : {}),
    ...(subject?.powEwidHa != null
      ? { pow_dzialki_m2: formatNumber(subject.powEwidHa * M2_PER_HA, 0) }
      : {}),
    ...(subject?.uzytek ? { uzytek: subject.uzytek } : {}),
    ...(subject?.budynekRodzaj ? { budynek_rodzaj: subject.budynekRodzaj } : {}),
    // Above-ground storeys only — the few-shot writes a single figure, while
    // the operat table's "5 / 1" pairs it with the underground count.
    ...(subject?.kondygnacjeNadziemne != null
      ? { kondygnacje: String(subject.kondygnacjeNadziemne) }
      : {}),
    ...(subject?.rokBudowy != null ? { rok_budowy: String(subject.rokBudowy) } : {}),
    // ONE inspection note under four keys: `InspectionSnapshot` carries a
    // single `note`, and the key names are part of the validated few-shot —
    // each section's task cuts its own thread out of the note.
    ...(note
      ? {
          notatka_uklad: note,
          notatka_otoczenie: note,
          notatka_standard: note,
          notatka_zagospodarowanie: note,
        }
      : {}),
    ...(rated.length > 0
      ? { oceny_cech: Object.fromEntries(rated.map((f) => [f.name, LEVEL_LABEL[f.rating]])) }
      : {}),
    ...(position ? { pozycja_wyniku: position } : {}),
  };
}

/**
 * The sample as the worker wants it: "MM-RRRR" + a numeric price, outside the
 * facts. All-or-nothing, same doctrine as the aggregates above: the worker
 * collapses these into `proba.trend_cen`, a claim about how prices moved ACROSS
 * THE SAMPLE. Computed from the dated subset it would describe a different
 * sample than the one the operat presents — a partial aggregate dressed as a
 * complete one, which is exactly the untruth the aggregates were fixed for.
 * One dateless comparable and the trend claim is simply not made.
 */
export function buildProseTransactions(comparables: Comparable[]): ProseTransactionPayload[] {
  const months = comparables.map((c) => monthOf(c.date));
  if (months.some((m) => m === null)) return [];
  return comparables.map((c, i) => ({ data: months[i]!.label, cena_m2: c.pricePerM2 }));
}

/**
 * Which sections are worth an LLM call. A section whose facts are missing is
 * NOT a transient failure: the model would invent the missing number, the
 * guard would reject it twice, and the field would be permanently unfillable
 * (T3 contract). Skipping it costs nothing and saves the tokens.
 */
export function selectProseSections(facts: ProseFacts): ProseSection[] {
  const has: Record<ProseSection, boolean> = {
    // A sample is enough. The derived aggregates (date range, area band, total
    // price range) are all-or-nothing by construction, so a missing one is
    // ABSENT rather than partial, and the style guide tells the model to drop
    // a thread it has no fact for. Demanding all three used to withhold the
    // whole section — and §11 no longer carries any static scaffolding, so the
    // appraiser was left writing the market analysis from nothing. One
    // comparable without a date is a normal flow here, so that was the common
    // case, not the edge. Worst case now is a section the guard rejects, which
    // lands in exactly the same empty editor as before.
    analiza_rynku: Boolean(facts.proba),
    opis_lokalu: Boolean(facts.notatka_uklad),
    otoczenie: Boolean(facts.notatka_otoczenie),
    zagospodarowanie: Boolean(
      facts.notatka_zagospodarowanie ||
      facts.nr_dzialki ||
      facts.pow_dzialki_m2 ||
      facts.uzytek ||
      facts.budynek_rodzaj ||
      facts.kondygnacje ||
      facts.rok_budowy,
    ),
    standard: Boolean(facts.notatka_standard || facts.oceny_cech),
    uzasadnienie: Boolean(facts.pozycja_wyniku && facts.proba),
  };
  return PROSE_SECTIONS.filter((section) => has[section]);
}

/**
 * Sections whose stored text no longer matches the facts behind them. Absent
 * fingerprint counts as stale (pre-change snapshots) — see `factsHashes`.
 *
 * `currentHash` is INJECTED rather than called directly (F-10): this module
 * must stay importable from a Client Component (the step-6 editors), and
 * `currentSectionFactsHash` needs `node:crypto`, which lives only in
 * `prose-hash.ts`. The caller — a Server Component or a server action —
 * supplies `currentSectionFactsHash` itself.
 */
export function staleProseSections(
  snapshot: Pick<ProseSnapshot, "sections" | "factsHashes"> | null | undefined,
  input: ProseFactsInput,
  currentHash: (section: ProseSection, input: ProseFactsInput) => string,
): ProseSection[] {
  if (!snapshot) return [];
  return PROSE_SECTIONS.filter((section) => {
    if (!snapshot.sections[section]) return false;
    return snapshot.factsHashes[section] !== currentHash(section, input);
  });
}

export type ProseProposalOutcome = {
  sections: Partial<Record<ProseSection, string>>;
  rejected: Partial<Record<ProseSection, string[]>>;
  model: string;
  factsHashes: Partial<Record<ProseSection, string>>;
  /** Passed in by the caller — the domain never reads the clock (F-2). */
  generatedAt: Date;
};

/**
 * The ACL boundary for generated prose (ADR-010): a proposal can only ever be
 * `{ source: "ai", status: "to_verify" }`. "confirmed" is the appraiser's
 * word alone, assigned when they accept the text — never here.
 */
export function proseSnapshotOf(outcome: ProseProposalOutcome): ProseSnapshot {
  const sections: Partial<Record<ProseSection, Sourced<string>>> = {};
  for (const section of PROSE_SECTIONS) {
    const text = outcome.sections[section];
    if (text) sections[section] = sourced(text, "ai", "to_verify");
  }
  return {
    sections,
    rejected: outcome.rejected,
    factsHashes: outcome.factsHashes,
    model: outcome.model,
    generatedAt: outcome.generatedAt.toISOString(),
  };
}
