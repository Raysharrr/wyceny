import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROSE_SECTIONS, type ProseSection } from "@/domain/prose-snapshot";
import { PROSE_SECTION_FACTS, SECTIONS_USING_TRANSACTIONS } from "@/domain/prose";
import { currentSectionFactsHashes } from "@/domain/prose-hash";
import type { KcsInput } from "@/domain/kcs";
import { approvableInput } from "./fixtures/valuation-inputs";

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

/**
 * What a step-1 save costs the descriptions — the claim the warning above the
 * step-1 form makes to the appraiser (T8, fix round 2).
 *
 * This exists because the first version of that copy was WRONG in the
 * expensive direction. It was measured on two fields (address, area) and
 * concluded "descriptions only lapse when the address or the area changes" —
 * so an appraiser correcting „Rok budowy" was told step 6 would not be needed,
 * redid the calculation, reached step 7 and was blocked there. A promise made
 * to a professional and broken.
 *
 * The table below is the whole of step 1, field by field, not a sample: every
 * input the form renders (`subject-section.tsx`) plus the address, the area
 * and the KW extract. Change the copy and this test tells you whether the new
 * sentence is true; change the facts map and it tells you the copy needs
 * revisiting. Neither direction is guarded by anything else.
 */
describe("what a step-1 save costs the descriptions", () => {
  const ADDRESS = "ul. Klonowa 4, m. Nowogród";

  /** Every step-1 field populated — an absent field that stays absent moves
   * nothing, and would read as a false "no effect". */
  const baseInputs = (): KcsInput => ({
    ...approvableInput("test-user").inputs!,
    subject: {
      parcelId: "P1",
      obreb: "Nowogród",
      arkusz: "3",
      nrDzialki: "12",
      powEwidHa: 0.25,
      uzytek: "B",
      budynekRodzaj: "mieszkalny",
      kondygnacjeNadziemne: 5,
      kondygnacjePodziemne: 1,
      rokBudowy: 1998,
      mpzpAbsent: false,
      mpzpSymbol: "MW",
      mpzpNazwa: "Plan testowy",
      mpzpUchwala: "XX/1/24",
      mpzpData: "2024-01-01",
      mpzpPubl: "Dz. Urz. 1",
      przeznaczenieStudium: "zabudowa mieszkaniowa",
    },
  });

  const staleAfter = (address: string, inputs: KcsInput): ProseSection[] => {
    const before = currentSectionFactsHashes({ address: ADDRESS, inputs: baseInputs() });
    const after = currentSectionFactsHashes({ address, inputs });
    return PROSE_SECTIONS.filter((section) => before[section] !== after[section]);
  };

  const editSubject = (patch: Partial<NonNullable<KcsInput["subject"]>>): KcsInput => {
    const inputs = baseInputs();
    return { ...inputs, subject: { ...inputs.subject!, ...patch } };
  };

  it.each([
    ["adres", () => staleAfter("ul. Klonowa 9, m. Nowogród", baseInputs()), ["analiza_rynku"]],
    [
      "powierzchnia",
      () => staleAfter(ADDRESS, { ...baseInputs(), area: 99 }),
      ["analiza_rynku", "opis_lokalu"],
    ],
    [
      "obręb",
      () => staleAfter(ADDRESS, editSubject({ obreb: "Inny" })),
      ["analiza_rynku", "zagospodarowanie"],
    ],
    [
      "nr działki",
      () => staleAfter(ADDRESS, editSubject({ nrDzialki: "99" })),
      ["zagospodarowanie"],
    ],
    ["użytek", () => staleAfter(ADDRESS, editSubject({ uzytek: "Bi" })), ["zagospodarowanie"]],
    [
      "rodzaj budynku",
      () => staleAfter(ADDRESS, editSubject({ budynekRodzaj: "usługowy" })),
      ["zagospodarowanie"],
    ],
    [
      "pow. działki",
      () => staleAfter(ADDRESS, editSubject({ powEwidHa: 0.5 })),
      ["zagospodarowanie"],
    ],
    [
      "kondygnacje nadziemne",
      () => staleAfter(ADDRESS, editSubject({ kondygnacjeNadziemne: 9 })),
      ["zagospodarowanie"],
    ],
    [
      "rok budowy",
      () => staleAfter(ADDRESS, editSubject({ rokBudowy: 2001 })),
      ["zagospodarowanie"],
    ],
    [
      "odłączenie przedmiotu",
      () => staleAfter(ADDRESS, { ...baseInputs(), subject: null }),
      ["analiza_rynku", "zagospodarowanie"],
    ],
  ])("%s unieważnia: %o", (_label, measure, expected) => {
    expect([...measure()].sort()).toEqual([...expected].sort());
  });

  /**
   * The other half, and the reason the sentence can still say WHEN step 6 is
   * not needed: these step-1 fields reach no prompt at all. `arkusz`,
   * `parcelId`, the underground storeys and the whole MPZP block are printed in
   * the operat from the snapshot directly, never described in prose — so
   * correcting a plan's publication reference costs the calculation and
   * nothing else. Same for the KW extract.
   */
  it.each([
    ["arkusz mapy", () => staleAfter(ADDRESS, editSubject({ arkusz: "9" }))],
    ["identyfikator działki", () => staleAfter(ADDRESS, editSubject({ parcelId: "P9" }))],
    ["kondygnacje podziemne", () => staleAfter(ADDRESS, editSubject({ kondygnacjePodziemne: 2 }))],
    ["brak planu", () => staleAfter(ADDRESS, editSubject({ mpzpAbsent: true }))],
    ["symbol MPZP", () => staleAfter(ADDRESS, editSubject({ mpzpSymbol: "MN" }))],
    ["nazwa planu", () => staleAfter(ADDRESS, editSubject({ mpzpNazwa: "Inny plan" }))],
    ["uchwała", () => staleAfter(ADDRESS, editSubject({ mpzpUchwala: "YY/2/24" }))],
    ["data uchwały", () => staleAfter(ADDRESS, editSubject({ mpzpData: "2025-02-02" }))],
    ["publikator", () => staleAfter(ADDRESS, editSubject({ mpzpPubl: "Dz. Urz. 9" }))],
    [
      "przeznaczenie w studium",
      () => staleAfter(ADDRESS, editSubject({ przeznaczenieStudium: "inne" })),
    ],
  ])("%s nie unieważnia żadnego opisu", (_label, measure) => {
    expect(measure()).toEqual([]);
  });
});
