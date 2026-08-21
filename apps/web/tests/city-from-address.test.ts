import { describe, expect, it } from "vitest";
import { cityFromAddress } from "../src/domain/document-model";

/**
 * Staging feedback 2026-08-20 (Łukasz): every row of the operat's Table 1 read
 * "Heweliusza 3/43" in the "Miasto" column. `cityFromAddress` took the text
 * after the LAST comma, so "Poznań, Heweliusza 3/43" — the exact form the
 * address combobox inserts — yielded the street, and a comma-less address
 * yielded itself. The worker's `parse_address` already accepts both orders;
 * the document must agree with it.
 */
describe("cityFromAddress — both comma orders, postal code, no comma", () => {
  it.each([
    ["ul. Heweliusza 3/43, Poznań", "Poznań"],
    ["Poznań, Heweliusza 3/43", "Poznań"],
    ["Poznań, ul. Kościelna 12", "Poznań"],
    ["Heweliusza 3/43", "Poznań"],
    ["ul. Sielawy 21F/17, 61-619 Poznań", "Poznań"],
    ["os. Przyjaźni 12, Poznań", "Poznań"],
    ["Swarzędz, Rynek 5", "Swarzędz"],
    ["Rynek 5, Swarzędz", "Swarzędz"],
    // Country suffix: only the city segment may reach Table 1, never "Poznań, Polska".
    ["ul. Kościelna 12, Poznań, Polska", "Poznań"],
    ["Poznań, ul. Kościelna 12, Polska", "Poznań"],
    // Street prefix without a number still marks the street half.
    ["Poznań, ul. Kościelna", "Poznań"],
    // A bare name without digits is taken as the city — the document does not guess.
    ["Kórnik", "Kórnik"],
    // Both halves look like streets: first wins, same as the worker.
    ["ul. A 1, ul. B 2", "ul. A 1"],
  ])("%s → %s", (address, city) => {
    expect(cityFromAddress(address)).toBe(city);
  });

  it("returns a dash for an empty address", () => {
    expect(cityFromAddress("   ")).toBe("—");
  });
});

// The "Table 1 of the operat never shows the subject's street as a city"
// regression guard (staging feedback 2026-08-20, Łukasz) lived here and
// asserted `model.transakcje[].miasto`. Slice 3 (Task 10, review PR #21)
// removed the `miasto`/`ulica` columns entirely — Table 1 now prints each
// row's own obręb/distance and never the subject's address at all, so the
// bug class this guarded is structurally impossible rather than merely
// fixed. Its replacement lives in tests/document-model-table1.test.ts
// (`not.toContain("Poznań")`) and tests/f12-template-integrity.test.ts
// (`{miasto}`/`{ulica}` forbidden literals). `cityFromAddress` itself is
// untouched above — it still backs the §11 "rynek" prose sentence.
