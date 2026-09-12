/**
 * D-1 (blok "Prawo spółdzielcze", S1): the step-7 field check must not demand a
 * KW number the coop right legally leaves empty in step 1 — otherwise the
 * appraiser loops between the blocker and an empty field with no way out.
 */
import { describe, expect, it } from "vitest";
import { documentFieldBlockers } from "../src/domain/document-model";

const filled = {
  purpose: "sprzedaz",
  kwNumber: null,
  client: "Jan Kowalski",
  inspectionDate: "2026-07-01",
  wr: 450000,
};

describe("documentFieldBlockers × propertyRight", () => {
  it("własność (and legacy without the field) + empty kwNumber → blocker", () => {
    for (const v of [filled, { ...filled, propertyRight: "wlasnosc_lokalu" as const }]) {
      expect(documentFieldBlockers(v).map((b) => b.path)).toEqual(["kwNumber"]);
    }
  });
  it("spółdzielcze + empty kwNumber → no blocker; other fields still gated", () => {
    const coop = { ...filled, propertyRight: "spoldzielcze_wlasnosciowe" as const };
    expect(documentFieldBlockers(coop)).toEqual([]);
    expect(documentFieldBlockers({ ...coop, client: null }).map((b) => b.path)).toEqual(["client"]);
  });
});
