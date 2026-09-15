import type { Comparable, Feature, KcsInput, KcsResult, FeatureRating } from "./kcs";
import { LEVEL_LABEL } from "./feature-presets";
import {
  describedLevels,
  levelForValue,
  ratingPosition,
  type RatingPosition,
} from "./feature-rules";
import { kwRequirements } from "./kw-requirements";
import { PROPERTY_RIGHT_DOC, type PropertyRight } from "./property-right";
import { PROSE_SECTION_LABEL, type ProseSection } from "./prose-snapshot";
import type { Blocker } from "./provenance";
import { cityLabel } from "./obreb-name";
import { DASH, operatStreet } from "./street-name";
import { candidateKey, type Candidate } from "./sample-selection";

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

/**
 * §12.2 wording for a rating's POSITION in the described scale (ADR-016 reg. 6,
 * D-54) — not for the level's own key. With lepsza/przeciętna described and
 * „przeciętna” chosen, the operat says „wartość najniższa cechy”, because that
 * is what the appraiser's own two-level scale makes it. The 14.09 operat said
 * „pośrednia” and the appraiser corrected it by hand.
 */
const POSITION_TEXT: Record<RatingPosition, string> = {
  min: "wartość najniższa cechy",
  mid: "wartość pośrednia cechy",
  max: "wartość najwyższa cechy",
};

/**
 * §12.2 wording for a feature whose rating CANNOT come from the register: it
 * has no numeric thresholds (standard, pomieszczenia przynależne…), or the
 * transaction carries no value to place in them. The 14.09 operat printed
 * „wartość najwyższa cechy” for every such feature of the Cmax flat — a claim
 * about data nobody had (D-52).
 *
 * Wording awaits the user's acceptance (HANDOFF §FH.3) — one constant, so
 * changing it costs a line.
 */
export const OCENA_SPOZA_REJESTRU = "brak danych w rejestrze do oceny tej cechy";

// Re-exported so the prose facts (`domain/prose.ts`) keep naming the levels
// from here; defined beside the levels themselves (the ADR-016 blockers use it too).
export { LEVEL_LABEL };

/** Document order of rating levels in the §12.1 scale block. */
const LEVEL_ORDER: FeatureRating[] = ["lepsza", "przecietna", "gorsza"];

const NBSP = "\u00A0"; // non-breaking space (escape — a pasted literal is invisible to review)

const ROK_BUDOWY_BD = "b.d. (brak w publicznej ewidencji)";

/**
 * `kw.source` → document phrase for `{kw_zrodlo}` ("Badanie ksiąg wieczystych
 * na podstawie: …"). `ekw_reczne` names what the appraiser actually did — read
 * the book in the eKW browser — because the operat may never describe a
 * document nobody held (ADR-018 reg. 4). Note `kw_stub_odpis` below already
 * excludes this source from the "pełna treść odpisu pozostaje w dokumentacji"
 * sentence, which is the whole point. The §7 wording of the examination
 * protocol belongs to `b1-template`; this phrase is the honest minimum until
 * it lands.
 */
const KW_ZRODLO_TEXT = {
  akt: "akt notarialny",
  odpis_kw: "odpis księgi wieczystej",
  ekw_reczne: "badanie księgi wieczystej w systemie eKW",
} as const;

/**
 * The §1 Wyciąg cell's own area sentence — the template prints it through an
 * INVERTED wrap ({^ma_proza_opis_lokalu}), i.e. only while `opis_lokalu` is
 * empty, because the generated description opens with this very sentence and
 * would otherwise state the area twice. Kept here character-for-character
 * identical to the template's copy: `previewMarker` has to reproduce it when
 * it opens that wrap (see `buildDocumentModel`).
 */
function lokalAreaSentence(area: number): string {
  return `Lokal mieszkalny o powierzchni użytkowej ${formatNumber(area, 2)} m2.`;
}

