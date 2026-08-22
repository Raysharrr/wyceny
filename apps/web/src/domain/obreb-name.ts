import raw from "./obreby-poznan.json";
import { padObreb } from "./egib-id";

/** Poznań obręb code → name (scripts/fetch-obreby.mts, GEOPOZ). Keys are 4-digit codes; `_source` is provenance, not data. */
export const OBREBY_POZNAN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(raw as Record<string, string>).filter(([k]) => /^\d{4}$/.test(k)),
);
export const POZNAN_TERYT_PREFIX = "3064";

/** True for a well-formed obręb code (non-empty, digits only) — guards `padObreb`, which assumes both. */
function isObrebCode(obreb: string): boolean {
  return obreb.length > 0 && /^\d+$/.test(obreb);
}

/**
 * City for Table 1 when the GEOPOZ export has no address for the transaction (Slice 3d).
 * Derived from TERYT, which every parsed candidate carries, so the operat never loses the
 * location of a comparable: Poznań for 3064*, "gm. <TERYT>" for a neighbouring gmina the
 * city export cannot cover. `null` only when the identifier did not parse at all.
 */
export function cityLabel(egib: { teryt: string } | null | undefined): string | null {
  if (!egib?.teryt) return null;
  return egib.teryt.startsWith(POZNAN_TERYT_PREFIX) ? "Poznań" : gminaOf(egib.teryt);
}

/** "gm. <TERYT prefix>" — the gmina TERYT stands in for a name where no per-gmina obręb map exists. */
function gminaOf(teryt: string): string {
  return `gm. ${teryt.split("_")[0]}`;
}

/**
 * Bare obręb name, or null when we can't give one — never invents a name.
 * Poznań with a known name → "Łazarz"; outside Poznań → "gm. 302104";
 * Poznań code missing from the map, malformed `obreb`, or no egib → null.
 */
export function obrebName(egib: { teryt: string; obreb: string } | null): string | null {
  if (!egib || !isObrebCode(egib.obreb)) return null;
  if (!egib.teryt.startsWith(POZNAN_TERYT_PREFIX)) return gminaOf(egib.teryt);
  return OBREBY_POZNAN[padObreb(egib.obreb)] ?? null;
}

/** Label for the step-3 table and the operat's Table 1: never invents a name. */
export function obrebLabel(egib: { teryt: string; obreb: string } | null): string {
  if (!egib || !isObrebCode(egib.obreb)) return "—";
  const code = padObreb(egib.obreb);
  if (!egib.teryt.startsWith(POZNAN_TERYT_PREFIX)) return `${code} · ${gminaOf(egib.teryt)}`;
  const name = OBREBY_POZNAN[code];
  return name ? `${code} ${name}` : code;
}
