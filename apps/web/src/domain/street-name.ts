/**
 * Street name as the operat prints it — pure, no I/O (F-10).
 *
 * The GEOPOZ export writes every street WITH a prefix: measured on the real file (spike
 * 2026-08-22), 991 distinct names, NONE without one — `ul.` 939, `os.` 32, `pl.` 10,
 * `al.` 5, `rynek` 5. And the operat prints them the same way: measured 2026-08-23 on
 * four reference operats, all four keep the prefix in full — `ul. Kościelna` (12×,
 * Kościelna), `ul. Starołęcka` / `ul. Żorska` (Starołęcka), `ul. Józefa Sowińskiego`
 * (Heweliusza), `ul. Chełmińska` (Winiary). So nothing comes off; the function only
 * normalises whitespace and answers the missing case with a dash.
 */

/**
 * One constant, so changing the decision costs a line (team-lead, 2026-08-22).
 *
 * Emptied 2026-08-23: Slice 3d assumed the reference operat printed the bare name and
 * stripped `ul.`. The four operats measured that day say otherwise — 4/4 print it — so
 * the list of prefixes to strip is empty rather than deleted: the next measurement may
 * refill it.
 */
export const PREFIXES_TO_STRIP: readonly string[] = [];

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