/**
 * PREVIEW ONLY — the marker a section the appraiser has not written yet gets
 * in the on-screen preview (spec §C: preview and issued operat differ by the
 * date and by these markers, and by nothing else). The issued document says
 * nothing about such a section, exactly as before.
 *
 * THE TOKEN LEADS, before the section's name. It has to: the marker prints in
 * the section's own body style, and the first rendering showed the two ways
 * that let it pass for content — under §8.1 it continued a true sentence
 * inside the same paragraph ("…pod adresem: {adres}. Charakterystyka…"), and
 * under §11 it restated the heading standing directly above it, which is
 * precisely what a generated section's opening sentence does. A bracketed
 * token in front stops both readings before the eye reaches the label.
 * Styling it instead would mean editing the template — F-12, another repo.
 *
 * "PODGLĄD" rather than "brak treści" alone, because the one thing the reader
 * must not doubt is that this line belongs to the preview and to no issued
 * operat. Polish, because the appraiser reads it; it names the section, and it
 * says why the space is empty rather than only that it is — the useful fact is
 * that the section is theirs to fill in on step 6.
 *
 * The closing clause is deliberately neutral about WHAT disappears — for
 * `otoczenie` and `zagospodarowanie` the surrounding paragraph keeps its
 * address sentence, so "the section will not appear at all" would be false.
 */
function previewMarker(section: ProseSection): string {
  return (
    `[PODGLĄD: BRAK TREŚCI] ${PROSE_SECTION_LABEL[section]} ${DASH} ` +
    "sekcja nie została uzupełniona w kroku 6. Opisy; " +
    "w wydanym operacie to miejsce pozostanie puste."
  );
}

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

const STREET_PREFIX_RX = /^(ul\.|pl\.|al\.|os\.)\s*/i;
/** "NN-NNN" only — a building range like "21-23" is \d{2}-\d{2} and stays intact. Global flag for `replace` only — never `.test()` this one. */
const POSTAL_CODE_RX = /\b\d{2}-\d{3}\b/g;
/** The worker's `parse_address` (apps/worker/app/rcn.py) assumes this city when none is given — keep the two in step. */
const DEFAULT_CITY = "Poznań";

/** A part with a street prefix or any digit is the street half, whichever side of the comma it sits on. */
function looksLikeStreet(part: string): boolean {
  return STREET_PREFIX_RX.test(part) || /\d/.test(part);
}

/**
 * City from the subject address, accepting both comma orders — mirrors the
 * worker's `parse_address` (rcn.py) so the document agrees with the geocoder.
 * "ul. X 1, Poznań" → "Poznań"; "Poznań, X 1" (the form the address combobox
 * inserts) → "Poznań"; postal code dropped first ("61-619 Poznań" → "Poznań");
 * a trailing country never reaches the column ("…, Poznań, Polska" → "Poznań").
 * Staging 2026-08-20: the old last-comma rule put the subject's street into
 * every row of the operat's Table 1 and into the prose `rynek` fact.
 */
export function cityFromAddress(address: string): string {
  const cleaned = address
    .replace(POSTAL_CODE_RX, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) return DASH;
  const comma = cleaned.indexOf(",");
  if (comma === -1) {
    // ponytail: no city given — the worker geocodes a street-like input as
    // DEFAULT_CITY, so the sample (and this column) is that city too. A bare name
    // without digits is returned as written: the document does not guess.
    return looksLikeStreet(cleaned) ? DEFAULT_CITY : cleaned;
  }
  const first = cleaned.slice(0, comma).trim();
  const rest = cleaned.slice(comma + 1).trim();
  const cityHalf = looksLikeStreet(first) && !looksLikeStreet(rest) ? rest : first;
  // The worker keeps the whole half for geocoding; the document prints only its first segment.
  return cityHalf.split(",")[0].trim();
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

/**
 * One row of Table 1 — the layout of the reference operat (decision 2026-08-22):
 * `Data transakcji | Miasto | Ulica | Pow. uż. | Cena transakcyjna`. Obręb and distance
 * moved back to step 3 only; Aneta's operat does not carry them.
 *
 * `ulica` is the BARE NAME, not an address to be trimmed in the template — the house
 * number has no field here, so it cannot leak into the document by accident (F-12).
 */
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
  /** "—" when the feature's described scale has two levels — it has no middle (ADR-016 reg. 6). */
  ui_sr: string;
  ui_max: string;
  ui_przedmiot: string;
};

