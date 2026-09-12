import type { NewCoopTransaction, PriceKind } from "../ports/coop-registry";
import type { PropertyRight } from "./property-right";

/**
 * Import of a cooperative's transaction register (T-13) — the whole rule set,
 * ZERO I/O (F-10). Input is what the worker's `/coop-sheet` returns: raw cell
 * text, dates already ISO. Four known registers have five column layouts
 * (wiki: rejestry-spoldzielni-mieszkaniowych), so there is no parser — a
 * human maps columns (`ColumnMapping`) and this module normalises, validates
 * and de-duplicates. Nothing here guesses: a value that does not parse is a
 * skipped row with a reason, never a default.
 */

export const COOP_FIELDS = [
  { key: "address", label: "Adres (osiedle / ulica)", required: true },
  // Both required (spec §6): without the flat number two flats sold the same
  // day for the same price collapse into one "duplicate" — a real case in the
  // Osiedle Młodych register. May be mapped to the address column when the
  // register keeps "Bukowa 12/5" in one cell (splitAddressCell takes it apart).
  { key: "buildingNumber", label: "Nr budynku", required: true },
  { key: "flatNumber", label: "Nr mieszkania", required: true },
  { key: "area", label: "Powierzchnia użytkowa (m²)", required: true },
  { key: "priceTotal", label: "Cena (zł)", required: true },
  { key: "date", label: "Data transakcji", required: true },
  { key: "rightType", label: "Prawo do lokalu", required: false },
  { key: "rep", label: "Rep. aktu notarialnego", required: false },
  { key: "floor", label: "Piętro", required: false },
  { key: "rooms", label: "Liczba pokoi", required: false },
  { key: "buildYear", label: "Rok budowy", required: false },
] as const;
export type CoopFieldKey = (typeof COOP_FIELDS)[number]["key"];
/**
 * Application field → 0-based column index in the sheet (null/undefined = not
 * mapped). `flatNumber` alone may be `"absent"`: the appraiser states that
 * THIS register has no flat-number column at all (SM "Przylesie"). That is a
 * different fact from "not mapped": the required flag still holds, the
 * import is allowed, and rows are keyed without a flat — see coopDedupeKey.
 */
export type ColumnMapping = { [K in Exclude<CoopFieldKey, "flatNumber">]?: number | null } & {
  flatNumber?: number | null | "absent";
};

export type SkipReason = "summary" | "empty" | "bad_number" | "bad_date" | "duplicate";
export type SkippedRow = { row: number; reason: SkipReason };
/**
 * Imported (or merged), but worth a look:
 * - `no_flat` — keyed without a flat number (column absent, or the cell blank);
 * - `no_flat_merge` — a no-flat row was merged into an earlier one as a
 *   duplicate: same building, day, price AND area. The appraiser accepted
 *   this when marking the column absent; the summary still says it happened.
 */
export type WarnReason = "no_flat" | "no_flat_merge";
export type WarnedRow = { row: number; reason: WarnReason };

export type CoopParseContext = {
  cooperative: string;
  /** One value per imported file — comes from the appraiser, never a default. */
  priceKind: PriceKind;
  /** 0-based index of the header row; null = the sheet has none ("000367 SM"). */
  headerRow: number | null;
};

const SUMMARY_RX =
  /^(suma|razem|łącznie|lacznie|średnia|srednia|średnio|srednio|mediana|min|max|minimum|maksimum|maks)\.?:?$/i;

/** "suma" / "ŚREDNIA" / " min " … in any cell → an aggregate row, not a transaction. */
export function isSummaryRow(cells: readonly string[]): boolean {
  return cells.some((c) => SUMMARY_RX.test(c.trim()));
}

/**
 * Canonical spelling of an estate/street name for keys: whitespace collapsed,
 * `os.`/`ul.`/`al.`/`pl.` prefix dropped (one register has it, one does not,
 * one is inconsistent), lower-cased with diacritics kept. "Orła Białego " and
 * "os. Orła Białego" both become "orła białego".
 */
export function normalizeCoopAddress(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\s ]+/g, " ")
    .trim()
    .replace(/^(os|ul|al|pl)(\.\s*|\s+)/i, "")
    .trim()
    .toLowerCase();
}

