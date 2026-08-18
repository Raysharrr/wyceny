/**
 * What the operat's generated prose has cost, in money the appraiser can
 * recognise (T5, FR-6).
 *
 * Two numbers stand between the tokens the audit trail measured and the
 * złotówki shown on step 6 — the model's price list and the exchange rate —
 * and neither is our data: both age on their own schedule, without a line of
 * this repo changing. So they live in ONE named constant carrying the date
 * they were read and where from, instead of as anonymous literals inside a
 * template string. Everything derived from them is labelled "ok." on screen;
 * the token count shown next to it is a measurement and is not.
 *
 * App layer on purpose. `domain/` may read no configuration at all (F-10),
 * and doing the conversion on the server means the browser bundle never
 * carries a price list: step 6 is handed grosze, already counted.
 *
 * Źródło: cennik Anthropic dla claude-sonnet-5, odczytany 2026-08-18;
 * kurs przyjęty 4,00 PLN/USD.
 */
export const PROSE_PRICING_2026_08_18 = {
  usdPerInputToken: 3 / 1_000_000,
  usdPerOutputToken: 15 / 1_000_000,
  plnPerUsd: 4.0,
} as const;

/**
 * Tokens → grosze, rounded to the nearest whole grosz.
 *
 * Grosze rather than złote: a few generations cost single-digit groszy, and a
 * float carried to the screen would print "0.06624000000000001 zł" sooner or
 * later. The integer is formatted once, at the edge.
 */
export function proseCostGrosze(usage: { inputTokens: number; outputTokens: number }): number {
  const usd =
    usage.inputTokens * PROSE_PRICING_2026_08_18.usdPerInputToken +
    usage.outputTokens * PROSE_PRICING_2026_08_18.usdPerOutputToken;
  return Math.round(usd * PROSE_PRICING_2026_08_18.plnPerUsd * 100);
}
