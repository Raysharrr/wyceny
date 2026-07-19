import type { KcsInput, KcsResult, FeatureRating } from "./kcs";
import type { Blocker } from "./provenance";

/**
 * Operat document model + professional-secrecy masking (F-12).
 *
 * Pure (F-10: zero I/O, zero adapter imports). Everything the DOCX template
 * needs, pre-formatted as Polish strings — the renderer does string
 * substitution only. Masking happens HERE, in one place: comparable rows
 * expose only month (YYYY-MM), no transactionId, no provenance internals
 * (wyrok SN II CSK 369/11; spec §6).
 */

export type OperatPurpose = "sprzedaz" | "zabezpieczenie_kredytu" | "informacyjny";

/** Document phrase per purpose ("Operat sporządzono {cel}"). */
export const PURPOSE_TEXT: Record<OperatPurpose, string> = {
  sprzedaz: "dla potrzeb sprzedaży",
  zabezpieczenie_kredytu: "dla potrzeb zabezpieczenia wierzytelności kredytodawcy",
  informacyjny: "dla celów informacyjnych",
};

/** Polish UI labels for the create-form select. */
export const PURPOSE_LABEL: Record<OperatPurpose, string> = {
  sprzedaz: "Sprzedaż",
  zabezpieczenie_kredytu: "Zabezpieczenie kredytu",
  informacyjny: "Informacyjny",
};

const RATING_TEXT: Record<FeatureRating, string> = {
  lepsza: "wartość najwyższa cechy",
  przecietna: "wartość pośrednia cechy",
  gorsza: "wartość najniższa cechy",
};

/** Document label per rating level — the internal enum stays diacritic-free. */
const LEVEL_LABEL: Record<FeatureRating, string> = {
  lepsza: "lepsza",
  przecietna: "przeciętna",
  gorsza: "gorsza",
};

/** Document order of rating levels in the §12.1 scale block. */
const LEVEL_ORDER: FeatureRating[] = ["lepsza", "przecietna", "gorsza"];

const NBSP = "\u00A0"; // non-breaking space (escape — a pasted literal is invisible to review)
const DASH = "—";
const ROK_BUDOWY_BD = "b.d. (brak w publicznej ewidencji)";

/** `kw.source` → document phrase for `{kw_zrodlo}` ("Badanie ksiąg wieczystych na podstawie: …"). */
const KW_ZRODLO_TEXT = { akt: "akt notarialny", odpis_kw: "odpis księgi wieczystej" } as const;

/** `1044400` → `"1 044 400,00"` (NBSP thousands separator — matches the source operat). */
export function formatPln(value: number): string {
  return formatNumber(value, 2);
}

export function formatNumber(value: number, dp: number): string {
  const [int, frac] = value.toFixed(dp).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return frac ? `${grouped},${frac}` : grouped;
}

/**
 * ISO date (or full ISO datetime) → `DD.MM.YYYY`. Defensive: `mpzpData` is
 * free-text (subjectSchema only validates it when non-empty, and legacy
 * inputs predate that validation), so a non-ISO value passes through raw
 * rather than producing `undefined.undefined.<raw>`.
 */
