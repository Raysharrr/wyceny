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

const NBSP = "\u00A0"; // non-breaking space (escape — a pasted literal is invisible to review)

/** `1044400` → `"1 044 400,00"` (NBSP thousands separator — matches the source operat). */
export function formatPln(value: number): string {
  return formatNumber(value, 2);
}

export function formatNumber(value: number, dp: number): string {
  const [int, frac] = value.toFixed(dp).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return frac ? `${grouped},${frac}` : grouped;
}

/** ISO date (or full ISO datetime) → `DD.MM.YYYY`. */
export function formatDatePl(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

/** F-12 masking: full transaction date → month only; absent → em dash. */
function maskMonth(date: string | undefined): string {
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "—";
}

/** Best-effort city from the subject address ("ul. X 1, Poznań" → "Poznań"). */
function cityFromAddress(address: string): string {
  const afterComma = address.split(",").pop()?.trim();
  return afterComma && afterComma.length > 0 ? afterComma : "—";
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

export type DocumentModel = {
  adres: string;
  powierzchnia: string;
  cel: string;
  nr_kw: string;
  klient: string;
  data_ogledzin: string;
  data_sporzadzenia: string;
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
  return {
    adres: input.address,
    powierzchnia: formatNumber(input.area, 2),
    cel: PURPOSE_TEXT[input.purpose],
    nr_kw: input.kwNumber,
    klient: input.client,
    data_ogledzin: formatDatePl(input.inspectionDate),
    data_sporzadzenia: formatDatePl(input.approvedAt.toISOString()),
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
    cechy: kcs.ui.map((f) => ({
      nazwa: f.name,
      waga_pct: formatNumber(f.weight * 100, 0),
      ui_min: formatNumber(f.weight * kcs.vmin, 3),
      ui_sr: formatNumber(f.weight, 3),
      ui_max: formatNumber(f.weight * kcs.vmax, 3),
      ui_przedmiot: formatNumber(f.value, 3),
    })),
    // ponytail: canonical KCS simplification — cmin lokal = all features at
    // worst, cmax = all at best; the subject follows its actual ratings.
    opis_cmin: inputs.features.map((f) => `${f.name} – wartość najniższa cechy,`),
    opis_cmax: inputs.features.map((f) => `${f.name} – wartość najwyższa cechy,`),
    opis_przedmiot: inputs.features.map((f) => `${f.name} – ${RATING_TEXT[f.rating]},`),
  };
}
