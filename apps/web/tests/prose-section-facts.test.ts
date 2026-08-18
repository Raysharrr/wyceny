import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROSE_SECTIONS } from "@/domain/prose-snapshot";
import { PROSE_SECTION_FACTS, SECTIONS_USING_TRANSACTIONS } from "@/domain/prose";

/**
 * The dependency map duplicates a contract that lives in the worker's prompt
 * files: what a section is SHOWN in its few-shot `### DANE` blocks is what it
 * may write from. A map that drifts from the prompts would mark a section
 * fresh after a fact it actually uses changed — a stale operat nobody flags.
 */
const PROMPTS = "../worker/app/prompts/prose";

function factKeysFromPrompt(section: string): Set<string> {
  const raw = readFileSync(`${PROMPTS}/${section}.md`, "utf8");
  const keys = new Set<string>();
  for (const block of raw.matchAll(/### DANE\s*```json\s*([\s\S]*?)```/g)) {
    for (const key of Object.keys(JSON.parse(block[1]!) as Record<string, unknown>)) {
      keys.add(key);
    }
  }
  return keys;
}

describe("PROSE_SECTION_FACTS mirrors the prompts", () => {
  it("declares exactly the fact keys each section's few-shot shows it", () => {
    for (const section of PROSE_SECTIONS) {
      const fromPrompt = factKeysFromPrompt(section);
      // `dzielnica` appears in a few-shot example but the app never sends it
      // (no such field in the data model) — documented in the T5 report.
      fromPrompt.delete("dzielnica");
      expect(new Set(PROSE_SECTION_FACTS[section]), section).toEqual(fromPrompt);
    }
  });

  it("names the sections whose text depends on the sample's price trend", () => {
    // The worker injects `proba.trend_cen = price_trend(transakcje)` into the
    // shared facts, so these two must fingerprint the transactions as well.
    expect([...SECTIONS_USING_TRANSACTIONS].sort()).toEqual(["analiza_rynku", "uzasadnienie"]);
  });
});
