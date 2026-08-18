import { describe, expect, it } from "vitest";
import { PROSE_PRICING_2026_08_18, proseCostGrosze } from "@/lib/prose-pricing";

/**
 * The token → grosze conversion behind step 6's cost line (T5).
 *
 * The numbers it multiplies by are not ours and will age; what these tests
 * pin is the ARITHMETIC — that output tokens cost five times input ones, that
 * the result is rounded to a whole grosz rather than truncated, and that no
 * generation costs nothing. Change the price list and the last case moves
 * with it on purpose.
 */
describe("proseCostGrosze", () => {
  it("no tokens, no cost", () => {
    expect(proseCostGrosze({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("prices a million input tokens at the list rate, in grosze", () => {
    // 3 USD × 4,00 PLN/USD = 12 zł.
    expect(proseCostGrosze({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(1200);
  });

  it("output tokens cost five times input ones", () => {
    expect(proseCostGrosze({ inputTokens: 0, outputTokens: 1_000_000 })).toBe(6000);
  });

  it("rounds to the nearest grosz instead of truncating", () => {
    // 1250 × 0,0012 zł = 1,5 grosza — truncation would report 1.
    expect(proseCostGrosze({ inputTokens: 1250, outputTokens: 0 })).toBe(2);
  });

  it("a real generation: 3120 in + 480 out is 7 groszy", () => {
    expect(proseCostGrosze({ inputTokens: 3120, outputTokens: 480 })).toBe(7);
  });

  it("carries the exchange rate as one named number, not scattered literals", () => {
    expect(PROSE_PRICING_2026_08_18.plnPerUsd).toBe(4.0);
  });
});
