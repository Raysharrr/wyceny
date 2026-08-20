import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import { buildDocumentModel, cityFromAddress } from "../src/domain/document-model";

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

describe("Table 1 of the operat never shows the subject's street as a city", () => {
  it("combobox-format address puts the city, not the street, in every comparable row", () => {
    const inputs: KcsInput = {
      area: 50,
      comparables: Array.from({ length: 12 }, (_, i) => ({
        pricePerM2: 10_000 + i * 100,
        date: `2026-06-1${i % 10}`,
        area: 45 + i,
        source: "rcn" as const,
        transactionId: `rcn-tx-${i}`,
        status: "confirmed" as const,
      })),
      features: [{ name: "standard wykończenia", weight: 1, rating: "lepsza" as const }],
      sampleMeta: null,
      provenance: null,
    };
    const model = buildDocumentModel({
      address: "Poznań, Heweliusza 3/43",
      area: 50,
      purpose: "sprzedaz",
      kwNumber: "KW-TEST-1",
      client: "p. Test",
      inspectionDate: "2026-08-01",
      approvedAt: new Date("2026-08-20T10:00:00Z"),
      inputs,
      kcs: computeKcs(inputs),
      amountInWords: "sto tysięcy złotych zero groszy",
    });
    for (const row of model.transakcje) {
      expect(row.miasto).toBe("Poznań");
    }
  });
});
