import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROSE_SECTIONS, type ProseSection, type ProseSnapshot } from "@/domain/prose-snapshot";
import {
  buildProseFacts,
  PROSE_SECTION_FACTS,
  SECTIONS_USING_TRANSACTIONS,
  staleProseSections,
  type ProseFactsInput,
} from "@/domain/prose";
import { currentSectionFactsHash, currentSectionFactsHashes } from "@/domain/prose-hash";
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

  it("names the sections fingerprinted over the sample as well as their facts", () => {
    // Was mechanical (the worker injected `proba.trend_cen` into the shared
    // facts); since Slice 5 it is deliberate over-approximation — both sections
    // carry `proba`, which moves with the sample anyway.
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
      przeznaczenieRodzaj: "mpzp",
      przeznaczenieSymbol: "MW",
      przeznaczenieNazwa: "Plan testowy",
      przeznaczenieUchwala: "Nr XX/1/24 Rady Miasta Poznania",
      przeznaczenieData: "2024-01-01",
      przeznaczeniePublikator: "Dz. Urz. 1",
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
    // M-12: §11 is composed from the data and names only the CITY from the
    // address, and the selection's own subject area (the band it applied), not
    // today's `area` — a corrected house number or area no longer re-flags it.
    // A corrected area still stales the sample through step 3, not here.
    [
      "adres (ta sama miejscowość)",
      () => staleAfter("ul. Klonowa 9, m. Nowogród", baseInputs()),
      [],
    ],
    ["miasto", () => staleAfter("ul. Klonowa 4, m. Zielonka", baseInputs()), ["analiza_rynku"]],
    ["powierzchnia", () => staleAfter(ADDRESS, { ...baseInputs(), area: 99 }), ["opis_lokalu"]],
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
    // D-31: the building's own parameters invalidate the BUILDING description.
    // Until 16.09 all three below said ["zagospodarowanie"] — the map pinned
    // the defect: a change to the building's age re-flagged the description of
    // the land it stands on, because that section was where the building got
    // written up.
    [
      "rodzaj budynku",
      () => staleAfter(ADDRESS, editSubject({ budynekRodzaj: "usługowy" })),
      ["opis_budynku"],
    ],
    [
      "pow. działki",
      () => staleAfter(ADDRESS, editSubject({ powEwidHa: 0.5 })),
      ["zagospodarowanie"],
    ],
    [
      "kondygnacje nadziemne",
      () => staleAfter(ADDRESS, editSubject({ kondygnacjeNadziemne: 9 })),
      ["opis_budynku"],
    ],
    ["rok budowy", () => staleAfter(ADDRESS, editSubject({ rokBudowy: 2001 })), ["opis_budynku"]],
    [
      "odłączenie przedmiotu",
      () => staleAfter(ADDRESS, { ...baseInputs(), subject: null }),
      ["analiza_rynku", "opis_budynku", "zagospodarowanie"],
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
    [
      "podstawa przeznaczenia",
      () => staleAfter(ADDRESS, editSubject({ przeznaczenieRodzaj: "studium" })),
    ],
    ["symbol przeznaczenia", () => staleAfter(ADDRESS, editSubject({ przeznaczenieSymbol: "MN" }))],
    ["nazwa planu", () => staleAfter(ADDRESS, editSubject({ przeznaczenieNazwa: "Inny plan" }))],
    ["uchwała", () => staleAfter(ADDRESS, editSubject({ przeznaczenieUchwala: "Nr YY/2/24" }))],
    ["data uchwały", () => staleAfter(ADDRESS, editSubject({ przeznaczenieData: "2025-02-02" }))],
    [
      "publikator",
      () => staleAfter(ADDRESS, editSubject({ przeznaczeniePublikator: "Dz. Urz. 9" })),
    ],
  ])("%s nie unieważnia żadnego opisu", (_label, measure) => {
    expect(measure()).toEqual([]);
  });
});

/**
 * The migration promise of ADR-017 (Opcja A), MEASURED rather than reasoned.
 *
 * A draft saved before 16.09 carries one `note` and a prose snapshot whose
 * fingerprints were computed by the OLD code, when that note sat under four
 * fact keys. After the split, the note is no longer a fact. The PR promises
 * those drafts go to "przejrzyj ponownie" for exactly the note-backed sections
 * — and nothing else. A promise to 27 drafts is worth one assertion.
 *
 * The old fingerprints cannot come from today's code (the subsets changed), so
 * they are rebuilt here from the stored format: sha256 over key-sorted JSON of
 * `{ facts: <old subset>, transactions }`. The control test below proves the
 * reconstruction reproduces production hashing byte for byte — without it,
 * "stale" could just mean "my hash is different from theirs", which is always
 * true and proves nothing.
 */