/** §12.2 — one comparable flat described feature by feature from its own data (D-52). */
export type ComparableDescription = {
  lokalizacja: string;
  cechy: Array<{ nazwa: string; opis: string }>;
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
  /** §8.1 map block caption ("dane pobrane {mapy_data}") — same source date as data_sporzadzenia. */
  mapy_data: string;
  // Author block (ADR-020 cz. 1). The title page, the two body paragraphs and
  // the signature block carried these as template LITERALS, which is how the
  // QA account issued an operat under another appraiser's name. They now come
  // from the profile of whoever is logged in; an em dash marks an incomplete
  // profile, which only the step-7 PREVIEW can reach — B-15 refuses to ISSUE
  // a document with a dash where its author should be.
  autor_imie_nazwisko: string;
  autor_uprawnienia: string;
  biuro: string;
  /**
   * "Załącznik nr 1" — one entry per rasterised page of the OC policy, in
   * document order (D-60). String markers, exactly like the inspection photo
   * loops: image bytes never travel inside the model, they are dispatched by
   * marker in `docx-render.ts`.
   */
  polisa_strony: Array<{ img: string }>;
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
  // Property right (T-12, S4) — the four mechanisms of the Piastowskie diff:
  // `prawo_wlasnosc`/`prawo_spoldzielcze` are a mutually exclusive pair (exactly
  // one true) switching the template's inline alternatives and fenced blocks;
  // `przedmiot_m`/`przedmiot_d` carry the subject phrase (nominative/genitive);
  // `ma_kw`/`kw_brak` are a second exclusive pair — the no-KW sentence prints
  // ONLY when the right has no księga of its own AND no number was given;
  // `ma_piwnice` prints the basement clause ONLY when the right has one AND
  // step 1 ticked the box (własność: never, whatever the stale checkbox says).
  prawo_wlasnosc: boolean;
  prawo_spoldzielcze: boolean;
  przedmiot_m: string;
  przedmiot_d: string;
  podstawa_prawa: string;
  ma_kw: boolean;
  kw_brak: boolean;
  klauzula_brak_kw: string;
  ma_piwnice: boolean;
  klauzula_piwnicy: string;
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
  /**
   * Σ of Tabela 3's Ui śr column — always the plain sum, so with weights adding
   * to 100 % it is "1,000".
   *
   * Ui min/śr/max come from the feature's WEIGHT and the Cmin–Cmax band, not
   * from how many levels its scale describes, so a two-level feature has a Ui
   * śr like any other — the appraiser simply can never land on it. The
   * reference operat (Kościelna) settles it: powierzchnia there has a
   * two-level scale, its Ui śr cell reads 0,100 and the SUMA row reads 1,000.
   */
  suma_ui_sr: string;
  cena_1m2: string;
  kredyt: boolean;
  transakcje: TransactionRow[];
  cechy: FeatureRow[];
  /**
   * §12.2 — the flats at the sample's lowest / highest unit price, one entry
   * each (a price tie describes every flat at it, D-53). `lokalizacja` is the
   * street without a house number, empty when the register has none; `cechy`
   * carries one line per active feature, derived from that flat's own data
   * (D-52). `b1-template` prints these; the flat `opis_cmin`/`opis_cmax`
   * below are the first flat's lines, the shape the template renders today.
   *
   * The piętro behind these lines is normalised per source
   * (`pietroOfCandidate`): RCN's kondygnacja loses one, the cooperative
   * register's hand-typed "Piętro" does not. Step 3's table still LABELS the
   * raw RCN kondygnacja "Piętro", so it shows one more than these sentences do
   * — the label fix is a follow-up of PR #58, not a defect of this value.
   */
  lokale_cmin: ComparableDescription[];
  lokale_cmax: ComparableDescription[];
  /** §12.2 street of the first flat at that price; "" when unknown — the template owns the sentence. */
  lokalizacja_cmin: string;
  lokalizacja_cmax: string;
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
  /** §8.3 "Uwagi z oględzin" block (Slice 10) — conditional, honest silence when empty. */
  ma_uwagi_ogledzin: boolean;
  uwagi_ogledzin: string;
  // The six prose sections (ADR-014, FR-6), each printed where the source
  // operat's own description used to stand: §11 market analysis, §8.1
  // surroundings, §8.4 site, §1+§8.3 flat description, §8.3 finish standard,
  // §13 justification. The text is the appraiser's, verbatim — the document
  // never substitutes a sentence of its own for a section they left empty
  // (stubs are exactly what this slice removed), so an absent section is "".
  //
  // …in the ISSUED document. Under `opts.preview` an absent section carries
  // `previewMarker(section)` instead, so the appraiser reading the preview
  // sees what is still missing (spec §C).
  proza_analiza_rynku: string;
  proza_otoczenie: string;
  proza_zagospodarowanie: string;
  proza_opis_lokalu: string;
  proza_standard: string;
  proza_uzasadnienie: string;
  // Honest silence, `ma_uwagi_ogledzin`'s pattern: the four sections that own
  // their paragraph in the template are wrapped in {#ma_proza_*}, so an empty
  // one leaves no blank line under its heading. `otoczenie` and
  // `zagospodarowanie` need no flag — they are trailing clauses of a paragraph
  // whose address sentence is true with or without prose.
  //
  // With the F-4 prose gate on (T7) an approved valuation always carries all
  // six; these flags are what an unapproved/legacy/kill-switched draft needs.
  //
  // Derived from the RESULTING text, not from the snapshot — which is what
  // makes a preview marker visible: the marker fills the section, so its wrap
  // opens and the block prints, with no second code path and no template
  // change.
  ma_proza_analiza_rynku: boolean;
  ma_proza_opis_lokalu: boolean;
  ma_proza_standard: boolean;
  ma_proza_uzasadnienie: boolean;
};

