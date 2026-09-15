import type { KcsInput, KcsResult, FeatureRating } from "./kcs";
import { LEVEL_LABEL } from "./feature-presets";
import { kwRequirements } from "./kw-requirements";
import type { KwAkt, KwDzialSnapshot } from "./kw-snapshot";
import type { KsiegaTresc } from "./kw-tresc";
import { PROPERTY_RIGHT_DOC, type PropertyRight } from "./property-right";
import { PROSE_SECTION_LABEL, type ProseSection } from "./prose-snapshot";
import type { Blocker } from "./provenance";
import { cityLabel } from "./obreb-name";
import { DASH, operatStreet } from "./street-name";
import { candidateKey } from "./sample-selection";

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

/**
 * The separator between an eKW cell's values inside one column. A pipe, not a
 * comma: the cells themselves contain commas ("WIELKOPOLSKIE, M. POZNAŃ,
 * POZNAŃ M., POZNAŃ" is ONE cell), so a comma would blur the boundary between
 * cells into the boundary inside one. eKW never prints a pipe, so nothing in
 * the book can be mistaken for the separator. `b1-template` inherits this
 * choice — it cannot be undone from the rendered document.
 */
const KSIEGA_CELL_SEP = " | ";

/** A row whose only content is its first column (a heading, a "BRAK WPISÓW"). */
function soleRow(typ: KsiegaRow["typ"], kol1: string): KsiegaRow {
  return { typ, kol1, kol2: "", kol3: "" };
}

/**
 * The five dzialy as §8.2's table rows, in eKW's own order (spike RAPORT,
 * "Mapowanie na generator DOCX"). One flat list: a nested model would make the
 * template walk four levels, and template tags are the hardest thing here to
 * change later.
 */
function ksiegaRows(tresc: KsiegaTresc): KsiegaRow[] {
  const rows: KsiegaRow[] = [];
  for (const dzial of tresc.dzialy) {
    rows.push(soleRow("dzial", dzial.tytul));
    // A dział marked BRAK WPISÓW gets a row SAYING so. Emitting nothing would
    // leave the reader unable to tell "examined and empty" from "skipped" —
    // the same distinction `dzial3_brak` guards on the manual path.
    if (dzial.brakWpisow) rows.push(soleRow("brak", "BRAK WPISÓW"));
    for (const tabela of dzial.tabele) {
      if (tabela.naglowek) rows.push(soleRow("tabela", tabela.naglowek));
      for (const wpis of tabela.wpisy) {
        // Only an entry that eKW itself opened with "Lp. N." gets the row; a
        // single-entry table has `lp: null` and needs no opener.
        if (wpis.lp != null) {
          rows.push({
            typ: "lp",
            kol1: `Lp. ${wpis.lp}.`,
            kol2: "",
            kol3: wpis.nrPodstawyWpisu ?? "",
          });
        }
        for (const rubryka of wpis.rubryki) {
          rows.push({
            typ: "rubryka",
            kol1: rubryka.nazwa,
            kol2: rubryka.lp ?? "",
            kol3: rubryka.wartosci.join(KSIEGA_CELL_SEP),
          });
        }
      }
    }
    for (const dokument of dzial.dokumenty) {
      // The parenthesised field descriptions are part of the printout Aneta
      // pastes, so they ride with the line they describe rather than being
      // dropped as chrome.
      const join = (line: string | null, opis: string | null) =>
        [line, opis].filter((p) => p != null && p !== "").join(" ");
      rows.push({
        typ: "dokument",
        kol1: dokument.nrPodstawyWpisu,
        kol2: join(dokument.dokument, dokument.dokumentOpisPol),
        kol3: join(dokument.wniosek, dokument.wniosekOpisPol),
      });
    }
  }
  return rows;
}

/**
 * §8.2's examination protocol for one book (D-21). Copied CHARACTER FOR
 * CHARACTER from the office's own operats (`operat-starolecka.txt:291`,
 * `operat-polanka.txt`, `operat-kornik.txt` — all three agree), including the
 * spaceless "r.", the bare eKW domain and the closing colon. The HANDOFF
 * paraphrased it as "(źródło: przeglądarka eKW)"; the operats say the domain,
 * and a paraphrase is not a citation. The date goes through `formatDatePl`
 * because `dataBadania` is stored ISO and this is the first place it is
 * printed.
 *
 * The colon is safe: §8.2 always has content right after this sentence — the
 * transcribed dzialy, or, on the manual path, the dział III/IV sentences, which
 * exist because `kwRequirements` refuses a book whose dzialy are unanswered.
 *
 * Returns "" when either fact is missing — a protocol that cannot say WHICH
 * book was read WHEN is not a protocol, and the examination gate has already
 * refused such a valuation.
 */