export function formatDatePl(iso: string): string {
  const trimmed = iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed;
  const [y, m, d] = trimmed.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

/** F-12 masking: full transaction date → month only; absent → em dash. */
function maskMonth(date: string | undefined): string {
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : DASH;
}

/** Best-effort city from the subject address ("ul. X 1, Poznań" → "Poznań"). */
function cityFromAddress(address: string): string {
  const afterComma = address.split(",").pop()?.trim();
  return afterComma && afterComma.length > 0 ? afterComma : DASH;
}

/**
 * Appends a period ONLY when `text` doesn't already end in sentence-final
 * punctuation (`.`/`!`/`?`). Shared guard behind `terminateEntries` (dział
 * III/IV loop entries, below) and `skala_ocen`'s `def` field (§12.1
 * rating-scale loop, Slice 7 Task 8 review fix F1) — both turn a
 * user-authored fragment into a complete sentence before docxtemplater
 * emits it into a template loop with no separator between iterations.
 */
function terminateSentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * T9 handoff: the template's `{#dzial3_wpisy}Dział III — wpis: {.}{/dzial3_wpisy}`
 * loop repeats the label per entry with no separator between iterations, so
 * 2+ entries would otherwise run together (`…wpisDział III — wpis: …`).
 * Template tags are FINAL — fixed here by terminating each entry with a
 * period (+ trailing space) so repeated iterations read as separate sentences.
 */
function terminateEntries(tresc: string[]): string[] {
  return tresc.map((t) => `${terminateSentence(t)} `);
}

/** Polish list join for feature names: "a, b oraz c" (single name unchanged). */
function polishFeatureList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} oraz ${names[names.length - 1]}`;
}

export type TransactionRow = {
  data_msc: string;
  miasto: string;
  ulica: string;
  pow: string;
  cena_jedn: string;
};

export type FeatureRow = {
  nazwa: string;
  waga_pct: string;
  ui_min: string;
  ui_sr: string;
  ui_max: string;
  ui_przedmiot: string;
};

/** Section 9 MPZP block (§`{#mpzp}`) — only present when a plan resolved. */
export type MpzpBlock = {
  symbol: string;
  nazwa: string;
  uchwala: string;
  data: string;
  publ: string;
};

export type DocumentModel = {
  adres: string;
  powierzchnia: string;
  cel: string;
  nr_kw: string;
  klient: string;
  data_ogledzin: string;
  data_sporzadzenia: string;
  // EGiB/building facts (section 8.2) — from the auto-fetched subject snapshot;
  // dashes when no subject was fetched (legacy manual-entry inputs).
  obreb: string;
  arkusz: string;
  nr_dzialki: string;
  pow_dzialki: string;
  uzytek: string;
  budynek_rodzaj: string;
  kondygnacje: string;
  rok_budowy: string;
  // Section 8.2 KW examination block (Slice 6). `kw_standard`/`kw_deweloperski`
  // are a mutually exclusive PAIR (never both, always exactly one when
  // kw_badanie), structurally derived from `kw.deweloperski`. `dzialN_brak`/
  // `dzialN_wpisy` are mutually exclusive but NOT exhaustive — both are
  // false/empty when the source document never examined that dział (e.g. an
  // akt notarialny carries no dział III/IV info): rendering "brak wpisów" in
  // that case would fabricate a clean-title/no-mortgage claim, so the model
  // renders nothing instead (honest silence) rather than a false "never
  // neither" guarantee. All false/empty/dash when `inputs.kw` is absent (legacy).
  kw_badanie: boolean;
  kw_standard: boolean;
  kw_deweloperski: boolean;
  kw_zrodlo: string;
  kw_lokalu: string;
  kw_gruntu: string;
  kw_sad: string;
  kw_wydzial: string;
  kw_data_dok: string;
  // STUB_KW paragraph (the {nr_kw} line): its second sentence ("Pełna treść
  // odpisu KW pozostaje…") renders ONLY when the title info could come from a KW
  // excerpt — legacy/manual (kw == null) and the "odpis_kw" source. Under an
  // "akt" (deed) source it is hidden, so the operat never implies possession of a
  // KW excerpt it may not hold (final-review #5b).
  kw_stub_odpis: boolean;
  udzial_kw: string;
  pow_kw_present: boolean;
  pow_uzytkowa_kw: string;
  dzial3_brak: boolean;
  dzial3_wpisy: string[];
  dzial4_brak: boolean;
  dzial4_wpisy: string[];
  // Section 9 MPZP variants — `{#mpzp}`/`{#mpzp_brak}` are mutually exclusive,
  // enforced here (never both, never neither, when a subject is present).
  mpzp: MpzpBlock | null;
  mpzp_brak: boolean;
  przeznaczenie_studium: string;
  wr: string;
  wr_slownie: string;
  wr_dokladna: string;
  cena_min: string;
  cena_max: string;
  cena_sr: string;
  polozenie_sr: string;
  vmin: string;
  vmax: string;
  suma_ui: string;
  cena_1m2: string;
  kredyt: boolean;
  transakcje: TransactionRow[];
  cechy: FeatureRow[];
  opis_cmin: string[];
  opis_cmax: string[];
  opis_przedmiot: string[];
  /** §12.1 rating-scale definitions — one row per active feature; only non-empty levels print. */
  skala_ocen: Array<{ cecha: string; poziomy: Array<{ poziom: string; def: string }> }>;
  /** §12.1 intro — active feature names in bag order ("a, b oraz c"). */
  cechy_lista: string;
  /** §13 — active feature names sorted by weight descending (stable ties). */
  cechy_lista_wg_wag: string;
  /** §13 — "N atrybutów" / "1 atrybutu" (genitive after "za pomocą"). */
  liczba_atrybutow_fraza: string;
  /** Honest-silence flag: the §12.1 scale block renders only when true. */
  ma_skale: boolean;
};

export type DocumentFields = {
  purpose: string | null;
  kwNumber: string | null;
  client: string | null;
  inspectionDate: string | null;
};

/** Approval blockers for document fields (spec §4) — Polish UI copy like the F-4 gate. */
export function documentFieldBlockers(v: DocumentFields): Blocker[] {
  const blockers: Blocker[] = [];
  if (!v.purpose) blockers.push({ path: "purpose", label: "Cel wyceny — brak." });
  if (!v.kwNumber) blockers.push({ path: "kwNumber", label: "Numer księgi wieczystej — brak." });
  if (!v.client) blockers.push({ path: "client", label: "Klient — brak." });
  if (!v.inspectionDate) blockers.push({ path: "inspectionDate", label: "Data oględzin — brak." });
  return blockers;
}

export type BuildDocumentInput = {
  address: string;
  area: number;
  purpose: OperatPurpose;
  kwNumber: string;
  client: string;
  /** ISO date from the form (YYYY-MM-DD). */
  inspectionDate: string;
  /** Deterministic input — the approve mutation's timestamp, never read here. */
  approvedAt: Date;
  inputs: KcsInput;
  kcs: KcsResult;
  amountInWords: string;
};

export function buildDocumentModel(input: BuildDocumentInput): DocumentModel {
  const { kcs, inputs } = input;
  const city = cityFromAddress(input.address);
  const subject = inputs.subject ?? null;
  // `{#mpzp}` only when a subject was fetched, MPZP isn't flagged absent, and
  // at least one plan field resolved — keeps it mutually exclusive with
  // `mpzp_brak` (Task 7 review note: the template doesn't enforce this itself).
  const hasMpzp =
    subject != null &&
    subject.mpzpAbsent !== true &&
    Boolean(subject.mpzpSymbol || subject.mpzpNazwa || subject.mpzpUchwala);
  const kw = inputs.kw ?? null;

  // Weight-0 features stay out of the legal document entirely (workshop
  // decision: "pancerz obronny" — a zero-weight row invites challenge).
  const activeFeatures = inputs.features.filter((f) => f.weight > 0);
  const activeUi = kcs.ui.filter((f) => f.weight > 0);
  const skalaOcen = activeFeatures
    .map((f) => ({
      cecha: f.name,
      poziomy: LEVEL_ORDER.filter((level) => f.definitions?.[level]?.trim()).map((level) => ({
        poziom: LEVEL_LABEL[level],
        def: terminateSentence(f.definitions![level]!.trim()),
      })),
    }))
    .filter((row) => row.poziomy.length > 0);

  return {
    adres: input.address,
    powierzchnia: formatNumber(input.area, 2),
    cel: PURPOSE_TEXT[input.purpose],
    nr_kw: input.kwNumber,
    klient: input.client,
    data_ogledzin: formatDatePl(input.inspectionDate),
    data_sporzadzenia: formatDatePl(input.approvedAt.toISOString()),
    obreb: subject?.obreb || DASH,
    arkusz: subject?.arkusz || DASH,
    nr_dzialki: subject?.nrDzialki || DASH,
    pow_dzialki: subject?.powEwidHa != null ? formatNumber(subject.powEwidHa, 4) : DASH,
    uzytek: subject?.uzytek || DASH,
    budynek_rodzaj: subject?.budynekRodzaj || DASH,
    kondygnacje: subject
      ? `${subject.kondygnacjeNadziemne ?? DASH} / ${subject.kondygnacjePodziemne ?? DASH}`
      : DASH,
    rok_budowy: subject?.rokBudowy != null ? String(subject.rokBudowy) : ROK_BUDOWY_BD,
    kw_badanie: kw != null,
    kw_standard: kw != null && !kw.deweloperski,
    kw_deweloperski: kw != null && kw.deweloperski,
    kw_zrodlo: kw ? KW_ZRODLO_TEXT[kw.source] : DASH,
    kw_lokalu: kw?.kwLokalu ?? DASH,
    kw_gruntu: kw?.kwGruntu ?? DASH,
    kw_sad: kw?.sad ?? DASH,
    kw_wydzial: kw?.wydzial ?? DASH,
    kw_data_dok: kw?.dataDokumentu ? formatDatePl(kw.dataDokumentu) : DASH,
    // Legacy/manual (kw == null) and odpis_kw source keep the sentence (accurate);
    // an akt (deed) source hides it — no false claim of holding a KW excerpt.
    kw_stub_odpis: kw == null || kw.source === "odpis_kw",
    // Honest udział: the "wg odpisu księgi wieczystej" annotation is a LEGACY
    // fallback for pre-Slice-6 rows that never examined a KW (kw == null). When
    // a KW WAS examined (kw != null) but the extract carries no udział, render a
    // dash — the document must not claim the share was "per the KW excerpt"
    // when the excerpt (or akt) never stated it.
    udzial_kw: kw == null ? "wg odpisu księgi wieczystej" : (kw.udzial ?? DASH),
    pow_kw_present: kw?.powUzytkowaKw != null,
    pow_uzytkowa_kw: kw?.powUzytkowaKw != null ? formatNumber(kw.powUzytkowaKw, 2) : DASH,
    // dzialN == null means the source document carries NO dział info (e.g. an
    // akt notarialny) — that must render NOTHING, not "brak wpisów" (a
    // fabricated clean-title/no-mortgage claim). brak is true ONLY when the
    // dział was actually examined (non-null) and came back empty.
    dzial3_brak: kw != null && kw.dzial3 != null && !kw.dzial3.wpisy,
    dzial3_wpisy: kw?.dzial3?.wpisy ? terminateEntries(kw.dzial3.tresc) : [],
    dzial4_brak: kw != null && kw.dzial4 != null && !kw.dzial4.wpisy,
    dzial4_wpisy: kw?.dzial4?.wpisy ? terminateEntries(kw.dzial4.tresc) : [],
    mpzp: hasMpzp
      ? {
          symbol: subject.mpzpSymbol ?? "",
          nazwa: subject.mpzpNazwa ?? "",
          uchwala: subject.mpzpUchwala ?? "",
          data: subject.mpzpData ? formatDatePl(subject.mpzpData) : "",
          publ: subject.mpzpPubl ?? "",
        }
      : null,
    mpzp_brak: subject?.mpzpAbsent === true,
    przeznaczenie_studium: subject?.przeznaczenieStudium || DASH,
    wr: formatPln(kcs.wr),
    wr_slownie: input.amountInWords,
    wr_dokladna: formatPln(kcs.wrUnrounded),
    cena_min: formatPln(kcs.cmin),
    cena_max: formatPln(kcs.cmax),
    cena_sr: formatPln(kcs.csr),
    // Guard: identical prices (cmax === cmin) would divide by zero.
    polozenie_sr:
      kcs.cmax === kcs.cmin
        ? "0,000"
        : formatNumber((kcs.csr - kcs.cmin) / (kcs.cmax - kcs.cmin), 3),
    vmin: formatNumber(kcs.vmin, 3),
    vmax: formatNumber(kcs.vmax, 3),
    suma_ui: formatNumber(kcs.sumUi, 3),
    cena_1m2: formatPln(kcs.unitValue),
    kredyt: input.purpose === "zabezpieczenie_kredytu",
    transakcje: inputs.comparables.map((c) => ({
      data_msc: maskMonth(c.date),
      miasto: city,
      // ponytail: RCN comparables carry no street today — masked column shows
      // a dash until a street-bearing source exists (masking then applies).
      ulica: "—",
      pow: c.area != null ? formatNumber(c.area, 2) : "—",
      cena_jedn: formatPln(c.pricePerM2),
    })),
    cechy: activeUi.map((f) => ({
      nazwa: f.name,
      waga_pct: formatNumber(f.weight * 100, 0),
      ui_min: formatNumber(f.weight * kcs.vmin, 3),
      ui_sr: formatNumber(f.weight, 3),
      ui_max: formatNumber(f.weight * kcs.vmax, 3),
      ui_przedmiot: formatNumber(f.value, 3),
    })),
    // ponytail: canonical KCS simplification — cmin lokal = all features at
    // worst, cmax = all at best; the subject follows its actual ratings.
    opis_cmin: activeFeatures.map((f) => `${f.name} – wartość najniższa cechy,`),
    opis_cmax: activeFeatures.map((f) => `${f.name} – wartość najwyższa cechy,`),
    opis_przedmiot: activeFeatures.map((f) => `${f.name} – ${RATING_TEXT[f.rating]},`),
    skala_ocen: skalaOcen,
    cechy_lista: polishFeatureList(activeFeatures.map((f) => f.name)),
    cechy_lista_wg_wag: polishFeatureList(
      [...activeFeatures].sort((a, b) => b.weight - a.weight).map((f) => f.name),
    ),
    liczba_atrybutow_fraza: `${activeFeatures.length} ${activeFeatures.length === 1 ? "atrybutu" : "atrybutów"}`,
    ma_skale: skalaOcen.length > 0,
  };
}