export type DocumentFields = {
  purpose: string | null;
  kwNumber: string | null;
  /**
   * Rodzaj prawa (T-12). Absent = legacy caller = własność, so the KW
   * number stays required (default-deny) — same rule as `approvalGate`.
   */
  propertyRight?: PropertyRight;
  client: string | null;
  inspectionDate: string | null;
  wr: number | null;
};

/** Approval blockers for document fields (spec §4) — Polish UI copy like the F-4 gate. */
export function documentFieldBlockers(v: DocumentFields): Blocker[] {
  const blockers: Blocker[] = [];
  if (!v.purpose) blockers.push({ path: "purpose", label: "Cel wyceny — brak." });
  if (!v.kwNumber && kwRequirements(v.propertyRight, null).numerKwWDokumencie)
    blockers.push({ path: "kwNumber", label: "Numer księgi wieczystej — brak." });
  if (!v.client) blockers.push({ path: "client", label: "Klient — brak." });
  if (!v.inspectionDate) blockers.push({ path: "inspectionDate", label: "Data oględzin — brak." });
  if (v.wr == null)
    blockers.push({
      path: "wr",
      label: "Wartość rynkowa — kalkulacja niezatwierdzona (krok 5. Kalkulacja).",
    });
  return blockers;
}

export type BuildDocumentInput = {
  address: string;
  area: number;
  purpose: OperatPurpose;
  /** null = no KW number given; with a coop right that prints the "nie założono KW" sentence (S4). */
  kwNumber: string | null;
  /** Rodzaj prawa (T-12) — `Valuation.propertyRight`, never null (legacy rows = własność). */
  propertyRight: PropertyRight;
  client: string;
  /** ISO date from the form (YYYY-MM-DD). */
  inspectionDate: string;
  /** Deterministic input — the approve mutation's timestamp, never read here. */
  approvedAt: Date;
  inputs: KcsInput;
  kcs: KcsResult;
  amountInWords: string;
  /** Who is issuing this operat (ADR-020 cz. 1) — the appraiser's own profile, never the template. */
  author: OperatAuthor;
};

