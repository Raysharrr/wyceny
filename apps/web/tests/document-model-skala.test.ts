import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { computeKcs, type KcsInput } from "../src/domain/kcs";

function inputsWith(features: KcsInput["features"]): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i * 10,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features,
    sampleMeta: null,
    provenance: null,
  };
}

function modelWith(features: KcsInput["features"]) {
  const inputs = inputsWith(features);
  return buildDocumentModel({
    address: "ul. Przykładowa 1, Poznań",
    area: 50,
    purpose: "sprzedaz",
    kwNumber: "AB1C/1/1",
    client: "Klient Testowy",
    inspectionDate: "2026-07-01",
    approvedAt: new Date("2026-07-02T00:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "testowa kwota słownie",
  });
}

describe("document model — skala ocen (Slice 7)", () => {
  it("maps only non-empty levels, in lepsza→przeciętna→gorsza order, with Polish labels", () => {
    const m = modelWith([
      {
        name: "położenie na piętrze",
        weight: 1,
        rating: "przecietna",
        key: "polozenie-na-pietrze",
        definitions: { gorsza: "parter", lepsza: "czwarte piętro i powyżej" },
      },
    ]);
    expect(m.skala_ocen).toEqual([
      {
        cecha: "położenie na piętrze",
        poziomy: [
          { poziom: "lepsza", def: "czwarte piętro i powyżej" },
          { poziom: "gorsza", def: "parter" },
        ],
      },
    ]);
  });

  it("uses the label 'przeciętna' (diacritics) for the przecietna level", () => {
    const m = modelWith([
      {
        name: "standard wykończenia",
        weight: 1,
        rating: "przecietna",
        definitions: { przecietna: "standard dobry" },
      },
    ]);
    expect(m.skala_ocen[0]!.poziomy).toEqual([{ poziom: "przeciętna", def: "standard dobry" }]);
  });

  it("legacy features without definitions → empty skala_ocen (honest silence)", () => {
    const m = modelWith([{ name: "lokalizacja", weight: 1, rating: "lepsza" }]);
    expect(m.skala_ocen).toEqual([]);
  });

  it("weight-0 features are excluded from cechy, opis_* and skala_ocen (defensive shield)", () => {
    const m = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "opis" } },
      {
        name: "rodzaj zabudowy budynku",
        weight: 0,
        rating: "przecietna",
        definitions: { lepsza: "nie powinno się drukować" },
      },
    ]);
    expect(m.cechy.map((c) => c.nazwa)).toEqual(["lokalizacja"]);
    expect(m.opis_przedmiot).toHaveLength(1);
    expect(m.opis_cmin).toHaveLength(1);
    expect(m.opis_cmax).toHaveLength(1);
    expect(m.skala_ocen.map((r) => r.cecha)).toEqual(["lokalizacja"]);
  });

  it("a feature whose definitions are all empty strings contributes no skala_ocen row", () => {
    const m = modelWith([
      { name: "lokalizacja", weight: 1, rating: "lepsza", definitions: { lepsza: "  " } },
    ]);
    expect(m.skala_ocen).toEqual([]);
  });
});