/** "Bukowa 12/5" → address "Bukowa", building "12", flat "5" (Dębiecka keeps all three in one cell). */
export function splitAddressCell(
  s: string,
): { address: string; building: string; flat: string } | null {
  const m = /^(.*?\S)\s+(\d+[a-zA-Z]?)\s*(?:\/\s*(\S+))?$/.exec(s.trim());
  return m ? { address: m[1]!, building: m[2]!, flat: m[3] ?? "" } : null;
}

/**
 * "450 000", "43,34", "1.234,56", "520 000 zł", "450.000", "1.234.567" → number;
 * anything else → null. A dot is decimal by default; it is a thousands
 * separator only when that is unambiguous — several ".ddd" groups, or one
 * ".000" group (nobody writes 450.000 m² meaning 450). "1.234" / "45.500"
 * could be either, so they are null → the row goes "do poprawki" (ADR-010:
 * never guess).
 */
export function parseCoopNumber(s: string): number | null {
  let t = s.replace(/[^\d,.-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(t) || /^-?\d{1,3}\.000$/.test(t))
    t = t.replace(/\./g, "");
  else if (/^-?\d{1,3}\.\d{3}$/.test(t)) return null;
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** No flat is 10 000 m²: above it a thousands-dot ("56.000") was read as a decimal-free number (review 2 §8). */
export const MAX_AREA_M2 = 10_000;

/** ISO "2025-01-14[T…]" or Polish "02.01.2023r." / "2.1.2023" → "YYYY-MM-DD"; else null. */
export function parseCoopDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  const pl = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*r?\.?$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (pl) [y, m, d] = [Number(pl[3]), Number(pl[2]), Number(pl[1])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Register wording → PropertyRight; unrecognised or empty → null (never a default, spec §5). */
export function parseRightType(s: string): PropertyRight | null {
  const t = s.toLowerCase();
  if (/sp[oó][lł]dz/.test(t)) return "spoldzielcze_wlasnosciowe";
  if (/w[lł]asno|odr[eę]bn/.test(t)) return "wlasnosc_lokalu";
  return null;
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 };
/** "3", "parter", "P", "0", "IV", "I piętro" → floor number; else null. */
export function parseFloor(s: string): number | null {
  const t = s
    .toLowerCase()
    .replace(/pi[eę]tro/g, "")
    .trim();
  if (t === "") return null;
  if (/^(parter|p|0)$/.test(t)) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  if (/^[ivx]+$/.test(t)) {
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      const cur = ROMAN[t[i]!]!;
      const next = ROMAN[t[i + 1] ?? ""] ?? 0;
      n += cur < next ? -cur : cur;
    }
    return n;
  }
  return null;
}

function parseIntOrNull(s: string): number | null {
  return /^\d+$/.test(s.trim()) ? Number(s.trim()) : null;
}

type KeyInput = Pick<
  NewCoopTransaction,
  "address" | "buildingNumber" | "flatNumber" | "date" | "priceTotal" | "area" | "rep"
>;

/**
 * Natural key. Rep. of the notarial act when the register has one; otherwise
 * (normalised address + building | flat | date | price). The flat number is
 * part of BOTH — two flats in one building sold the same day for the same
 * price are two transactions (confirmed in the Osiedle Młodych register), and
 * one act can carry two flats (Dębiecka: 135 rows, 133 reps). Without a flat
 * number (register has no such column, or the cell is blank) the AREA stands
 * in for it: 45 m² and 52 m² sold the same day for the same price stay two
 * rows. The key never depends on the row's position in the file, so a
 * re-import — also of an updated file with rows added above — is idempotent.
 * Two no-flat rows equal in all of building, day, price and area DO merge;
 * parseCoopSheet reports that as `no_flat_merge`.
 */
export function coopDedupeKey(r: KeyInput): string {
  const addr = `${normalizeCoopAddress(r.address)} ${r.buildingNumber.trim().toLowerCase()}`;
  const flat = r.flatNumber.trim().toLowerCase() || `area:${r.area}`;
  const rep = (r.rep ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  return rep ? `rep:${rep}|${addr}|${flat}` : `${addr}|${flat}|${r.date}|${r.priceTotal}`;
}

/** "Same building" key for ADR-015 rule 6 (max 3 per building) — `Candidate.buildingRef`. */
export function coopBuildingRef(r: Pick<NewCoopTransaction, "address" | "buildingNumber">): string {
  return `${normalizeCoopAddress(r.address)}|${r.buildingNumber.trim().toLowerCase()}`;
}

export function parseCoopSheet(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  ctx: CoopParseContext,
): { rows: NewCoopTransaction[]; skipped: SkippedRow[]; warnings: WarnedRow[] } {
  const out: NewCoopTransaction[] = [];
  const skipped: SkippedRow[] = [];
  const warnings: WarnedRow[] = [];
  const seen = new Set<string>();
  const start = ctx.headerRow === null ? 0 : ctx.headerRow + 1;

  for (let i = start; i < rows.length; i++) {
    const cells = rows[i]!;
    const cell = (k: CoopFieldKey): string => {
      const idx = mapping[k];
      return typeof idx === "number" ? (cells[idx] ?? "").trim() : "";
    };
    if (cells.every((c) => c.trim() === "")) {
      skipped.push({ row: i, reason: "empty" });
      continue;
    }
    if (isSummaryRow(cells)) {
      skipped.push({ row: i, reason: "summary" });
      continue;
    }
    let address = cell("address");
    let buildingNumber = cell("buildingNumber");
    let flatNumber = cell("flatNumber");
    if (!buildingNumber) {
      const split = splitAddressCell(address);
      if (split) {
        address = split.address;
        buildingNumber = split.building;
        flatNumber = flatNumber || split.flat;
      }
    }
    if (!address) {
      skipped.push({ row: i, reason: "empty" });
      continue;
    }
    const area = parseCoopNumber(cell("area"));
    const priceTotal = parseCoopNumber(cell("priceTotal"));
    if (
      area === null ||
      area <= 0 ||
      area > MAX_AREA_M2 ||
      priceTotal === null ||
      priceTotal <= 0
    ) {
      skipped.push({ row: i, reason: "bad_number" });
      continue;
    }
    const date = parseCoopDate(cell("date"));
    if (date === null) {
      skipped.push({ row: i, reason: "bad_date" });
      continue;
    }
    const rep = cell("rep") || null;
    const row: NewCoopTransaction = {
      cooperative: ctx.cooperative,
      address,
      buildingNumber,
      flatNumber,
      area,
      priceTotal,
      date,
      priceKind: ctx.priceKind,
      rightType:
        mapping.rightType === null || mapping.rightType === undefined
          ? null
          : parseRightType(cell("rightType")),
      rep,
      floor: parseFloor(cell("floor")),
      rooms: parseIntOrNull(cell("rooms")),
      buildYear: parseIntOrNull(cell("buildYear")),
      pos: null,
      source: "xls",
      dedupeKey: "",
    };
    row.dedupeKey = coopDedupeKey(row);
    if (seen.has(row.dedupeKey)) {
      skipped.push({ row: i, reason: "duplicate" });
      if (!flatNumber) warnings.push({ row: i, reason: "no_flat_merge" });
      continue;
    }
    if (!flatNumber) warnings.push({ row: i, reason: "no_flat" });
    seen.add(row.dedupeKey);
    out.push(row);
  }
  return { rows: out, skipped, warnings };
}

/**
 * `coop.import` event payload (F-13): counts and classes only — no address,
 * flat number, cooperative name or file name ever enters `event_log`.
 */
export function coopImportEventMeta(input: {
  rowsTotal: number;
  inserted: number;
  duplicates: number;
  skipped: readonly SkippedRow[];
  warnings: readonly WarnedRow[];
  geocoded: number;
  needsFix: number;
}): {
  rows_total: number;
  inserted: number;
  duplicates: number;
  skipped_summary: number;
  skipped_bad: number;
  warned_no_flat: number;
  warned_no_flat_merge: number;
  geocoded: number;
  needs_fix: number;
} {
  const count = (xs: readonly { reason: string }[], ...reasons: string[]) =>
    xs.filter((x) => reasons.includes(x.reason)).length;
  return {
    rows_total: input.rowsTotal,
    inserted: input.inserted,
    duplicates: input.duplicates + count(input.skipped, "duplicate"),
    skipped_summary: count(input.skipped, "summary"),
    skipped_bad: count(input.skipped, "bad_number", "bad_date"),
    warned_no_flat: count(input.warnings, "no_flat"),
    warned_no_flat_merge: count(input.warnings, "no_flat_merge"),
    geocoded: input.geocoded,
    needs_fix: input.needsFix,
  };
}