/**
 * The author of the operat as the document prints them, assembled from
 * `appraiser_profile` by the app layer. Separate from `AppraiserProfile`
 * (the port's row shape): the document needs the policy PAGES, not the
 * storage prefix they live under, and it needs no validity date — B-16 has
 * already refused the issue if the policy does not cover it.
 */
export type OperatAuthor = {
  /** Empty string = an incomplete profile, reachable in the preview only (B-15). */
  fullName: string;
  licenseNo: string;
  officeBlock: string;
  /**
   * Rasterised policy pages in document order, as JPEG.
   *
   * ALWAYS EMPTY as of this session: the model turns the list into markers,
   * but nothing reads the pages back out of storage yet and `docx-render.ts`
   * has no "Załącznik nr 1" tag to dispatch them to — both belong to the
   * template session (plan §P1.9). Filling this array is the whole change on
   * this side when that lands.
   */
  policyPages: Buffer[];
};

/**
 * The sample candidate a comparable row came from, and whether the join is
 * EXACT (R-7). Extracted from Table 1's own join so §12.2 reads the Cmin/Cmax
 * flats' floor, area and street from the same place the table does — one join,
 * one set of rules, no second chance to disagree with it.
 *
 * Primary key: transactionId + lokalId (`candidateKey`) — one notarial act can
 * carry SEVERAL lokale (runtime bug, team-lead 2026-08-21, Heweliusza 3/43: a
 * transactionId-only join printed the SAME obręb/distance for every lokal of
 * one act). A comparable saved before `lokalId` existed falls back to matching
 * by transactionId alone, first candidate found — the only information those
 * legacy rows carry — but comes back `matched: false`, so the document prints
 * a dash rather than a guess about which lokal of the act it was.
 *
 * A coop-register row (S5, defekt D-3) has `lokalId: ""` (one lokal per row)
 * and `transactionId` = `coopTxId`, so the transactionId-only join IS exact for
 * it — that is what `matched` recognises.
 */
export function candidateOf(
  comparable: Pick<Comparable, "transactionId" | "lokalId" | "coopTxId">,
  selection: KcsInput["sampleSelection"],
): { candidate: Candidate; matched: boolean } | null {
  // Manual inclusions too (final wave, I1): a row the appraiser added that
  // later fell out of BOTH `proposed` and `alternates` after a radius change
  // exists only in `manualInclusions[].candidate` — omitting it made the join
  // miss it and print dashes for a row that IS in the sample.
  const candidates = selection
    ? [
        ...selection.proposed,
        ...selection.alternates,
        ...(selection.manualInclusions ?? []).map((i) => i.candidate),
      ]
    : [];
  const { transactionId, lokalId, coopTxId } = comparable;
  if (!transactionId) return null;
  const candidate = lokalId
    ? candidates.find((c) => candidateKey(c) === candidateKey({ transactionId, lokalId }))
    : candidates.find((c) => c.transactionId === transactionId);
  if (!candidate) return null;
  const matched = Boolean(lokalId) || (Boolean(coopTxId) && candidate.transactionId === coopTxId);
  return { candidate, matched };
}

/**
 * The transaction's PIĘTRO (parter = 0) — the unit the scale's bands and the
 * subject's own `pietro` are in, which is not the unit either register stores.
 *
 * RCN's `floor` is `lok_nr_kond`, a kondygnacja numbered from 1, so it loses
 * one. Measured, not assumed: across the 8 snapshot fixtures (80 000 rows)
 * `handlowoUslugowa` sits at 1 (839 of 976) and `garaz` at −1 (10 117 of
 * 11 779) — retail on the ground floor and garages one level below only line up
 * if parter is 1. Underground rows then come out negative and no band covers
 * them, which is the honest answer for a garage.
 *
 * The cooperative register's `floor` is hand-typed by the office under a
 * "Piętro" label, so it is taken as a piętro and NOT converted. That is a
 * reading of the label, not a measurement: every floor-bearing row in the
 * database belongs to our own E2E fixtures, so there is nothing to measure
 * (PR #58). An absent `source` is not treated as RCN — rows saved before the
 * field existed must not be silently shifted.
 */
