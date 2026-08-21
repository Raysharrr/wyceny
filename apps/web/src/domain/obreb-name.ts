import raw from "./obreby-poznan.json";
import { padObreb } from "./egib-id";

/** Poznań obręb code → name (scripts/fetch-obreby.mts, GEOPOZ). Keys are 4-digit codes; `_source` is provenance, not data. */
export const OBREBY_POZNAN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(raw as Record<string, string>).filter(([k]) => /^\d{4}$/.test(k)),
);
export const POZNAN_TERYT_PREFIX = "3064";

/**
 * Bare obręb name, or null when we can't give one — never invents a name.
 * Poznań with a known name → "Łazarz"; outside Poznań → "gm. 302104" (no
 * per-gmina obręb map exists, so the gmina TERYT stands in for a name);
 * Poznań code missing from the map, or no egib → null.
 */
export function obrebName(egib: { teryt: string; obreb: string } | null): string | null {
  if (!egib) return null;
  if (!egib.teryt.startsWith(POZNAN_TERYT_PREFIX)) return `gm. ${egib.teryt.split("_")[0]}`;
  return OBREBY_POZNAN[padObreb(egib.obreb)] ?? null;
}

/** Label for the step-3 table and the operat's Table 1: never invents a name. */
export function obrebLabel(egib: { teryt: string; obreb: string } | null): string {
  if (!egib) return "—";
  const code = padObreb(egib.obreb);
  const name = obrebName(egib);
  if (!egib.teryt.startsWith(POZNAN_TERYT_PREFIX)) return `${code} · ${name}`;
  return name ? `${code} ${name}` : code;
}