describe("migracja szkiców sprzed podziału notatki (ADR-017, Opcja A)", () => {
  const NOTE = "Klatka po remoncie, winda. Otoczenie: zabudowa wielorodzinna. Lokal 2 pokoje.";

  /** Subsets as they stood until 16.09 — the four note-backed sections only. */
  const OLD_SUBSET: Partial<Record<ProseSection, readonly string[]>> = {
    opis_lokalu: ["pow_uzytkowa", "notatka_uklad"],
    otoczenie: ["notatka_otoczenie"],
    zagospodarowanie: [
      "nr_dzialki",
      "obreb",
      "pow_dzialki_m2",
      "uzytek",
      "budynek_rodzaj",
      "kondygnacje",
      "rok_budowy",
      "notatka_zagospodarowanie",
    ],
    standard: ["notatka_standard", "oceny_cech"],
  };

  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;

  const storedHash = (facts: Record<string, unknown>, keys: readonly string[]): string =>
    createHash("sha256")
      .update(
        JSON.stringify(
          canonical({
            facts: Object.fromEntries(
              keys.filter((k) => facts[k] !== undefined).map((k) => [k, facts[k]]),
            ),
            transactions: [],
          }),
        ),
      )
      .digest("hex");

  const legacyInput = (): ProseFactsInput => {
    const base = approvableInput("test-user");
    return {
      address: base.address,
      inputs: {
        ...base.inputs!,
        subject: {
          ...base.inputs!.subject!,
          budynekRodzaj: "mieszkalny",
          kondygnacjeNadziemne: 11,
          rokBudowy: 1983,
          nrDzialki: "12",
          powEwidHa: 0.25,
          uzytek: "B",
        },
        // The pre-split shape: one note, no fields.
        inspection: { ...base.inputs!.inspection!, note: NOTE, notes: undefined },
      },
    };
  };

  /** Facts as the OLD code built them for that draft: today's facts + the note under four keys. */
  const oldFacts = (input: ProseFactsInput): Record<string, unknown> => ({
    ...buildProseFacts(input),
    notatka_uklad: NOTE,
    notatka_otoczenie: NOTE,
    notatka_standard: NOTE,
    notatka_zagospodarowanie: NOTE,
  });

  it("kontrola: odtworzony odcisk jest bajt w bajt tym, co liczy produkcja", () => {
    // `otoczenie` has the same subset before and after, so a NEW-shape draft
    // whose "Otoczenie" field holds the note must fingerprint identically to
    // the reconstruction. If this fails, every assertion below is vacuous.
    const input = legacyInput();
    const withField: ProseFactsInput = {
      ...input,
      inputs: {
        ...input.inputs,
        inspection: { ...input.inputs.inspection!, note: null, notes: { otoczenie: NOTE } },
      },
    };
    expect(currentSectionFactsHash("otoczenie", withField)).toBe(
      storedHash(oldFacts(input), OLD_SUBSET.otoczenie!),
    );
  });

  it("stary szkic idzie do „przejrzyj ponownie” dokładnie dla sekcji opartych na notatce", () => {
    const input = legacyInput();
    const old = oldFacts(input);
    const factsHashes: Partial<Record<ProseSection, string>> = {};
    for (const section of PROSE_SECTIONS) {
      if (section === "opis_budynku") continue; // did not exist before 16.09
      const keys = OLD_SUBSET[section];
      // analiza_rynku / uzasadnienie: subset unchanged, so today's function IS
      // the stored value — including their transaction fingerprint.
      factsHashes[section] = keys ? storedHash(old, keys) : currentSectionFactsHash(section, input);
    }
    const sections = Object.fromEntries(
      PROSE_SECTIONS.filter((s) => s !== "opis_budynku").map((s) => [s, { value: "tekst" }]),
    ) as unknown as ProseSnapshot["sections"];

    expect(staleProseSections({ sections, factsHashes }, input, currentSectionFactsHash)).toEqual([
      "opis_lokalu",
      "otoczenie",
      "zagospodarowanie",
      "standard",
    ]);
  });
});