function protokolBadania(
  numer: string | null | undefined,
  dataBadania: string | null | undefined,
  rodzaj: string,
): string {
  if (!numer || !dataBadania) return "";
  return (
    `W dniu ${formatDatePl(dataBadania)}r. dokonano badania księgi wieczystej ` +
    `${rodzaj} nr ${numer} (źródło: przegladarka-ekw.ms.gov.pl):`
  );
}

/** §7's deed sentence (ADR-018 reg. 5): only the parts the book actually states. */
function aktOpis(akt: KwAkt | null | undefined): string {
  if (akt == null) return "";
  const parts = [
    akt.rodzaj.trim(),
    akt.rep.trim() ? `Rep. A nr ${akt.rep.trim()}` : "",
    akt.data.trim() ? `z dnia ${formatDatePl(akt.data.trim())}` : "",
  ].filter((p) => p !== "");
  // "kind, Rep. A nr N z dnia D" — the date hangs off the Rep. number without a
  // comma, as in the source operat, so the two leading parts join with one.
  if (parts.length === 0) return "";
  const [first, ...rest] = parts;
  return rest.length === 0 ? first : `${first}, ${rest.join(" ")}`;
}

/**
 * The manual path's sentence for one dział. Silence when the question was never
 * answered (`dzial == null`): "brak wpisów" there would fabricate a clean-title
 * or no-mortgage claim about a dział nobody read — the 14.09 failure itself.
 */