function pietroOfCandidate(
  source: Comparable["source"],
  candidate: Candidate | null,
): number | null {
  const floor = candidate?.floor;
  if (floor == null) return null;
  return source === "rcn" ? floor - 1 : floor;
}

/**
 * §12.2 wording of ONE feature for ONE comparable flat (D-52). A measurable
 * feature is placed by the SAME thresholds the subject is placed by, reading
 * the transaction's own piętro or powierzchnia; everything else says outright
 * that the register does not carry the answer.
 *
 * The piętro comes from `pietroOfCandidate`, which converts the RCN
 * kondygnacja; the area comes from the row itself, falling back to the
 * candidate.
 */
function comparableFeatureText(
  feature: Feature,
  comparable: Pick<Comparable, "area" | "source">,
  candidate: Candidate | null,
): string {
  const measure = feature.measure;
  if (!measure) return OCENA_SPOZA_REJESTRU;
  const value =
    measure.kind === "floor"
      ? pietroOfCandidate(comparable.source, candidate)
      : (comparable.area ?? candidate?.area ?? null);
  const level = levelForValue(measure, value);
  if (!level) return OCENA_SPOZA_REJESTRU;
  // The wording follows the level's POSITION in the described scale, exactly
  // as the subject's own does (ADR-016 reg. 6).
  const position = ratingPosition({ rating: level, definitions: feature.definitions });
  return position ? POSITION_TEXT[position] : OCENA_SPOZA_REJESTRU;
}

/**
 * `opts.preview` builds the STEP-7 PREVIEW rather than the document that gets
 * issued: every prose section the appraiser has not written yet is marked
 * (`previewMarker`) instead of being passed over in silence. That, plus the
 * caller's `approvedAt` (today for a preview, the issue date for the real
 * thing), is the whole difference between the two renders — spec §C.
 *
 * The default is the ISSUED document, and only `previewOperat` passes the
 * flag. Approve and sign call this with one argument, so a marker cannot
 * reach a document that carries a signature.
 */
