/**
 * B1 (blok "Prawo spółdzielcze", S1): one predicate for "this row came from a
 * register and needs verification" instead of ~10 scattered `"rcn"` literals.
 * A new source is added HERE, not hunted across eight files.
 */
import { describe, expect, it } from "vitest";
import {
  COMPARABLE_SOURCES,
  isRegistrySourced,
  REGISTRY_LABEL,
  type Comparable,
} from "../src/domain/kcs";
import { comparableSchema } from "../src/lib/valuation-form-schema";

describe("B1: comparable sources", () => {
  it("lists exactly the three sources a comparable can carry", () => {
    expect(COMPARABLE_SOURCES).toEqual(["rcn", "rejestr_sm", "manual"]);
  });

  it("isRegistrySourced: rcn and rejestr_sm are registers, manual/absent are not", () => {
    expect(isRegistrySourced({ source: "rcn" })).toBe(true);
    expect(isRegistrySourced({ source: "rejestr_sm" })).toBe(true);
    expect(isRegistrySourced({ source: "manual" })).toBe(false);
    expect(isRegistrySourced({})).toBe(false);
  });

  it("every register source has a display label", () => {
    expect(REGISTRY_LABEL.rcn).toBe("RCN");
    expect(REGISTRY_LABEL.rejestr_sm).toBe("Rejestr SM");
  });

  it("S2a: coopTxId is the register row's unforgeable id — typed on Comparable and accepted by the form schema", () => {
    const c: Comparable = { pricePerM2: 9000, source: "rejestr_sm", coopTxId: "coop-tx-1" };
    expect(comparableSchema.parse(c)).toMatchObject({ coopTxId: "coop-tx-1" });
    expect(comparableSchema.parse({ pricePerM2: 9000 }).coopTxId).toBeUndefined();
  });
});
