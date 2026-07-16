import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import {
  buildDocumentModel,
  documentFieldBlockers,
  formatNumber,
  formatPln,
} from "../src/domain/document-model";

const NBSP = "\u00A0"; // non-breaking space (escape — a pasted literal is invisible to review)

/** Synthetic inputs with FULL transaction dates and RCN ids — masking must strip both. */
function syntheticInputs(): KcsInput {
  return {
    area: 54.3,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 12_000 + i * 100,
      date: `2025-03-1${i % 10}`, // full date — must never reach the model
      area: 50 + i,
      source: "rcn" as const,
      transactionId: `rcn-tx-${i}`, // must never reach the model
      status: "confirmed" as const,
    })),
    features: [
      { name: "standard wykończenia", weight: 0.6, rating: "lepsza" as const },
      { name: "lokalizacja", weight: 0.4, rating: "gorsza" as const },
    ],
    sampleMeta: null,
    provenance: null,
  };
}

function buildModel() {
  const inputs = syntheticInputs();
  return buildDocumentModel({
    address: "ul. Testowa 7, Poznań",
    area: 54.3,
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "p. Test Testowy",
    inspectionDate: "2026-07-01",
    approvedAt: new Date("2026-07-15T10:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "sto tysięcy złotych zero groszy",
  });
}

describe("F-12: professional-secrecy masking in the document model", () => {
  it("shows only YYYY-MM for comparable transaction dates", () => {
    const model = buildModel();
    for (const row of model.transakcje) {
      expect(row.data_msc).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("never leaks full dates, transactionIds or provenance internals anywhere in the model", () => {
    const json = JSON.stringify(buildModel());
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no full ISO date survives
    expect(json).not.toContain("rcn-tx-");
    expect(json).not.toContain("transactionId");
    expect(json).not.toContain("to_verify");
  });

  it("maps purpose to Polish document text and drives the credit conditional", () => {
    const model = buildModel();
    expect(model.cel).toBe("dla potrzeb sprzedaży");
    expect(model.kredyt).toBe(false);
    const inputs = syntheticInputs();
    const credit = buildDocumentModel({
      address: "x",
      area: 1,
      purpose: "zabezpieczenie_kredytu",
      kwNumber: "KW-TEST-1",
      client: "k",
      inspectionDate: "2026-07-01",
      approvedAt: new Date("2026-07-15T10:00:00Z"),
      inputs,
      kcs: computeKcs(inputs),
      amountInWords: "słownie",
    });
    expect(credit.kredyt).toBe(true);
  });

  it("formats dates as DD.MM.YYYY and amounts with NBSP grouping + comma decimals", () => {
    const model = buildModel();
    expect(model.data_ogledzin).toBe("01.07.2026");
    expect(model.data_sporzadzenia).toBe("15.07.2026");
    expect(formatPln(1044400)).toBe(`1${NBSP}044${NBSP}400,00`);
    expect(formatNumber(0.92, 3)).toBe("0,920");
    expect(formatNumber(12061.94, 2)).toBe(`12${NBSP}061,94`);
  });

  it("builds one cechy row per feature with Ui range values", () => {
    const model = buildModel();
    expect(model.cechy).toHaveLength(2);
    const [standard] = model.cechy;
    expect(standard.nazwa).toBe("standard wykończenia");
    expect(standard.waga_pct).toBe("60");
    // ui_sr is the bare weight, 3dp
    expect(standard.ui_sr).toBe("0,600");
  });

  it("builds 12.2 description bullets from ratings", () => {
    const model = buildModel();
    expect(model.opis_przedmiot).toEqual([
      "standard wykończenia – wartość najwyższa cechy,",
      "lokalizacja – wartość najniższa cechy,",
    ]);
    expect(model.opis_cmin).toHaveLength(2);
    expect(model.opis_cmin[0]).toContain("wartość najniższa");
    expect(model.opis_cmax[0]).toContain("wartość najwyższa");
  });
});

describe("documentFieldBlockers", () => {
  it("returns one Polish blocker per missing field, empty when complete", () => {
    expect(
      documentFieldBlockers({ purpose: null, kwNumber: null, client: null, inspectionDate: null }),
    ).toHaveLength(4);
    const blockers = documentFieldBlockers({
      purpose: "sprzedaz",
      kwNumber: null,
      client: "k",
      inspectionDate: "2026-07-01",
    });
    expect(blockers).toEqual([{ path: "kwNumber", label: "Numer księgi wieczystej — brak." }]);
    expect(
      documentFieldBlockers({
        purpose: "sprzedaz",
        kwNumber: "KW-TEST-1",
        client: "k",
        inspectionDate: "2026-07-01",
      }),
    ).toEqual([]);
  });
});