export function buildDocumentModel(
  input: BuildDocumentInput,
  opts?: { preview?: boolean },
): DocumentModel {
  const { kcs, inputs } = input;
  const subject = inputs.subject ?? null;
  // `{#mpzp}` only when a subject was fetched, MPZP isn't flagged absent, and
  // at least one plan field resolved — keeps it mutually exclusive with
  // `mpzp_brak` (Task 7 review note: the template doesn't enforce this itself).
  const hasMpzp =
    subject != null &&
    subject.mpzpAbsent !== true &&
    Boolean(subject.mpzpSymbol || subject.mpzpNazwa || subject.mpzpUchwala);
  const kw = inputs.kw ?? null;
  const rightDoc = PROPERTY_RIGHT_DOC[input.propertyRight];
  const kwBrak = rightDoc.klauzulaBrakKw !== null && !input.kwNumber;
  const maPiwnice = rightDoc.klauzulaPiwnicy !== null && inputs.hasBasement === true;
  // Blank reads as absent: `confirmProseSnapshot` already drops a field the
  // appraiser cleared, but a legacy or half-written snapshot (no gate when the
  // kill-switch is off) can still carry whitespace, and a paragraph of spaces
  // under a heading is the same lie as a stub.
  const proseText = (section: ProseSection): string => {
    const written = (inputs.prose?.sections[section]?.value ?? "").trim();
    if (written !== "" || opts?.preview !== true) return written;
    // The §8.3 description is the one section whose absence the template
    // ALREADY says something about: its {^ma_proza_opis_lokalu} inverted wrap
    // states the flat's area in the §1 Wyciąg cell while no description
    // stands there. Marking the section opens the wrap and silences that
    // sentence — so the marker carries it, and the preview keeps stating a
    // fact the issued operat states too. Anything less would be a THIRD
    // difference between the two renders, and one pointing the wrong way:
    // the preview would tell the appraiser less than the document they sign.
    // The area sentence comes FIRST and unchanged; the marker leads its own
    // text, not the whole cell.
    return section === "opis_lokalu"
      ? `${lokalAreaSentence(input.area)} ${previewMarker(section)}`
      : previewMarker(section);
  };
  const proza: Record<ProseSection, string> = {
    analiza_rynku: proseText("analiza_rynku"),
    opis_lokalu: proseText("opis_lokalu"),
    otoczenie: proseText("otoczenie"),
    zagospodarowanie: proseText("zagospodarowanie"),
    standard: proseText("standard"),
    uzasadnienie: proseText("uzasadnienie"),
  };

  // Weight-0 features stay out of the legal document entirely (workshop
  // decision: "pancerz obronny" — a zero-weight row invites challenge).
  // Ui rows zipped with the feature they were computed from BEFORE filtering,
  // so the two lists cannot drift apart. Tabela 3's dash (ADR-016 reg. 6) is a
  // property of the feature's SCALE, and a row carrying another feature's dash
  // would be invisible — every row still prints something, just the wrong
  // thing. (`computeKcs` returns one `ui` per input feature, in order.)
  const active = inputs.features
    .map((feature, i) => ({ feature, ui: kcs.ui[i] }))
    .filter(({ feature }) => feature.weight > 0);
  const activeFeatures = active.map((a) => a.feature);
  const skalaOcen = activeFeatures
    .map((f) => ({
      cecha: f.name,
      poziomy: LEVEL_ORDER.filter((level) => f.definitions?.[level]?.trim()).map((level) => ({
        poziom: LEVEL_LABEL[level],
        def: terminateSentence(f.definitions![level]!.trim()),
      })),
    }))
    .filter((row) => row.poziomy.length > 0);

  /**
   * §12.2 — the flats at the sample's lowest and highest unit price, each
   * described from ITS OWN data (D-51…D-53). A tie describes every flat at
   * that price; the 14.09 operat described one and dropped the other.
   */
  const lokaleAtPrice = (price: number) =>
    inputs.comparables
      .filter((c) => c.pricePerM2 === price)
      .map((row) => {
        const join = candidateOf(row, inputs.sampleSelection);
        const candidate = join?.matched ? join.candidate : null;
        return {
          // Street only, never the house number — professional secrecy (F-12,
          // D-51). Empty when the register has none: the template owns the
          // sentence, and an absent street must not become a dash mid-sentence.
          lokalizacja: candidate?.street ? operatStreet(candidate.street) : "",
          cechy: activeFeatures.map((f) => ({
            nazwa: f.name,
            opis: comparableFeatureText(f, row, candidate),
          })),
        };
      });
  const prices = inputs.comparables.map((c) => c.pricePerM2);
  const lokaleCmin = lokaleAtPrice(Math.min(...prices));
  const lokaleCmax = lokaleAtPrice(Math.max(...prices));
  const opisOf = (lokale: typeof lokaleCmin) =>
    (lokale[0]?.cechy ?? []).map((c) => `${c.nazwa} – ${c.opis},`);

  return {
    adres: input.address,
    powierzchnia: formatNumber(input.area, 2),
    cel: PURPOSE_TEXT[input.purpose],
    nr_kw: input.kwNumber || "—",
    klient: input.client,
    data_ogledzin: formatDatePl(input.inspectionDate),
    data_sporzadzenia: formatDatePl(input.approvedAt.toISOString()),
    mapy_data: formatDatePl(input.approvedAt.toISOString()),
    autor_imie_nazwisko: input.author.fullName || DASH,
    autor_uprawnienia: input.author.licenseNo || DASH,
    biuro: input.author.officeBlock || DASH,
    polisa_strony: input.author.policyPages.map((_, i) => ({ img: `polisa-${i}` })),
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
    prawo_wlasnosc: input.propertyRight === "wlasnosc_lokalu",
    prawo_spoldzielcze: input.propertyRight === "spoldzielcze_wlasnosciowe",
    przedmiot_m: rightDoc.przedmiot.mianownik,
    przedmiot_d: rightDoc.przedmiot.dopelniacz,
    podstawa_prawa: rightDoc.podstawaPrawna,
    ma_kw: !kwBrak,
    kw_brak: kwBrak,
    klauzula_brak_kw: kwBrak ? (rightDoc.klauzulaBrakKw ?? "") : "",
    ma_piwnice: maPiwnice,
    klauzula_piwnicy: maPiwnice ? (rightDoc.klauzulaPiwnicy ?? "") : "",
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
    transakcje: (() => {
      return inputs.comparables.map((c) => {
        const join = candidateOf(c, inputs.sampleSelection);
        const candidate = join?.candidate;
        const matched = join?.matched ?? false;
        return {
          data_msc: maskMonth(c.date),
          // Slice 3d: city and street from the transaction's OWN record (the GEOPOZ
          // export), never from the subject — the subject's city in every row was the
          // bug reported from staging. Manual rows, rows outside Poznań and rows whose
          // candidate fell out of the persisted snapshot print dashes.
          // Miasto z rekordu transakcji; gdy eksport go nie ma (transakcja spoza Poznania
          // albo lokal bez adresu), bierzemy je z TERYT-u — decyzja użytkownika
          // 2026-08-22: operat nie może stracić informacji o położeniu porównania,
          // którą miał przed 3d w kolumnie „Obręb”.
          miasto: matched ? (candidate!.city ?? cityLabel(candidate!.egib) ?? DASH) : DASH,
          ulica: matched ? operatStreet(candidate!.street) : DASH,
          pow: c.area != null ? formatNumber(c.area, 2) : DASH,
          cena_jedn: formatPln(c.pricePerM2),
        };
      });
    })(),
    cechy: active.map(({ ui, feature }) => ({
      nazwa: ui.name,
      waga_pct: formatNumber(ui.weight * 100, 0),
      ui_min: formatNumber(ui.weight * kcs.vmin, 3),
      ui_sr: formatNumber(ui.weight, 3),
      ui_max: formatNumber(ui.weight * kcs.vmax, 3),
      ui_przedmiot: formatNumber(ui.value, 3),
    })),
    suma_ui_sr: formatNumber(
      active.reduce((sum, { ui }) => sum + ui.weight, 0),
      3,
    ),
    lokale_cmin: lokaleCmin,
    lokale_cmax: lokaleCmax,
    lokalizacja_cmin: lokaleCmin[0]?.lokalizacja ?? "",
    lokalizacja_cmax: lokaleCmax[0]?.lokalizacja ?? "",
    opis_cmin: opisOf(lokaleCmin),
    opis_cmax: opisOf(lokaleCmax),
    opis_przedmiot: activeFeatures.map((f) => {
      const position = ratingPosition(f);
      return `${f.name} – ${position ? POSITION_TEXT[position] : DASH},`;
    }),
    skala_ocen: skalaOcen,
    cechy_lista: polishFeatureList(activeFeatures.map((f) => f.name)),
    cechy_lista_wg_wag: polishFeatureList(
      [...activeFeatures].sort((a, b) => b.weight - a.weight).map((f) => f.name),
    ),
    liczba_atrybutow_fraza: `${activeFeatures.length} ${activeFeatures.length === 1 ? "atrybutu" : "atrybutów"}`,
    ma_skale: skalaOcen.length > 0,
    ma_uwagi_ogledzin: Boolean(input.inputs.inspection?.note),
    uwagi_ogledzin: input.inputs.inspection?.note ?? "",
    proza_analiza_rynku: proza.analiza_rynku,
    proza_otoczenie: proza.otoczenie,
    proza_zagospodarowanie: proza.zagospodarowanie,
    proza_opis_lokalu: proza.opis_lokalu,
    proza_standard: proza.standard,
    proza_uzasadnienie: proza.uzasadnienie,
    ma_proza_analiza_rynku: proza.analiza_rynku !== "",
    ma_proza_opis_lokalu: proza.opis_lokalu !== "",
    ma_proza_standard: proza.standard !== "",
    ma_proza_uzasadnienie: proza.uzasadnienie !== "",
  };
}