function dzialOpis(dzial: KwDzialSnapshot | null | undefined, etykieta: string): string {
  if (dzial == null) return "";
  if (!dzial.wpisy) return `${etykieta}: brak wpisów.`;
  return dzial.tresc.length === 0
    ? ""
    : `${etykieta}: ${terminateEntries(dzial.tresc).join("")}`.trimEnd();
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

/**
 * One row of §8.2's transcribed book. Three columns, because that is what the
 * eKW printout is — a label, its Lp., and its cells — and `typ` says which
 * shape the row has so the template can style it without parsing `kol1`.
 */
export type KsiegaRow = {
  typ: "dzial" | "brak" | "tabela" | "lp" | "rubryka" | "dokument";
  kol1: string;
  kol2: string;
  kol3: string;
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
  /**
   * §8.2's examination protocol, one dated sentence per book (D-21) — what the
   * 14.09 operat said instead of "Pełna treść odpisu KW pozostaje w
   * dokumentacji źródłowej rzeczoznawcy", which is a sentence an operat may
   * not contain. Empty, with its flag false, for a book nobody examined.
   *
   * The date inside comes from `dataBadania` through `formatDatePl`. That
   * field is stored ISO and had never been rendered before b1-kw-read: this is
   * the first place it reaches paper, and "2026-09-15" on a legal document is
   * not a Polish date.
   */
  protokol_ksiegi_lokalu: string;
  ma_protokol_ksiegi_lokalu: boolean;
  protokol_ksiegi_gruntu: string;
  ma_protokol_ksiegi_gruntu: boolean;
  /**
   * §2's sentence about the mother book (D-07): "Dla nieruchomości gruntowej
   * Sąd Rejonowy … prowadzi księgę wieczystą nr …". Both empty when the grunt's
   * book was not examined — the generic "właściwy sąd rejonowy prowadzi odrębną
   * księgę wieczystą" is forbidden, because it implies an examination.
   *
   * The two are NOT filled together: the number comes from the grunt's own
   * snapshot, the court only from a PDF read of the lokal's book. On the manual
   * eKW path — the office's everyday path — the number is there and the court
   * is empty, and §2 then keeps the court text it already prints for the
   * lokal's book. The generator must treat an empty court that way; it may not
   * print a placeholder inside the sentence.
   *
   * So the sentence's ONLY correct gate is `nr_ksiegi_gruntu` — it is non-empty
   * exactly when the grunt's book was examined. Not `sad_ksiegi_gruntu`, which
   * is empty on the everyday manual path, and not `kw_badanie`, which is true
   * for an examined lokal alone and would print the sentence with no number and
   * no court.
   */
  nr_ksiegi_gruntu: string;
  sad_ksiegi_gruntu: string;
  /**
   * The lokal book's five dzialy, FLATTENED into table rows for §8.2 — the
   * generator gets one loop rather than four nested ones. Order is eKW's own:
   * dział → "BRAK WPISÓW" or its tables → each entry's "Lp. N." → its rubrics →
   * the dział's documents. Empty when no transcription was stored.
   *
   * These rows carry persons' names and PESELs, deliberately: ADR-018 reg. 7
   * (decyzja usera 15.09) says §8.2 prints the dzialy as the office's own
   * operat does. That is a documented exception to the F-12 minimisation which
   * still governs every other path — see `tests/f12-document-masking.test.ts`.
   */
  ksiega_lokalu_wiersze: KsiegaRow[];
  ma_tresc_lokalu: boolean;
  /** §8.2's sentences for the manual path — used when there is no transcription to quote. */
  dzial3_opis: string;
  dzial4_opis: string;
  /**
   * Dział II's deed, as §7 prints it (ADR-018 reg. 5, D-12): the kind, the Rep.
   * A number and the date, joined. `ma_akt` false means the operat says nothing
   * about a deed at all — never a sentence with blanks in it.
   */
  akt_opis: string;
  ma_akt: boolean;
  /**
   * The encumbrance in the LOKAL's dział III (ADR-018 reg. 6, D-02/D-25/D-35).
   * THREE states, not two: the two variant flags are mutually exclusive but NOT
   * exhaustive — `ma_obciazenie` with neither of them is the half-made decision
   * (`wariant: null`), where the basis is typed and the choice is not. The model
   * does not pick one; B-07 refuses to approve it, so only the preview gets there.
   */
  ma_obciazenie: boolean;
  obciazenie_bez_uwzglednienia: boolean;
  obciazenie_z_uwzglednieniem: boolean;
  obciazenie_podstawa: string;
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
  const kwGrunt = inputs.kwGrunt ?? null;
  /**
   * R-10, asked once. `kw_badanie` used to be `kw != null`, which called a
   * snapshot an examination — and the 14.09 operat is what that produced: a
   * dział III described as clean that nobody had opened. The rule that decides
   * whether a book counts as examined lives in ONE place, and §8.2 asks it
   * rather than re-deriving a second answer (ADR-018 reg. 2/3, I-13).
   */
  const kwReq = kwRequirements(input.propertyRight, kw, kwGrunt);
  /**
   * At least one book actually read. Not `!brakBadania`: a valuation whose
   * lokal book IS examined and whose grunt book is not would then show nothing
   * at all in the preview — hiding true information from the very person who
   * has to finish the job. Not `lokalZbadana` alone either: a lokal bought from
   * a developer has no book of its own, and the mother book IS its examination.
   */
  const kwBadanie = kwReq.lokalZbadana || kwReq.gruntZbadana;
  const kwDeweloperski = kwBadanie && kw?.deweloperski === true;
  const encumbrance = inputs.encumbranceTreatment ?? null;
  // Only the LOKAL's dział III encumbers this lokal. An entry in the grunt's is
  // described in §8.2 but raises no question here (D-02, kw-requirements).
  const maObciazenie = kw?.dzial3?.wpisy === true;
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
    kw_badanie: kwBadanie,
    kw_standard: kwBadanie && !kwDeweloperski,
    kw_deweloperski: kwDeweloperski,
    kw_zrodlo: kw ? KW_ZRODLO_TEXT[kw.source] : DASH,
    kw_lokalu: kw?.kwLokalu ?? DASH,
    kw_gruntu: kw?.kwGruntu ?? DASH,
    kw_sad: kw?.sad ?? DASH,
    kw_wydzial: kw?.wydzial ?? DASH,
    kw_data_dok: kw?.dataDokumentu ? formatDatePl(kw.dataDokumentu) : DASH,
    // Legacy/manual (kw == null) and odpis_kw source keep the sentence (accurate);
    // an akt (deed) source hides it — no false claim of holding a KW excerpt.
    kw_stub_odpis: kw == null || kw.source === "odpis_kw",
    protokol_ksiegi_lokalu: protokolBadania(
      kw?.kwLokalu,
      kw?.dataBadania,
      "nieruchomości lokalowej",
    ),
    ma_protokol_ksiegi_lokalu:
      protokolBadania(kw?.kwLokalu, kw?.dataBadania, "nieruchomości lokalowej") !== "",
    protokol_ksiegi_gruntu: protokolBadania(
      kwGrunt?.nrKsiegi,
      kwGrunt?.dataBadania,
      "nieruchomości gruntowej",
    ),
    ma_protokol_ksiegi_gruntu:
      protokolBadania(kwGrunt?.nrKsiegi, kwGrunt?.dataBadania, "nieruchomości gruntowej") !== "",
    // D-07: the number comes from the EXAMINED grunt book, never from the lokal
    // book's `kwGruntu` alone — that number is a fact the lokal's book states,
    // not evidence anyone opened the book it names.
    nr_ksiegi_gruntu: kwReq.gruntZbadana ? (kwGrunt?.nrKsiegi ?? "") : "",
    // The lokal was carved out of the grunt, so the same court keeps both books.
    // EMPTY when the snapshot names no court — which is the routine case, not an
    // edge one: only `/kw-extract` ever fills `sad`, the manual eKW path has no
    // field for it (`EMPTY_MANUAL_KW`). Empty means "§2 keeps the court text it
    // already prints for the lokal's book", per the handoff; that text is a
    // literal in the template (check dryfu D-3), so the model cannot repeat it
    // and must not substitute a dash — "Dla nieruchomości gruntowej — prowadzi
    // księgę wieczystą nr …" is a broken sentence, not a missing value.
    sad_ksiegi_gruntu: kwReq.gruntZbadana ? [kw?.sad, kw?.wydzial].filter(Boolean).join(" ") : "",
    ksiega_lokalu_wiersze: kw?.tresc ? ksiegaRows(kw.tresc) : [],
    ma_tresc_lokalu: kw?.tresc != null,
    dzial3_opis: dzialOpis(kw?.dzial3, "Dział III"),
    dzial4_opis: dzialOpis(kw?.dzial4, "Dział IV"),
    akt_opis: aktOpis(kw?.akt),
    ma_akt: aktOpis(kw?.akt) !== "",
    ma_obciazenie: maObciazenie,
    obciazenie_bez_uwzglednienia: maObciazenie && encumbrance?.wariant === "bez_uwzglednienia",
    obciazenie_z_uwzglednieniem: maObciazenie && encumbrance?.wariant === "z_uwzglednieniem",
    obciazenie_podstawa: maObciazenie ? (encumbrance?.podstawa ?? "") : "",
    // Honest udział (D-24, I-19, ADR-018 reg. 4). The "wg odpisu księgi
    // wieczystej" annotation used to stand in when `kw == null` — i.e. on
    // exactly the valuations that had examined nothing, where it named a
    // document nobody held. A dash says the true thing instead: the operat does
    // not know the share.
    udzial_kw: kw?.udzial ?? DASH,
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
      const sel = inputs.sampleSelection;
      // Manual inclusions too (final wave, I1): a row the appraiser added
      // that later fell out of BOTH `proposed` and `alternates` after a
      // radius change exists only in `manualInclusions[].candidate` —
      // omitting it here made the join below miss it and print dashes for
      // a row that IS in the sample.
      const candidates = sel
        ? [
            ...sel.proposed,
            ...sel.alternates,
            ...(sel.manualInclusions ?? []).map((i) => i.candidate),
          ]
        : [];
      // Primary key: transactionId+lokalId (candidateKey) — one notarial
      // act can carry SEVERAL lokale (runtime bug, team-lead 2026-08-21,
      // Heweliusza 3/43: a transactionId-only join printed the SAME
      // obręb/distance for every lokal of one act). A comparable saved
      // before `lokalId` existed on the row falls back to matching by
      // transactionId alone, first candidate found — the only information
      // those legacy rows carry.
      const byCandidateKey = new Map(candidates.map((c) => [candidateKey(c), c] as const));
      const byFirstTransactionId = new Map<string, (typeof candidates)[number]>();
      for (const c of candidates) {
        if (!byFirstTransactionId.has(c.transactionId))
          byFirstTransactionId.set(c.transactionId, c);
      }
      return inputs.comparables.map((c) => {
        const candidate =
          c.transactionId && c.lokalId
            ? byCandidateKey.get(
                candidateKey({ transactionId: c.transactionId, lokalId: c.lokalId }),
              )
            : c.transactionId
              ? byFirstTransactionId.get(c.transactionId)
              : undefined;
        // A row matched only by `transactionId` (no `lokalId`) comes from
        // `byFirstTransactionId` — SOME lokal of that act, not necessarily this one. For
        // obręb that was nearly invisible; a street name in an operat is a factual claim
        // about a comparable, so an unmatched row prints a dash rather than a guess
        // (Heweliusza 3/43 is exactly this shape: 16 lokale under one act).
        const matchedByLokal = Boolean(c.transactionId && c.lokalId && candidate);
        // S5 (Task 4d, defekt D-3): a coop-register row has `lokalId: ""` (one lokal
        // per row) and `transactionId` = `coopTxId`, so the transactionId-only join
        // above IS exact for it — not "some lokal of that act". Street comes from the
        // register record; city stays a dash, because the register does not store it
        // (ADR-010, coordinator decision 12.09 — variant a; column `city` is a follow-up).
        const matchedCoop = Boolean(
          c.coopTxId && candidate && candidate.transactionId === c.coopTxId,
        );
        const matched = matchedByLokal || matchedCoop;
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
    opis_przedmiot: activeFeatures.map(
      (f) => `${f.name} – ${f.rating ? RATING_TEXT[f.rating] : DASH},`,
    ),
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
