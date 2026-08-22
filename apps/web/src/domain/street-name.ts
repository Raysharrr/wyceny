/**
 * Street name as the operat prints it — pure, no I/O (F-10).
 *
 * The GEOPOZ export writes every street WITH a prefix: measured on the real file (spike
 * 2026-08-22), 991 distinct names, NONE without one — `ul.` 939, `os.` 32, `pl.` 10,
 * `al.` 5, `rynek` 5. The reference operat (Aneta) prints the bare name, so `ul.` comes
 * off — but only `ul.`: in the other 52 the word belongs to the proper name, and
 * "os. Zwycięstwa" → "Zwycięstwa", "pl. Wolności" → "Wolności" or "rynek Jeżycki" →
 * "Jeżycki" would point the reader somewhere else in Poznań.
 */

/** One constant, so changing the decision costs a line (team-lead, 2026-08-22). */
export const PREFIXES_TO_STRIP = ["ul."] as const;

/** Dash for a missing street — the document never prints an empty cell. */
export const DASH = "—";

export function operatStreet(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return DASH;
  for (const prefix of PREFIXES_TO_STRIP) {
    if (value.toLowerCase().startsWith(`${prefix} `)) {
      return value.slice(prefix.length).trim() || DASH;
    }
  }
  return value;
}
